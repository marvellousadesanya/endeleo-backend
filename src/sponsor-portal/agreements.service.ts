// Legal documents a sponsor must sign — NDA, mandate letter, term sheet... Admin
// uploads and sends one; the sponsor signs it, on the record, same trust model as the
// investor data room's signature wall.
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/database/prisma.service";
import { StorageService } from "@/storage/storage.service";
import { NotificationsService } from "@/notifications/notifications.service";
import type { AuthUser } from "@/auth/jwt.strategy";
import type { SignAgreementDto, UpsertAgreementDto } from "./dto/agreements.dto";

@Injectable()
export class AgreementsService {
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.frontendUrl = config.getOrThrow<string>("FRONTEND_URL");
  }

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
    const doc = await this.prisma.sponsorAgreement.findUnique({
      where: { id: dto.id },
      include: { bond: { select: { title: true } } },
    });
    if (!doc) throw new NotFoundException("Agreement not found");
    await this.assertOwnsBond(user, doc.bondId);
    if (doc.status === "signed") return doc;

    const signed = await this.prisma.sponsorAgreement.update({
      where: { id: dto.id },
      data: { status: "signed", signedAt: new Date(), signedName: dto.signedName, signedBy: user.id },
    });

    await this.notifications.notify({
      userId: user.id,
      title: "Agreement signed",
      body: `You signed "${doc.title}" on ${doc.bond.title} as ${dto.signedName}.`,
      href: "/sponsor/agreements",
      email: {
        subject: `You signed ${doc.title}`,
        bodyHtml: `<p>This confirms you signed <strong>"${doc.title}"</strong> on ${doc.bond.title} as <strong>${dto.signedName}</strong> on ${new Date().toLocaleDateString()}. Keep this email for your records.</p>`,
      },
    });

    return signed;
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
        select: { filePath: true, status: true, bond: { select: { title: true, issuerId: true } } },
      });
      const updated = await this.prisma.sponsorAgreement.update({ where: { id: dto.id }, data: base });
      if (stored && previous?.filePath && previous.filePath !== stored.path) {
        await this.storage.remove(previous.filePath);
      }
      if (dto.status === "sent" && previous?.status !== "sent" && previous?.bond) {
        await this.notifications.notify({
          userId: previous.bond.issuerId,
          title: "New agreement to sign",
          body: `"${updated.title}" on ${previous.bond.title} is ready for your signature.`,
          href: "/sponsor/agreements",
          email: {
            subject: `Please sign: ${updated.title}`,
            bodyHtml: `<p><strong>${previous.bond.title}</strong> — "${updated.title}" has been sent and is ready for your signature.</p>`,
            ctaLabel: "Review and sign",
            ctaHref: `${this.frontendUrl}/sponsor/agreements`,
          },
        });
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
