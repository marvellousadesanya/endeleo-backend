// Compliance (KYB) and due-diligence checklists — the same shape either way, just a
// different `kind` and grouping. Admin seeds the items for a bond; the sponsor moves
// their own items forward (in_progress → submitted); only admin can verify or reject.
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import type { AuthUser } from "@/auth/jwt.strategy";
import type {
  AdminUpdateChecklistItemDto,
  CreateChecklistItemDto,
  SponsorUpdateChecklistItemDto,
} from "./dto/checklist.dto";

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

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
    const item = await this.prisma.sponsorChecklistItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Checklist item not found");
    const verifying = dto.status === "verified" || dto.status === "rejected";
    return this.prisma.sponsorChecklistItem.update({
      where: { id },
      data: {
        status: dto.status,
        notes: dto.notes,
        label: dto.label,
        area: dto.area,
        ...(verifying ? { verifiedBy: adminId, verifiedAt: new Date() } : {}),
      },
    });
  }

  async deleteItem(id: string) {
    await this.prisma.sponsorChecklistItem.delete({ where: { id } });
    return { ok: true };
  }
}
