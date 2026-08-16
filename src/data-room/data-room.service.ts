// Data room: gated documents, and the signature wall in front of some of them.
//
// Access rules, unchanged from the Supabase version but now enforced server-side:
//   • editors and admins see everything, published or not
//   • verified investors see published documents only
//   • a document marked requires_signature stays shut until that user has signed it
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { StorageService } from "@/storage/storage.service";
import type { AuthUser } from "@/auth/jwt.strategy";
import type { SignDocumentDto, UpsertDocumentDto } from "./dto/data-room.dto";

export interface DataRoomAccess {
  isEditor: boolean;
  isVerifiedInvestor: boolean;
}

@Injectable()
export class DataRoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private isEditor(user: AuthUser): boolean {
    return user.roles.includes("admin") || user.roles.includes("editor");
  }

  private async accessFor(user: AuthUser): Promise<DataRoomAccess> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      select: { kycStatus: true },
    });
    return {
      isEditor: this.isEditor(user),
      isVerifiedInvestor: profile?.kycStatus === "verified",
    };
  }

  /** Documents plus this user's signature on each, and what they are allowed to do. */
  async list(user: AuthUser, bondId?: string) {
    const access = await this.accessFor(user);

    const documents = await this.prisma.dataRoomDocument.findMany({
      // bondId omitted means the general set, matching the previous `.is(null)` filter.
      where: {
        bondId: bondId ?? null,
        ...(access.isEditor ? {} : { isPublished: true }),
      },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
      include: {
        signatures: {
          where: { userId: user.id },
          select: { signedAt: true, signedName: true },
        },
      },
    });

    return {
      access,
      documents: documents.map(({ signatures, filePath: _filePath, ...doc }) => ({
        ...doc,
        // filePath is deliberately not exposed — downloads go through a signed token.
        signature: signatures[0] ?? null,
      })),
    };
  }

  listForAdmin(bondId?: string) {
    return this.prisma.dataRoomDocument.findMany({
      where: bondId ? { bondId } : undefined,
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
    });
  }

  /**
   * Checks the caller may open the document, then mints a short-lived token. The token
   * is bound to both the document and the user, so it cannot be passed to someone else.
   */
  async createDownloadToken(user: AuthUser, documentId: string) {
    const doc = await this.prisma.dataRoomDocument.findUnique({
      where: { id: documentId },
      select: { id: true, isPublished: true, requiresSignature: true, mimeType: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    const access = await this.accessFor(user);
    if (!access.isEditor && !access.isVerifiedInvestor) {
      throw new ForbiddenException("Investor verification required");
    }
    if (!doc.isPublished && !access.isEditor) {
      throw new ForbiddenException("Not available");
    }
    if (doc.requiresSignature && !access.isEditor) {
      const signature = await this.prisma.dataRoomSignature.findUnique({
        where: { documentId_userId: { documentId: doc.id, userId: user.id } },
      });
      if (!signature) throw new ForbiddenException("Signature required");
    }

    const token = this.storage.signToken(doc.id, user.id);
    return {
      url: `/api/data-room/documents/${doc.id}/file?token=${token}`,
      mimeType: doc.mimeType,
    };
  }

  /** Re-verifies the token, then hands back the path for the controller to stream. */
  async resolveDownload(documentId: string, userId: string, token: string) {
    if (!this.storage.verifyToken(token, documentId, userId)) {
      throw new ForbiddenException("Link expired or invalid");
    }
    const doc = await this.prisma.dataRoomDocument.findUnique({
      where: { id: documentId },
      select: { filePath: true, fileName: true, mimeType: true },
    });
    if (!doc) throw new NotFoundException("Document not found");
    return doc;
  }

  /** Signing twice is a no-op rather than a second row — the unique index enforces it. */
  async sign(user: AuthUser, dto: SignDocumentDto, ipAddress?: string) {
    const doc = await this.prisma.dataRoomDocument.findUnique({
      where: { id: dto.documentId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    const signature = await this.prisma.dataRoomSignature.upsert({
      where: { documentId_userId: { documentId: dto.documentId, userId: user.id } },
      create: {
        documentId: dto.documentId,
        userId: user.id,
        signedName: dto.signedName,
        ipAddress,
      },
      update: {},
    });
    return { ok: true, signedAt: signature.signedAt };
  }

  async upsertDocument(dto: UpsertDocumentDto, userId: string, file?: Express.Multer.File) {
    let stored: { path: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;
    if (file) {
      stored = await this.storage.put(
        "data-room",
        file.originalname,
        file.mimetype || "application/octet-stream",
        file.buffer,
      );
    }

    const base = {
      bondId: dto.bondId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      category: dto.category ?? "general",
      issuer: dto.issuer ?? null,
      requiresSignature: dto.requiresSignature ?? false,
      isPublished: dto.isPublished ?? false,
      sortOrder: dto.sortOrder ?? 0,
      ...(stored
        ? {
            fileName: stored.fileName,
            filePath: stored.path,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
          }
        : {}),
    };

    if (dto.id) {
      const previous = await this.prisma.dataRoomDocument.findUnique({
        where: { id: dto.id },
        select: { filePath: true },
      });
      const updated = await this.prisma.dataRoomDocument.update({ where: { id: dto.id }, data: base });
      // Replacing the file leaves the old bytes orphaned on disk otherwise.
      if (stored && previous?.filePath && previous.filePath !== stored.path) {
        await this.storage.remove(previous.filePath);
      }
      return updated;
    }

    if (!stored) {
      throw new NotFoundException("A file is required when creating a document");
    }
    return this.prisma.dataRoomDocument.create({
      data: {
        ...base,
        fileName: stored.fileName,
        filePath: stored.path,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        createdBy: userId,
      },
    });
  }

  async deleteDocument(id: string) {
    const doc = await this.prisma.dataRoomDocument.findUnique({
      where: { id },
      select: { filePath: true },
    });
    if (!doc) return { ok: true };
    // Row first: an orphaned file is recoverable, a row pointing at nothing is not.
    await this.prisma.dataRoomDocument.delete({ where: { id } });
    await this.storage.remove(doc.filePath);
    return { ok: true };
  }
}
