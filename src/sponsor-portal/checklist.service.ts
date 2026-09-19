// Compliance (KYB) and due-diligence checklists — the same shape either way, just a
// different `kind` and grouping. Admin seeds the items for a bond; the sponsor moves
// their own items forward (in_progress → submitted); only admin can verify or reject.
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/database/prisma.service";
import { NotificationsService } from "@/notifications/notifications.service";
import type { AuthUser } from "@/auth/jwt.strategy";
import type {
  AdminUpdateChecklistItemDto,
  CreateChecklistItemDto,
  SponsorUpdateChecklistItemDto,
} from "./dto/checklist.dto";

@Injectable()
export class ChecklistService {
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
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

  async listForSponsor(user: AuthUser, bondId: string, kind?: "compliance" | "due_diligence") {
    await this.assertOwnsBond(user, bondId);
    return this.prisma.sponsorChecklistItem.findMany({
      where: { bondId, kind },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  listForAdmin(bondId?: string, kind?: "compliance" | "due_diligence") {
    return this.prisma.sponsorChecklistItem.findMany({
      where: { bondId, kind },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  /**
   * M6's "Completeness Checker" — how much of a bond's compliance and due-diligence
   * set (the SEC filing items included, since M6 extended this same list rather than
   * keeping a separate one) is actually verified, and which labels are still
   * outstanding. No NLP query prediction, no cross-reference validation against a
   * Trust Deed — just a count, same as everything else built deterministic-first.
   */
  async completeness(bondId: string) {
    const items = await this.prisma.sponsorChecklistItem.findMany({
      where: { bondId },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
      select: { kind: true, area: true, label: true, status: true },
    });

    const total = items.length;
    const verified = items.filter((i) => i.status === "verified").length;
    const outstanding = items
      .filter((i) => i.status !== "verified")
      .map((i) => ({ kind: i.kind, area: i.area, label: i.label, status: i.status }));

    return {
      bondId,
      total,
      verified,
      completionPct: total === 0 ? 0 : Math.round((verified / total) * 1000) / 10,
      outstanding,
    };
  }

  createItem(dto: CreateChecklistItemDto) {
    return this.prisma.sponsorChecklistItem.create({
      data: {
        bondId: dto.bondId,
        kind: dto.kind,
        area: dto.area ?? null,
        label: dto.label,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  /** Sponsor can move their own item forward and attach notes — nothing else. */
  async updateAsSponsor(user: AuthUser, id: string, dto: SponsorUpdateChecklistItemDto) {
    const item = await this.prisma.sponsorChecklistItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Checklist item not found");
    await this.assertOwnsBond(user, item.bondId);
    // A rejected item needs admin's eyes again before it can move — sponsor resubmits
    // by going back to in_progress, never straight past a rejection to submitted twice.
    if (item.status === "verified") {
      throw new ForbiddenException("This item is already verified");
    }
    return this.prisma.sponsorChecklistItem.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes },
    });
  }

  async updateAsAdmin(id: string, dto: AdminUpdateChecklistItemDto, adminId: string) {
    const item = await this.prisma.sponsorChecklistItem.findUnique({
      where: { id },
      include: { bond: { select: { title: true, issuerId: true } } },
    });
    if (!item) throw new NotFoundException("Checklist item not found");
    const verifying = dto.status === "verified" || dto.status === "rejected";
    const updated = await this.prisma.sponsorChecklistItem.update({
      where: { id },
      data: {
        status: dto.status,
        notes: dto.notes,
        label: dto.label,
        area: dto.area,
        ...(verifying ? { verifiedBy: adminId, verifiedAt: new Date() } : {}),
      },
    });

    if (dto.status === "verified") {
      const kindLabel = item.kind === "compliance" ? "Compliance" : "Due diligence";
      await this.notifications.notify({
        userId: item.bond.issuerId,
        title: `${kindLabel} item verified`,
        body: `"${item.label}" on ${item.bond.title} has been verified.`,
        href: `/sponsor/${item.kind === "compliance" ? "compliance" : "due-diligence"}`,
        email: {
          subject: `Verified: ${item.label}`,
          bodyHtml: `<p><strong>${item.bond.title}</strong> — "${item.label}" has been verified. No further action needed on this item.</p>`,
          ctaLabel: "View checklist",
          ctaHref: `${this.frontendUrl}/sponsor/${item.kind === "compliance" ? "compliance" : "due-diligence"}`,
        },
      });
    } else if (dto.status === "rejected") {
      const kindLabel = item.kind === "compliance" ? "Compliance" : "Due diligence";
      await this.notifications.notify({
        userId: item.bond.issuerId,
        title: `${kindLabel} item needs attention`,
        body: `"${item.label}" on ${item.bond.title} was rejected${dto.notes ? `: ${dto.notes}` : "."}`,
        href: `/sponsor/${item.kind === "compliance" ? "compliance" : "due-diligence"}`,
        email: {
          subject: `Action needed: ${item.label}`,
          bodyHtml: `<p><strong>${item.bond.title}</strong> — "${item.label}" was rejected and needs another look.</p>${dto.notes ? `<p style="color:#8a4b1c;background:#fdf3e7;border-radius:8px;padding:10px 14px;">${dto.notes}</p>` : ""}`,
          ctaLabel: "Review and resubmit",
          ctaHref: `${this.frontendUrl}/sponsor/${item.kind === "compliance" ? "compliance" : "due-diligence"}`,
        },
      });
    }

    return updated;
  }

  async deleteItem(id: string) {
    await this.prisma.sponsorChecklistItem.delete({ where: { id } });
    return { ok: true };
  }
}
