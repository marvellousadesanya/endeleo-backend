// Issuance and the register.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/audit/audit.service";
import { StorageService } from "@/storage/storage.service";
import type { AuthUser } from "@/auth/jwt.strategy";
import { ActivationService } from "./engine/activation.service";
import { generateIsinRef } from "./engine/money";
import { toMinor, type CreateBondDto } from "./dto/bonds.dto";

/** Cover images only — a bond cover is a photo, not a media library. */
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

@Injectable()
export class BondsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activation: ActivationService,
    private readonly storage: StorageService,
  ) {}

  /** Adds the resolved public cover URL; the stored path itself is never exposed. */
  private withCoverUrl<T extends { coverImagePath: string | null }>(bond: T) {
    const { coverImagePath, ...rest } = bond;
    return {
      ...rest,
      coverImageUrl: coverImagePath ? this.storage.getPublicUrl(coverImagePath) : null,
    };
  }

  async create(dto: CreateBondDto, issuerId: string) {
    const totalSizeMinor = toMinor(dto.totalSizeMinor, "totalSizeMinor");
    const minimumInvestmentMinor = toMinor(dto.minimumInvestmentMinor, "minimumInvestmentMinor");
    if (new Date(dto.subscriptionCloseAt) <= new Date(dto.subscriptionOpenAt)) {
      throw new BadRequestException("subscriptionCloseAt must be after subscriptionOpenAt");
    }

    const bond = await this.prisma.bond.create({
      data: {
        isinRef: generateIsinRef(dto.spvReference),
        title: dto.title,
        spvReference: dto.spvReference,
        projectSlug: dto.projectSlug ?? null,
        issuerId,
        currency: dto.currency ?? "NGN",
        totalSizeMinor,
        minimumInvestmentMinor,
        tenorMonths: dto.tenorMonths,
        couponRateBps: dto.couponRateBps,
        couponFrequency: dto.couponFrequency ?? "quarterly",
        allocationRule: dto.allocationRule ?? "fcfs",
        concentrationLimitBps: dto.concentrationLimitBps ?? 2000,
        kycTierRequired: dto.kycTierRequired ?? 1,
        geoBlock: dto.geoBlock ?? [],
        subscriptionOpenAt: new Date(dto.subscriptionOpenAt),
        subscriptionCloseAt: new Date(dto.subscriptionCloseAt),
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        maturityDate: dto.maturityDate ? new Date(dto.maturityDate) : null,
        location: dto.location ?? null,
        sector: dto.sector ?? null,
        summary: dto.summary ?? null,
        overview: dto.overview ?? null,
        highlights: dto.highlights ?? [],
        risks: dto.risks ?? [],
      },
    });

    await this.audit.record({
      bondId: bond.id, userId: issuerId, event: "bond_created",
      payload: { isinRef: bond.isinRef, totalSizeMinor: totalSizeMinor.toString() },
    });
    await this.seedChecklist(bond.id);
    await this.seedAgreements(bond.id);
    return this.withCoverUrl(bond);
  }

  /**
   * Every bond starts with the same standard compliance (KYB) and due-diligence
   * checklist — items a sponsor works through and admin verifies, on the sponsor
   * portal. Seeded once at creation rather than requiring admin to type them out per
   * bond; a sponsor's own progress is theirs to fill in from there.
   */
  private async seedChecklist(bondId: string) {
    const compliance = [
      "CAC verification", "Beneficial ownership disclosure", "Authorised signatories",
      "AML / sanctions screening", "PEP screening", "Tax clearance certificate",
    ].map((label, i) => ({ bondId, kind: "compliance" as const, label, sortOrder: i }));

    const dueDiligence: { area: string; label: string }[] = [
      { area: "Corporate", label: "Certificate of incorporation" },
      { area: "Corporate", label: "Memorandum & articles of association" },
      { area: "Financial", label: "Audited financial statements (3 years)" },
      { area: "Financial", label: "Management accounts (latest quarter)" },
      { area: "Technical", label: "Feasibility / technical study" },
      { area: "Legal", label: "Title / land documents" },
      { area: "Legal", label: "Material contracts" },
      { area: "ESG", label: "Environmental & social impact assessment" },
    ];

    await this.prisma.sponsorChecklistItem.createMany({
      data: [
        ...compliance,
        ...dueDiligence.map((d, i) => ({
          bondId, kind: "due_diligence" as const, area: d.area, label: d.label, sortOrder: i,
        })),
      ],
    });
  }

  /**
   * The standard document set every deal expects — seeded as `draft` with no file
   * attached, since none has been drawn up yet. Admin uploads and sends each one when
   * it's ready; the sponsor sees what's coming before that happens, which is itself
   * useful rather than a placeholder.
   */
  private async seedAgreements(bondId: string) {
    const titles = [
      "Mutual NDA", "Mandate Letter", "Term Sheet", "Subscription Agreement", "Trust Deed",
    ];
    await this.prisma.sponsorAgreement.createMany({
      data: titles.map((title, i) => ({ bondId, title, sortOrder: i })),
    });
  }

  /** Investors see published bonds; drafts belong to their issuer and to admins. */
  /**
   * The investor-facing list. Never includes a draft, for anyone — this used to also
   * show every draft to an admin or issuer, which meant an admin/issuer test account
   * saw unpublished bonds bleeding into what's supposed to look like the plain investor
   * "Projects" page. Admins get their own full list (listAllForAdmin); an issuer
   * previewing their own unpublished bond gets listMine.
   */
  async listPublished() {
    const bonds = await this.prisma.bond.findMany({
      where: { status: { not: "draft" } },
      orderBy: { createdAt: "desc" },
    });
    return bonds.map((b) => this.withCoverUrl(b));
  }

  /** A sponsor's own bonds, any status — so they can see a bond before it's published. */
  async listMine(issuerId: string) {
    const bonds = await this.prisma.bond.findMany({
      where: { issuerId },
      orderBy: { createdAt: "desc" },
    });
    return bonds.map((b) => this.withCoverUrl(b));
  }

  /** Admin console only — every bond regardless of status or issuer. */
  async listAllForAdmin() {
    const bonds = await this.prisma.bond.findMany({ orderBy: { createdAt: "desc" } });
    return bonds.map((b) => this.withCoverUrl(b));
  }

  async findOne(id: string, viewer: { id: string; roles: string[] }) {
    const bond = await this.prisma.bond.findUnique({ where: { id } });
    if (!bond) throw new NotFoundException("Bond not found");
    const visible =
      bond.status !== "draft" || bond.issuerId === viewer.id || viewer.roles.includes("admin");
    if (!visible) throw new NotFoundException("Bond not found");
    return this.withCoverUrl(bond);
  }

  /**
   * Attaches (or replaces) a bond's cover image. Admins can set it on any bond; an
   * issuer only on their own.
   */
  async setCoverImage(bondId: string, actor: AuthUser, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("An image file is required");
    if (file.size > MAX_COVER_BYTES) throw new BadRequestException("Image must be 5MB or smaller");
    if (!COVER_MIME.has(file.mimetype)) {
      throw new BadRequestException("Cover image must be a PNG, JPEG or WebP");
    }

    const bond = await this.prisma.bond.findUnique({
      where: { id: bondId },
      select: { id: true, issuerId: true, coverImagePath: true },
    });
    if (!bond) throw new NotFoundException("Bond not found");
    if (!actor.roles.includes("admin") && bond.issuerId !== actor.id) {
      throw new ForbiddenException("Not your bond");
    }

    const stored = await this.storage.put(
      "bond-covers",
      file.originalname,
      file.mimetype,
      file.buffer,
    );
    const updated = await this.prisma.bond.update({
      where: { id: bondId },
      data: { coverImagePath: stored.path },
    });
    if (bond.coverImagePath && bond.coverImagePath !== stored.path) {
      await this.storage.remove(bond.coverImagePath);
    }
    await this.audit.record({
      bondId, userId: actor.id, event: "bond_cover_updated", payload: { path: stored.path },
    });
    return this.withCoverUrl(updated);
  }

  /**
   * Activation is more than a status flip — it stamps the dates and builds the coupon
   * and redemption schedules, so it is delegated rather than duplicated here.
   */
  async changeStatus(id: string, status: string, actorId: string) {
    const bond = await this.prisma.bond.findUnique({ where: { id } });
    if (!bond) throw new NotFoundException("Bond not found");

    if (status === "active") {
      await this.activation.activate(id, { actorId });
      return this.withCoverUrl(await this.prisma.bond.findUniqueOrThrow({ where: { id } }));
    }

    // The database enforces which transitions are legal; this surfaces the refusal as a
    // 400 rather than a 500.
    try {
      const updated = await this.prisma.bond.update({
        where: { id },
        data: { status: status as never },
      });
      await this.audit.record({ bondId: id, userId: actorId, event: "bond_state_changed", payload: { to: status } });
      return this.withCoverUrl(updated);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("Illegal bond status transition")) {
        throw new BadRequestException(`Cannot move a bond from ${bond.status} to ${status}`);
      }
      throw e;
    }
  }

  holdingsFor(userId: string) {
    return this.prisma.holding.findMany({
      where: { userId, unitsMinor: { gt: 0n } },
      include: {
        bond: {
          select: {
            id: true, title: true, isinRef: true, currency: true, status: true,
            couponRateBps: true, couponFrequency: true, maturityDate: true, issueDate: true,
            tenorMonths: true, projectSlug: true, spvReference: true, sector: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  /** The bondholder register for one bond. Admins and the issuer only. */
  async register(bondId: string, viewer: { id: string; roles: string[] }) {
    const bond = await this.prisma.bond.findUnique({ where: { id: bondId } });
    if (!bond) throw new NotFoundException("Bond not found");
    if (!viewer.roles.includes("admin") && bond.issuerId !== viewer.id) {
      throw new ForbiddenException("Not your bond");
    }

    const holders = await this.prisma.holding.findMany({
      where: { bondId, unitsMinor: { gt: 0n } },
      include: { user: { select: { id: true, email: true, fullName: true, kycTier: true } } },
      orderBy: { unitsMinor: "desc" },
    });

    return {
      generatedAt: new Date().toISOString(),
      bond: { id: bond.id, isinRef: bond.isinRef, title: bond.title, totalSizeMinor: bond.totalSizeMinor, raisedMinor: bond.raisedMinor },
      holders: holders.map((h) => ({
        user: h.user,
        unitsMinor: h.unitsMinor,
        shareBps: Number((h.unitsMinor * 10000n) / bond.totalSizeMinor),
        firstSettledAt: h.firstSettledAt,
      })),
    };
  }
}
