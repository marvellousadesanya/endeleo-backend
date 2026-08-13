// Secondary market: investors selling positions to each other.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/audit/audit.service";
import { toMinor } from "./dto/bonds.dto";
import { mapProcedureError } from "./subscriptions.service";

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createListing(dto: { bondId: string; unitsMinor: string; askPriceBps: number; expiresAt?: string }, sellerId: string) {
    const unitsMinor = toMinor(dto.unitsMinor, "unitsMinor");
    const holding = await this.prisma.holding.findUnique({
      where: { bondId_userId: { bondId: dto.bondId, userId: sellerId } },
    });
    if (!holding || holding.unitsMinor < unitsMinor) {
      throw new BadRequestException("You do not hold that many units");
    }

    // Units already promised to other open listings cannot be listed twice.
    const alreadyListed = await this.prisma.marketListing.aggregate({
      where: { bondId: dto.bondId, sellerId, status: "active" },
      _sum: { unitsMinor: true },
    });
    if ((alreadyListed._sum.unitsMinor ?? 0n) + unitsMinor > holding.unitsMinor) {
      throw new BadRequestException("That would list more units than you hold");
    }

    const listing = await this.prisma.marketListing.create({
      data: {
        bondId: dto.bondId,
        sellerId,
        unitsMinor,
        askPriceBps: dto.askPriceBps,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    await this.audit.record({
      bondId: dto.bondId, userId: sellerId, event: "listing_created",
      payload: { listingId: listing.id, unitsMinor: unitsMinor.toString(), askPriceBps: dto.askPriceBps },
    });
    return listing;
  }

  async cancelListing(listingId: string, user: { id: string; roles: string[] }) {
    const listing = await this.prisma.marketListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException("Listing not found");
    if (listing.sellerId !== user.id && !user.roles.includes("admin")) {
      throw new ForbiddenException("Not your listing");
    }
    if (listing.status !== "active") throw new BadRequestException("Listing is not active");

    await this.prisma.marketListing.update({
      where: { id: listingId },
      data: { status: "cancelled", cancelledAt: new Date() },
    });
    await this.audit.record({
      bondId: listing.bondId, userId: user.id, event: "listing_cancelled", payload: { listingId },
    });
    return { ok: true };
  }

  /** The trade itself is atomic in Postgres: units move, the register updates, the fee is taken. */
  async buy(listingId: string, unitsRaw: string, buyer: { id: string; kycTier: number }) {
    const units = toMinor(unitsRaw, "unitsMinor");
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      include: { bond: { select: { kycTierRequired: true } } },
    });
    if (!listing) throw new NotFoundException("Listing not found");
    if (buyer.kycTier < listing.bond.kycTierRequired) {
      throw new ForbiddenException(`This bond requires KYC tier ${listing.bond.kycTierRequired}`);
    }

    try {
      const [trade] = await this.prisma.$queryRaw<
        { id: string; units_minor: bigint; price_minor: bigint; fee_minor: bigint }[]
      >`SELECT * FROM execute_trade(${listingId}::uuid, ${buyer.id}::uuid, ${units}::bigint)`;
      return trade;
    } catch (e) {
      throw mapProcedureError(e);
    }
  }

  activeListings(bondId?: string) {
    return this.prisma.marketListing.findMany({
      where: { status: "active", ...(bondId ? { bondId } : {}) },
      include: { bond: { select: { id: true, title: true, isinRef: true, currency: true, couponRateBps: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  myTrades(userId: string) {
    return this.prisma.marketTrade.findMany({
      where: { OR: [{ sellerId: userId }, { buyerId: userId }] },
      include: { bond: { select: { title: true, isinRef: true, currency: true } } },
      orderBy: { executedAt: "desc" },
      take: 200,
    });
  }
}
