// Project submissions — the sponsor intake form.
//
// Submitting is deliberately public: a sponsor can propose a project before holding an
// account, which is how the marketing funnel works. Reading submissions back is not,
// and is scoped to the signed-in submitter.
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, SubmissionStatus } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";
import { StorageService } from "@/storage/storage.service";
import { BondsService } from "@/bonds/bonds.service";
import type { CreateBondDto } from "@/bonds/dto/bonds.dto";
import type { CreateSubmissionDto, PromoteSubmissionDto, ReviewSubmissionDto } from "./dto/submissions.dto";

/** Shape stored in the attachments JSON column. */
interface StoredAttachment {
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly bonds: BondsService,
  ) {}

  /** Adds the resolved public cover URL; the stored path itself is never exposed. */
  private withCoverUrl<T extends { coverImagePath: string | null }>(submission: T) {
    const { coverImagePath, ...rest } = submission;
    return {
      ...rest,
      coverImageUrl: coverImagePath ? this.storage.getPublicUrl(coverImagePath) : null,
    };
  }

  async create(
    dto: CreateSubmissionDto,
    files: Express.Multer.File[],
    userId?: string,
    coverFile?: Express.Multer.File,
  ) {
    const attachments: StoredAttachment[] = [];
    for (const file of files) {
      const stored = await this.storage.put(
        "submissions",
        file.originalname,
        file.mimetype || "application/octet-stream",
        file.buffer,
      );
      attachments.push({
        name: stored.fileName,
        path: stored.path,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
      });
    }

    // Stored under its own scope, distinct from the generic attachments above, so the
    // same key can be copied straight onto the bond's coverImagePath on promotion.
    let coverImagePath: string | null = null;
    if (coverFile) {
      const stored = await this.storage.put(
        "submission-covers",
        coverFile.originalname,
        coverFile.mimetype || "image/jpeg",
        coverFile.buffer,
      );
      coverImagePath = stored.path;
    }

    try {
      const created = await this.prisma.projectSubmission.create({
        data: {
          userId: userId ?? null,
          projectTitle: dto.projectTitle,
          organization: dto.organization || null,
          sector: dto.sector,
          locationState: dto.locationState || null,
          projectStage: dto.projectStage || null,
          summary: dto.summary,
          capitalRequiredMinor: dto.capitalRequiredMinor ? BigInt(dto.capitalRequiredMinor) : null,
          expectedReturnBps: dto.expectedReturnBps ?? null,
          tenorMonths: dto.tenorMonths ?? null,
          websiteUrl: dto.websiteUrl || null,
          additionalLinks: dto.additionalLinks || null,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          coverImagePath,
          submitterName: dto.submitterName,
          submitterEmail: dto.submitterEmail,
          submitterPhone: dto.submitterPhone || null,
          submitterType: dto.submitterType,
          role: dto.role || null,
          status: "submitted",
        },
      });
      return this.withCoverUrl(created);
    } catch (err) {
      // Do not leave uploaded bytes behind if the row could not be written.
      await Promise.all(attachments.map((a) => this.storage.remove(a.path)));
      if (coverImagePath) await this.storage.remove(coverImagePath);
      throw err;
    }
  }

  async listMine(userId: string) {
    const rows = await this.prisma.projectSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.withCoverUrl(r));
  }

  // ---- Admin review --------------------------------------------------------

  async listAll(status?: SubmissionStatus) {
    const rows = await this.prisma.projectSubmission.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.withCoverUrl(r));
  }

  /** Raw row, coverImagePath intact — for internal use (review, promote) only. */
  private async findRaw(id: string) {
    const submission = await this.prisma.projectSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException("Submission not found");
    return submission;
  }

  async findOne(id: string) {
    return this.withCoverUrl(await this.findRaw(id));
  }

  /** A fresh, short-lived link to one uploaded file — minted on demand, not stored. */
  async getAttachmentDownloadUrl(id: string, index: number) {
    const submission = await this.findRaw(id);
    const attachments = submission.attachments as unknown as StoredAttachment[];
    const attachment = attachments[index];
    if (!attachment) throw new NotFoundException("Attachment not found");

    const url = await this.storage.getDownloadUrl(attachment.path, {
      fileName: attachment.name,
      mimeType: attachment.mimeType,
    });
    return { url, fileName: attachment.name, mimeType: attachment.mimeType };
  }

  /** Moves a submission through in_review / approved / rejected. Never touches `promoted`. */
  async review(id: string, dto: ReviewSubmissionDto) {
    const submission = await this.findRaw(id);
    if (submission.status === "promoted") {
      throw new BadRequestException("This submission was already promoted to a bond");
    }

    const updated = await this.prisma.projectSubmission.update({
      where: { id },
      data: {
        status: dto.status,
        reviewerNotes: dto.reviewerNotes ?? submission.reviewerNotes,
        reviewedAt: new Date(),
      },
    });
    return this.withCoverUrl(updated);
  }

  /**
   * Creates the bond an approved submission becomes, and links the two. Only an
   * approved, not-yet-promoted submission is eligible — this is the one step that
   * moves a sponsor's pitch into the investor-facing register.
   */
  async promote(id: string, dto: PromoteSubmissionDto) {
    const submission = await this.findRaw(id);
    if (submission.status !== "approved") {
      throw new BadRequestException("Only an approved submission can be promoted");
    }

    const totalSizeMinor = dto.totalSizeMinor ?? submission.capitalRequiredMinor?.toString();
    if (!totalSizeMinor) {
      throw new BadRequestException(
        "totalSizeMinor is required — this submission did not include a capital amount",
      );
    }
    const tenorMonths = dto.tenorMonths ?? submission.tenorMonths;
    if (tenorMonths == null) throw new BadRequestException("tenorMonths is required");
    const couponRateBps = dto.couponRateBps ?? submission.expectedReturnBps;
    if (couponRateBps == null) throw new BadRequestException("couponRateBps is required");

    const bondDto: CreateBondDto = {
      title: submission.projectTitle,
      spvReference: dto.spvReference,
      currency: "NGN",
      totalSizeMinor,
      minimumInvestmentMinor: dto.minimumInvestmentMinor,
      tenorMonths,
      couponRateBps,
      couponFrequency: dto.couponFrequency,
      subscriptionOpenAt: dto.subscriptionOpenAt,
      subscriptionCloseAt: dto.subscriptionCloseAt,
      location: submission.locationState ?? undefined,
      sector: submission.sector ?? undefined,
      summary: submission.summary || undefined,
    };

    // Not one atomic transaction: BondsService.create also writes an audit entry
    // through AuditService, which owns its own PrismaService and cannot join this
    // call's transaction without threading a tx client through both services. If the
    // second write below fails, the bond exists but the submission is left "approved"
    // with no bondId — recoverable by re-running promote with the same bond details,
    // but worth knowing this isn't a single database transaction.
    let bond = await this.bonds.create(bondDto, dto.issuerId);

    // The bond's own cover wins if BondsService.create ever grows one at creation
    // time; this only fills the gap when the bond was created bare, straight from a
    // submission that happened to have a cover of its own.
    if (submission.coverImagePath && !bond.coverImageUrl) {
      await this.prisma.bond.update({
        where: { id: bond.id },
        data: { coverImagePath: submission.coverImagePath },
      });
      bond = { ...bond, coverImageUrl: this.storage.getPublicUrl(submission.coverImagePath) };
    }

    await this.prisma.projectSubmission.update({
      where: { id },
      data: { status: "promoted", bondId: bond.id, reviewedAt: new Date() },
    });
    return bond;
  }
}
