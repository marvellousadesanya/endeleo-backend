// Real performance numbers for a sponsor's own bonds — raised, subscriber count,
// average ticket, coupons paid out, and a month-by-month raise curve. All derived from
// the same Subscription/CouponPayment rows the bond engine and investor dashboard use;
// nothing here is a separate tracked metric.
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import type { AuthUser } from "@/auth/jwt.strategy";

@Injectable()
export class SponsorAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async forSponsor(user: AuthUser) {
    const bonds = await this.prisma.bond.findMany({
      where: { issuerId: user.id },
      select: {
        id: true, title: true, status: true, currency: true,
        totalSizeMinor: true, raisedMinor: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const bondIds = bonds.map((b) => b.id);
    if (bondIds.length === 0) {
      return { bonds: [], totalRaisedMinor: "0", subscriberCount: 0, avgTicketMinor: "0",
        couponsPaidMinor: "0", raiseCurve: [] };
    }

    const [allocated, couponSum] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { bondId: { in: bondIds }, status: "allocated" },
        select: { bondId: true, userId: true, amountMinor: true, allocatedAt: true, createdAt: true },
      }),
      this.prisma.couponPayment.aggregate({
        where: { bondId: { in: bondIds }, status: "paid" },
        _sum: { netMinor: true },
      }),
    ]);

    const totalRaisedMinor = allocated.reduce((sum, s) => sum + s.amountMinor, BigInt(0));
    const subscriberIds = new Set(allocated.map((s) => s.userId));
    const avgTicketMinor = allocated.length
      ? totalRaisedMinor / BigInt(allocated.length)
      : BigInt(0);

    // Month-by-month, oldest first — the shape a raise curve chart wants.
    const byMonth = new Map<string, bigint>();
    for (const s of allocated) {
      const when = s.allocatedAt ?? s.createdAt;
      const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) ?? BigInt(0)) + s.amountMinor);
    }
    const raiseCurve = [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, amountMinor]) => ({ month, amountMinor: amountMinor.toString() }));

    const perBond = bonds.map((b) => {
      const rows = allocated.filter((s) => s.bondId === b.id);
      return {
        id: b.id,
        title: b.title,
        status: b.status,
        currency: b.currency,
        totalSizeMinor: b.totalSizeMinor.toString(),
        raisedMinor: b.raisedMinor.toString(),
        subscriberCount: new Set(rows.map((r) => r.userId)).size,
      };
    });

    return {
      bonds: perBond,
      totalRaisedMinor: totalRaisedMinor.toString(),
      subscriberCount: subscriberIds.size,
      avgTicketMinor: avgTicketMinor.toString(),
      couponsPaidMinor: (couponSum._sum.netMinor ?? BigInt(0)).toString(),
      raiseCurve,
    };
  }
}
