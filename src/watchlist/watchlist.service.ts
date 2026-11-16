// Watchlist: bonds an investor has starred. Deliberately just the pairing — the client
// already holds the full bond list (GET /bonds), so this hands back ids and the UI
// filters, rather than this endpoint growing its own copy of how a bond is presented.
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";

@Injectable()
export class WatchlistService {
  constructor(private readonly prisma: PrismaService) {}

  /** Starred bond ids, most recently starred first. */
  async bondIds(userId: string): Promise<{ bondIds: string[] }> {
    const rows = await this.prisma.watchlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { bondId: true },
    });
    return { bondIds: rows.map((r) => r.bondId) };
  }

  /**
   * Idempotent: starring an already-starred bond is a no-op. A draft bond answers 404
   * exactly like a missing one — an investor shouldn't learn an unpublished bond exists
   * by trying to watch it.
   */
  async add(userId: string, bondId: string): Promise<{ bondId: string; watching: true }> {
    const bond = await this.prisma.bond.findUnique({
      where: { id: bondId },
      select: { status: true },
    });
    if (!bond || bond.status === "draft") throw new NotFoundException("Bond not found");

    await this.prisma.watchlistItem.upsert({
      where: { userId_bondId: { userId, bondId } },
      create: { userId, bondId },
      update: {},
    });
    return { bondId, watching: true };
  }

  /** Idempotent: unstarring something not starred is a no-op, not a 404. */
  async remove(userId: string, bondId: string): Promise<{ bondId: string; watching: false }> {
    await this.prisma.watchlistItem.deleteMany({ where: { userId, bondId } });
    return { bondId, watching: false };
  }
}
