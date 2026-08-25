// Profiles: everything about a person that is not identity or credentials.
//
// A profile row is created on demand rather than at registration, so an account made
// before this module existed still works — the first read materialises an empty one.
import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma, Profile } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";
import { StorageService } from "@/storage/storage.service";
import type { SubmitKycDto, UpdateProfileDto } from "./dto/profiles.dto";

/** Document keys each investor type must supply before KYC can be accepted. */
/// Tier granted when KYC documents are accepted. Bonds default to requiring 1; higher
/// tiers are an admin grant, not something submission can earn.
const VERIFIED_KYC_TIER = 1;

const RETAIL_DOC_KEYS = ["id_document", "proof_of_address"] as const;
const INSTITUTIONAL_DOC_KEYS = [
  "certificate_of_incorporation",
  "proof_of_address",
  "director_id",
] as const;

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Stores one KYC document and returns its path, which the caller then submits with
   * the rest of the form. Scoped to the caller's own prefix so the ownership check in
   * submitKyc below can never be satisfied with someone else's file.
   */
  async uploadKycDocument(userId: string, file: Express.Multer.File) {
    const stored = await this.storage.put(
      `${userId}`,
      file.originalname,
      file.mimetype || "application/octet-stream",
      file.buffer,
    );
    return { path: stored.path, fileName: stored.fileName, sizeBytes: stored.sizeBytes };
  }

  /**
   * The profile as the UI consumes it: profile columns plus the identity fields User
   * owns. email and fullName are deliberately not stored twice — see schema.prisma.
   */
  async findForUser(userId: string) {
    const [user, profile] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, fullName: true, kycTier: true },
      }),
      this.prisma.profile.findUnique({ where: { userId } }),
    ]);

    return {
      id: userId,
      email: user?.email ?? null,
      fullName: user?.fullName ?? null,
      kycTier: user?.kycTier ?? 0,
      ...this.emptyIfMissing(profile),
    };
  }

  /** Shape a missing profile as defaults, so the UI never has to null-check the row. */
  private emptyIfMissing(profile: Profile | null) {
    if (profile) {
      const { userId: _userId, ...rest } = profile;
      return rest;
    }
    return {
      avatarUrl: null,
      phone: null,
      country: null,
      address: null,
      dateOfBirth: null,
      currencyPref: "NGN",
      investorType: null,
      submitterType: null,
      companyName: null,
      contactTitle: null,
      registrationNumber: null,
      taxId: null,
      nationalId: null,
      kycStatus: "none" as const,
      kycDocuments: {},
      kycSubmittedAt: null,
      referralCode: null,
      referredBy: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  async update(userId: string, dto: UpdateProfileDto) {
    // fullName lives on User, not Profile, so it is split out and written there.
    const { fullName, ...profileFields } = dto;

    await this.prisma.$transaction(async (tx) => {
      if (fullName !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { fullName } });
      }
      if (Object.keys(profileFields).length > 0) {
        await tx.profile.upsert({
          where: { userId },
          create: { userId, ...profileFields },
          update: profileFields,
        });
      }
    });

    return this.findForUser(userId);
  }

  async submitKyc(userId: string, dto: SubmitKycDto) {
    const required =
      dto.investorType === "institutional" ? INSTITUTIONAL_DOC_KEYS : RETAIL_DOC_KEYS;

    for (const key of required) {
      const path = dto.documents[key];
      if (typeof path !== "string" || path.length === 0) {
        throw new BadRequestException(`Missing required document: ${key}`);
      }
    }

    // Every path must sit under the caller's own prefix. Without this a user could
    // claim someone else's uploaded document by submitting its path.
    for (const path of Object.values(dto.documents)) {
      if (!path.startsWith(`${userId}/`)) {
        throw new BadRequestException("Invalid document path");
      }
    }

    const { documents, fullName, investorType, dateOfBirth, ...rest } = dto;

    const data: Prisma.ProfileUncheckedCreateInput = {
      userId,
      investorType,
      ...rest,
      ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
      kycDocuments: documents as Prisma.InputJsonValue,
      // Preserves the previous behaviour, which marked submissions verified on receipt.
      // If a review step is ever added, this becomes `pending` and an admin moves it on.
      kycStatus: "verified",
      kycSubmittedAt: new Date(),
    };

    await this.prisma.$transaction(async (tx) => {
      if (fullName) {
        await tx.user.update({ where: { id: userId }, data: { fullName } });
      }
      const { userId: _omit, ...updateData } = data;
      await tx.profile.upsert({ where: { userId }, create: data, update: updateData });

      // Verification has to grant the tier as well as the status. They are separate
      // fields on separate models — profiles.kyc_status drives what the UI shows, while
      // users.kyc_tier is what the subscription and market gates actually compare against
      // (bonds.kyc_tier_required defaults to 1). Setting only the status left every
      // verified investor reading "Verified" but blocked at tier 0.
      //
      // updateMany with `lt` so this only ever raises a tier — an admin-granted 2 or 3
      // must survive the user resubmitting their documents.
      await tx.user.updateMany({
        where: { id: userId, kycTier: { lt: VERIFIED_KYC_TIER } },
        data: { kycTier: VERIFIED_KYC_TIER },
      });
    });

    return { ok: true };
  }

  /** Roles live on the user, not the profile; grouped here because the UI asks together. */
  async rolesFor(userId: string) {
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId },
      select: { role: true },
    });
    const roles = assignments.map((a) => a.role);
    return {
      roles,
      isAdmin: roles.includes("admin"),
      isEditor: roles.includes("admin") || roles.includes("editor"),
    };
  }
}
