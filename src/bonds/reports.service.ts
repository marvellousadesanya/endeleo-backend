// Statements and regulatory extracts.
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { toMinor } from "./dto/bonds.dto";
import { AuditService } from "@/audit/audit.service";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** An investor's own statement: what they hold, what they were paid, what was withheld. */
  async investorStatement(userId: string, period: "month" | "year") {
    const since = new Date();
    period === "month"
      ? since.setUTCMonth(since.getUTCMonth() - 1)
      : since.setUTCFullYear(since.getUTCFullYear() - 1);

    const [holdings, coupons, tax] = await Promise.all([
      this.prisma.holding.findMany({
        where: { userId, unitsMinor: { gt: 0n } },
        include: { bond: { select: { title: true, isinRef: true, currency: true, couponRateBps: true, maturityDate: true } } },
      }),
      this.prisma.couponPayment.findMany({
        where: { userId, createdAt: { gte: since } },
        include: { bond: { select: { title: true, isinRef: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.taxRecord.findMany({ where: { userId, recordedAt: { gte: since } } }),
    ]);

    const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
    return {
      generatedAt: new Date().toISOString(),
      period,
      holdings,
      coupons,
      totals: {
        grossCouponMinor: sum(coupons.map((c) => c.grossMinor)),
        whtMinor: sum(tax.map((t) => t.whtMinor)),
        netCouponMinor: sum(coupons.map((c) => c.netMinor)),
      },
    };
  }

  /** Weekly trustee view: what is held in escrow, and what moved recently. */
  async escrowLedger() {
    const [accounts, recentDeposits] = await Promise.all([
      this.prisma.escrowAccount.findMany({
        include: { bond: { select: { title: true, isinRef: true, status: true, totalSizeMinor: true } } },
      }),
      this.prisma.bondAuditEntry.findMany({
        where: { event: "escrow_deposit", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { generatedAt: new Date().toISOString(), accounts, recentDeposits };
  }

  /** FIRS extract: withholding tax by investor for a tax year. */
  async taxReport(taxYear: number) {
    const records = await this.prisma.taxRecord.findMany({
      where: { taxYear },
      include: {
        bond: { select: { title: true, isinRef: true, spvReference: true } },
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
    return {
      generatedAt: new Date().toISOString(),
      taxYear,
      records,
      totalWhtMinor: records.reduce((a, r) => a + r.whtMinor, 0n),
    };
  }

  /** Record trustee-confirmed funds against a bond. */
  async recordEscrowDeposit(dto: { bondId: string; purpose: "coupon" | "principal" | "default_reserve"; amountMinor: string }, actorId: string) {
    const amount = toMinor(dto.amountMinor, "amountMinor");
    const bond = await this.prisma.bond.findUnique({ where: { id: dto.bondId }, select: { currency: true } });
    if (!bond) throw new NotFoundException("Bond not found");

    const account = await this.prisma.escrowAccount.upsert({
      where: { bondId_purpose: { bondId: dto.bondId, purpose: dto.purpose } },
      update: { balanceMinor: { increment: amount }, lastVerifiedAt: new Date() },
      create: { bondId: dto.bondId, purpose: dto.purpose, balanceMinor: amount, currency: bond.currency, lastVerifiedAt: new Date() },
    });

    await this.audit.record({
      bondId: dto.bondId, userId: actorId, event: "escrow_deposit",
      payload: { purpose: dto.purpose, amountMinor: amount.toString(), balanceMinor: account.balanceMinor.toString() },
    });
    return account;
  }

  /** The immutable trail for one bond. Admin and issuer only. */
  async auditTrail(bondId: string, viewer: { id: string; roles: string[] }) {
    const bond = await this.prisma.bond.findUnique({ where: { id: bondId }, select: { issuerId: true } });
    if (!bond) throw new NotFoundException("Bond not found");
    if (!viewer.roles.includes("admin") && bond.issuerId !== viewer.id) {
      throw new ForbiddenException("Not your bond");
    }
    return this.prisma.bondAuditEntry.findMany({
      where: { bondId }, orderBy: { id: "asc" }, take: 1000,
    });
  }

  myCoupons(userId: string) {
    return this.prisma.couponPayment.findMany({
      where: { userId },
      include: { bond: { select: { title: true, isinRef: true, currency: true } }, schedule: { select: { periodIndex: true, periodStart: true, periodEnd: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
}
