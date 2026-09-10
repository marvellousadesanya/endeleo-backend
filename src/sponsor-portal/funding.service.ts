// Funding: what's been raised and what's been released against it. The raise/escrow
// figures are real bond-engine numbers, not a separate ledger — this module only adds
// the milestone schedule on top. Sponsors watch; only admin releases a milestone, same
// as real disbursement always has a controller on the other side of it.
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/database/prisma.service";
import { NotificationsService } from "@/notifications/notifications.service";
import type { AuthUser } from "@/auth/jwt.strategy";
import type { CreateMilestoneDto, UpdateMilestoneDto } from "./dto/funding.dto";

// Minor units → a plain "1,234,567" string — good enough for an email line; the app's
// own fmtMinor (currency-aware, client-side) is what the dashboard itself uses.
function fmtMajor(minor: bigint): string {
  return (Number(minor) / 100).toLocaleString();
}

@Injectable()
export class FundingService {
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

  async overviewForSponsor(user: AuthUser, bondId: string) {
    await this.assertOwnsBond(user, bondId);
    const [bond, escrows, milestones] = await Promise.all([
      this.prisma.bond.findUnique({
        where: { id: bondId },
        select: { totalSizeMinor: true, raisedMinor: true, currency: true },
      }),
      this.prisma.escrowAccount.findMany({ where: { bondId } }),
      this.prisma.fundingMilestone.findMany({
        where: { bondId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    if (!bond) throw new NotFoundException("Bond not found");

    const releasedMinor = milestones
      .filter((m) => m.status === "released")
      .reduce((sum, m) => sum + m.targetMinor, BigInt(0));

    return { bond, escrows, milestones, releasedMinor };
  }

  createMilestone(dto: CreateMilestoneDto) {
    return this.prisma.fundingMilestone.create({
      data: {
        bondId: dto.bondId,
        label: dto.label,
        targetMinor: BigInt(dto.targetMinor),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes ?? null,
      },
    });
  }

  async updateMilestone(id: string, dto: UpdateMilestoneDto) {
    const existing = await this.prisma.fundingMilestone.findUnique({
      where: { id },
      include: { bond: { select: { title: true, issuerId: true, currency: true } } },
    });
    if (!existing) throw new NotFoundException("Milestone not found");
    const releasing = dto.status === "released" && existing.status !== "released";

    const updated = await this.prisma.fundingMilestone.update({
      where: { id },
      data: {
        label: dto.label,
        targetMinor: dto.targetMinor !== undefined ? BigInt(dto.targetMinor) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status,
        notes: dto.notes,
        ...(releasing ? { releasedAt: new Date() } : {}),
      },
    });

    if (releasing) {
      await this.notifications.notify({
        userId: existing.bond.issuerId,
        title: "Funding milestone released",
        body: `${existing.bond.currency} ${fmtMajor(updated.targetMinor)} for "${updated.label}" on ${existing.bond.title} has been released.`,
        href: "/sponsor/funding",
        email: {
          subject: `Released: ${updated.label}`,
          bodyHtml: `<p><strong>${existing.bond.title}</strong> — <strong>${existing.bond.currency} ${fmtMajor(updated.targetMinor)}</strong> for "${updated.label}" has been released.</p>`,
          ctaLabel: "View funding",
          ctaHref: `${this.frontendUrl}/sponsor/funding`,
        },
      });
    }

    return updated;
  }

  listForAdmin(bondId?: string) {
    return this.prisma.fundingMilestone.findMany({
      where: bondId ? { bondId } : undefined,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async deleteMilestone(id: string) {
    await this.prisma.fundingMilestone.delete({ where: { id } });
    return { ok: true };
  }
}
