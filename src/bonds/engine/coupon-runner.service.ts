// Coupon disbursement.
//
// Three passes, deliberately separate:
//   1. materialise — work out what is owed for every schedule that has come due
//   2. attempt     — try to pay everything outstanding, wherever it came from
//   3. close       — mark a schedule finished only once nothing is left owing
//
// Keeping "attempt" independent of "due schedules" is what makes retries work. In the
// original engine a failed payment was marked for retry and then never looked at again,
// because its schedule had already been closed.
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/audit/audit.service";
import { PaymentAdapter } from "../adapters/payment.adapter";
import { NotificationAdapter } from "../adapters/notification.adapter";
import { accruePeriod, type HoldingDelta } from "./accrual";
import { toDateOnly } from "./schedule";
import { WHT_BPS } from "./money";

/** Attempts allowed before a human has to look at it. The spec says three. */
export const MAX_ATTEMPTS = 3;

export interface CouponRunSummary {
  created: number;
  paid: number;
  failed: number;
  escalated: number;
  schedulesClosed: number;
}

@Injectable()
export class CouponRunnerService {
  private readonly logger = new Logger(CouponRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentAdapter,
    private readonly notifications: NotificationAdapter,
  ) {}

  async run(asOf?: string): Promise<CouponRunSummary> {
    const today = asOf ? new Date(`${asOf}T00:00:00Z`) : new Date();
    const created = await this.materialise(today);
    const { paid, failed, escalated } = await this.attemptOutstanding();
    const schedulesClosed = await this.closeSettledSchedules(today);
    return { created, paid, failed, escalated, schedulesClosed };
  }

  /**
   * Everything that has moved units on this bond, as dated deltas, plus today's
   * register. Together these let the accrual maths reconstruct who held what, when.
   * Covers all three things that move units: allocation, cooling-off reversal, and trades.
   */
  private async loadPositionHistory(bondId: string) {
    const [holdings, subscriptions, trades] = await Promise.all([
      this.prisma.holding.findMany({ where: { bondId }, select: { userId: true, unitsMinor: true } }),
      this.prisma.subscription.findMany({
        where: { bondId, allocatedAt: { not: null } },
        select: { userId: true, amountMinor: true, status: true, allocatedAt: true, cancelledAt: true },
      }),
      this.prisma.marketTrade.findMany({
        where: { bondId },
        select: { sellerId: true, buyerId: true, unitsMinor: true, tradeDate: true },
      }),
    ]);

    const currentBalances = new Map(holdings.map((h) => [h.userId, h.unitsMinor]));
    const deltas: HoldingDelta[] = [];

    for (const s of subscriptions) {
      deltas.push({ date: toDateOnly(s.allocatedAt!), userId: s.userId, deltaMinor: s.amountMinor });
      if (s.status === "cancelled" && s.cancelledAt) {
        deltas.push({ date: toDateOnly(s.cancelledAt), userId: s.userId, deltaMinor: -s.amountMinor });
      }
    }
    for (const t of trades) {
      const date = toDateOnly(t.tradeDate);
      deltas.push({ date, userId: t.sellerId, deltaMinor: -t.unitsMinor });
      deltas.push({ date, userId: t.buyerId, deltaMinor: t.unitsMinor });
    }
    return { currentBalances, deltas };
  }

  /** Pass 1 — create the payment rows owed for schedules that have come due. */
  private async materialise(today: Date): Promise<number> {
    const due = await this.prisma.couponSchedule.findMany({
      // Only a live bond accrues payable interest. A defaulted bond stops servicing
      // its coupons: the outstanding amounts become part of the recovery, not a
      // scheduled payment. A matured or closed bond has nothing left to accrue.
      where: { scheduledPayDate: { lte: today }, processedAt: null, bond: { status: "active" } },
      include: { bond: true },
      take: 50,
    });

    let created = 0;
    for (const schedule of due) {
      const { currentBalances, deltas } = await this.loadPositionHistory(schedule.bondId);
      const accruals = accruePeriod({
        periodStart: toDateOnly(schedule.periodStart),
        periodEnd: toDateOnly(schedule.periodEnd),
        currentBalances,
        deltas,
        couponRateBps: schedule.bond.couponRateBps,
      });

      const rows = accruals.filter((a) => a.grossMinor > 0n).map((a) => ({
        scheduleId: schedule.id,
        bondId: schedule.bondId,
        userId: a.userId,
        unitDays: a.unitDays,
        daysHeld: a.daysHeld,
        closingUnitsMinor: a.closingUnitsMinor,
        grossMinor: a.grossMinor,
        whtMinor: a.whtMinor,
        netMinor: a.netMinor,
      }));
      if (rows.length === 0) continue;

      // skipDuplicates → never overwrite an existing row. A plain upsert would reset an
      // already-paid coupon to pending and pay it a second time.
      const result = await this.prisma.couponPayment.createMany({ data: rows, skipDuplicates: true });
      created += result.count;
    }
    return created;
  }

  /**
   * Claim a payment for this run.
   *
   * `attempts` doubles as an optimistic-concurrency version: the update only matches if
   * the row is still outstanding and nobody else has incremented it since we read it.
   * Two overlapping runs therefore cannot both pay the same coupon.
   */
  private async claim(id: string, attempts: number): Promise<boolean> {
    const { count } = await this.prisma.couponPayment.updateMany({
      where: { id, attempts, status: { in: ["pending", "retry"] } },
      data: { attempts: attempts + 1 },
    });
    return count === 1;
  }

  /** Pass 2 — attempt every outstanding payment, including previously failed ones. */
  private async attemptOutstanding() {
    const outstanding = await this.prisma.couponPayment.findMany({
      // Excludes defaulted bonds. Rows raised before the default are suspended by the
      // redemption runner, but this is the belt to that braces: no path disburses
      // interest on a bond that has failed to fund its principal.
      where: {
        status: { in: ["pending", "retry"] },
        attempts: { lt: MAX_ATTEMPTS },
        bond: { status: { not: "defaulted" } },
      },
      include: { bond: true, schedule: { select: { periodIndex: true, periodEnd: true } } },
      take: 500,
    });

    let paid = 0, failed = 0, escalated = 0;

    for (const payment of outstanding) {
      if (!(await this.claim(payment.id, payment.attempts))) continue;
      const attempt = payment.attempts + 1;

      const fail = async (message: string) => {
        const terminal = attempt >= MAX_ATTEMPTS;
        await this.prisma.couponPayment.update({
          where: { id: payment.id },
          data: { status: terminal ? "escalated" : "retry", lastError: message },
        });
        await this.audit.record({
          bondId: payment.bondId, userId: payment.userId, event: "coupon_failed",
          payload: { paymentId: payment.id, attempt, escalated: terminal, error: message },
        });
        terminal ? escalated++ : failed++;
      };

      try {
        const result = await this.payments.disburse({
          userId: payment.userId,
          amountMinor: payment.netMinor,
          currency: payment.bond.currency,
          note: `Coupon ${payment.bond.isinRef} period ${payment.schedule.periodIndex}`,
        });

        // A provider that reports failure without throwing is still a failure. The
        // original treated this path as "retry" but never counted the attempt, so it
        // could never escalate.
        if (!result.ok) {
          await fail(result.error ?? "provider reported failure");
          continue;
        }

        await this.prisma.$transaction([
          this.prisma.couponPayment.update({
            where: { id: payment.id },
            data: { status: "paid", providerRef: result.providerRef, paidAt: new Date() },
          }),
          this.prisma.taxRecord.create({
            data: {
              bondId: payment.bondId,
              userId: payment.userId,
              couponPaymentId: payment.id,
              taxYear: payment.schedule.periodEnd.getUTCFullYear(),
              grossMinor: payment.grossMinor,
              whtMinor: payment.whtMinor,
              whtRateBps: WHT_BPS,
              currency: payment.bond.currency,
            },
          }),
        ]);

        await this.notifications.send({
          userId: payment.userId, template: "coupon_paid",
          data: { bond: payment.bond.title, netMinor: payment.netMinor.toString() },
        });
        await this.audit.record({
          bondId: payment.bondId, userId: payment.userId, event: "coupon_paid",
          payload: { paymentId: payment.id, gross: payment.grossMinor.toString(), wht: payment.whtMinor.toString(), attempt },
        });
        paid++;
      } catch (e) {
        await fail(e instanceof Error ? e.message : String(e));
      }
    }
    return { paid, failed, escalated };
  }

  /**
   * Pass 3 — close schedules with nothing left owing.
   * Escalated payments do not block closure: they have exhausted their retries and need
   * a person, not another sweep.
   */
  private async closeSettledSchedules(today: Date): Promise<number> {
    const open = await this.prisma.couponSchedule.findMany({
      where: { scheduledPayDate: { lte: today }, processedAt: null },
      select: { id: true },
      take: 50,
    });

    let closed = 0;
    for (const schedule of open) {
      const outstanding = await this.prisma.couponPayment.count({
        where: { scheduleId: schedule.id, status: { in: ["pending", "retry"] } },
      });
      if (outstanding > 0) continue;
      await this.prisma.couponSchedule.update({ where: { id: schedule.id }, data: { processedAt: new Date() } });
      closed++;
    }
    return closed;
  }
}
