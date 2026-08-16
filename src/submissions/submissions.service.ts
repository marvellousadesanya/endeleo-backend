// Project submissions — the sponsor intake form.
//
// Submitting is deliberately public: a sponsor can propose a project before holding an
// account, which is how the marketing funnel works. Reading submissions back is not,
// and is scoped to the signed-in submitter.
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";
import { StorageService } from "@/storage/storage.service";
import type { CreateSubmissionDto } from "./dto/submissions.dto";

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
  ) {}

  async create(dto: CreateSubmissionDto, files: Express.Multer.File[], userId?: string) {
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

    try {
      return await this.prisma.projectSubmission.create({
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
          submitterName: dto.submitterName,
          submitterEmail: dto.submitterEmail,
          submitterPhone: dto.submitterPhone || null,
          submitterType: dto.submitterType,
          role: dto.role || null,
          status: "submitted",
        },
      });
    } catch (err) {
      // Do not leave uploaded bytes behind if the row could not be written.
      await Promise.all(attachments.map((a) => this.storage.remove(a.path)));
      throw err;
    }
  }

  listMine(userId: string) {
    return this.prisma.projectSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }
}
