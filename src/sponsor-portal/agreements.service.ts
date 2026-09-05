// Legal documents a sponsor must sign — NDA, mandate letter, term sheet... Admin
// uploads and sends one; the sponsor signs it, on the record, same trust model as the
// investor data room's signature wall.
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { StorageService } from "@/storage/storage.service";
import type { AuthUser } from "@/auth/jwt.strategy";
import type { SignAgreementDto, UpsertAgreementDto } from "./dto/agreements.dto";

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async assertOwnsBond(user: AuthUser, bondId: string) {
    if (user.roles.includes("admin")) return;
    const bond = await this.prisma.bond.findUnique({ where: { id: bondId }, select: { issuerId: true } });
    if (!bond) throw new NotFoundException("Bond not found");
    if (bond.issuerId !== user.id) throw new ForbiddenException("Not your bond");
  }

  async listForSponsor(user: AuthUser, bondId: string) {
    await this.assertOwnsBond(user, bondId);
    const rows = await this.prisma.sponsorAgreement.findMany({
      where: { bondId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    // The stored path is never handed to the client — downloads go through a token.
    return rows.map(({ filePath: _filePath, ...row }) => row);
  }

  listForAdmin(bondId?: string) {
    return this.prisma.sponsorAgreement.findMany({
      where: bondId ? { bondId } : undefined,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async createDownloadToken(user: AuthUser, id: string) {
    const doc = await this.prisma.sponsorAgreement.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException("Agreement not found");
    await this.assertOwnsBond(user, doc.bondId);
    if (!doc.filePath) throw new NotFoundException("No file attached to this agreement yet");

    const url = await this.storage.getDownloadUrl(doc.filePath, {
      fileName: doc.fileName ?? doc.title,
      mimeType: doc.mimeType ?? "application/octet-stream",
    });
    return { url, mimeType: doc.mimeType };
  }

  /** Signing sets status straight to signed — there's no separate "countersigned" step. */
  async sign(user: AuthUser, dto: SignAgreementDto) {
    const doc = await this.prisma.sponsorAgreement.findUnique({ where: { id: dto.id } });
    if (!doc) throw new NotFoundException("Agreement not found");
    await this.assertOwnsBond(user, doc.bondId);
    if (doc.status === "signed") return doc;

    return this.prisma.sponsorAgreement.update({
      where: { id: dto.id },
      data: { status: "signed", signedAt: new Date(), signedName: dto.signedName, signedBy: user.id },
    });
  }

  async upsert(dto: UpsertAgreementDto, file?: Express.Multer.File) {
    let stored: { path: string; fileName: string; mimeType: string } | null = null;
    if (file) {
      stored = await this.storage.put(
        "sponsor-agreements",
        file.originalname,
        file.mimetype || "application/octet-stream",
        file.buffer,
      );
    }

    const base = {
      bondId: dto.bondId,
      title: dto.title,
      category: dto.category ?? "general",
      status: dto.status,
      sortOrder: dto.sortOrder ?? 0,
      ...(dto.status === "sent" ? { sentAt: new Date() } : {}),
      ...(stored ? { fileName: stored.fileName, filePath: stored.path, mimeType: stored.mimeType } : {}),
    };

    if (dto.id) {
      const previous = await this.prisma.sponsorAgreement.findUnique({
        where: { id: dto.id },
        select: { filePath: true },
      });
      const updated = await this.prisma.sponsorAgreement.update({ where: { id: dto.id }, data: base });
      if (stored && previous?.filePath && previous.filePath !== stored.path) {
        await this.storage.remove(previous.filePath);
      }
      return updated;
    }

    return this.prisma.sponsorAgreement.create({ data: base });
  }

  async delete(id: string) {
    const doc = await this.prisma.sponsorAgreement.findUnique({ where: { id }, select: { filePath: true } });
    if (!doc) return { ok: true };
    await this.prisma.sponsorAgreement.delete({ where: { id } });
    if (doc.filePath) await this.storage.remove(doc.filePath);
    return { ok: true };
  }
}
