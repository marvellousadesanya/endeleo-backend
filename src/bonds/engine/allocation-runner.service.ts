// Turns escrow into units once the 48-hour cooling-off is over — or gives it back.
//
// Investors are told that after cooling-off their "subscription is allocated into units
// and the holding becomes yours". Nothing did that: allocation was an admin-only endpoint
// no screen ever called, so every subscription sat pending with its money in escrow, and
// once the 48 hours passed the investor could not cancel either. This pass runs first in
// the hourly tick and keeps that promise.
//
// Oldest first, so when a bond is nearly full the earliest subscriber gets the room.
// A refused allocation is refunded: the bond filled, the investor would exceed the
// concentration cap, or the bond is no longer open. Anything else — the database
// unreachable, a bug — leaves the subscription pending for the next hour to retry.
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/audit/audit.service";
import { NotificationsService } from "@/notifications/notifications.service";
import { naira } from "@/email/money-format";
import { PaymentAdapter } from "../adapters/payment.adapter";
import { SubscriptionsService } from "../subscriptions.service";
import { refundEscrowAndRecord } from "../escrow-refund";

/** The procedure's refusals that mean "this will never allocate", so the money goes back. */
const REFUSALS = {
  CAPACITY_EXCEEDED: "the bond was fully subscribed before your allocation",
  CONCENTRATION_LIMIT_EXCEEDED: "it would have taken you past the most one investor may hold",
  BOND_NOT_OPEN: "the bond is no longer taking allocations",
} as const;
type Refusal = keyof typeof REFUSALS;

export interface AllocationSummary {
  allocated: string[];
  refunded: string[];
  /** Closed, but the wallet credit failed — recorded in the audit log for support. */
  refundFailed: string[];
  failures: { subscriptionId: string; error: string }[];
}

type DueSubscription = {
  id: string;
  bondId: string;
  userId: string;
  amountMinor: bigint;
  escrowReference: string | null;
};

@Injectable()
export class AllocationRunnerService {
  private readonly logger = new Logger(AllocationRunnerService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentAdapter,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionsService,
    config: ConfigService,
  ) {
    this.frontendUrl = config.getOrThrow<string>("FRONTEND_URL");
  }

  /** `asOf` lets the simulation harness run this at a pretend date. */
  async run(opts: { asOf?: string } = {}): Promise<AllocationSummary> {
    const now = opts.asOf ? new Date(`${opts.asOf}T23:59:59.999Z`) : new Date();
    const summary: AllocationSummary = { allocated: [], refunded: [], refundFailed: [], failures: [] };

    const due = await this.prisma.subscription.findMany({
      where: { status: "pending", coolingOffExpiresAt: { lte: now } },
      select: { id: true, bondId: true, userId: true, amountMinor: true, escrowReference: true },
      orderBy: { createdAt: "asc" },
    });

    for (const sub of due) {
      try {
        await this.subscriptions.allocate(sub.id);
        summary.allocated.push(sub.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Cancelled or allocated by someone else since the read: nothing left to do.
        if (message.includes("SUBSCRIPTION_NOT_PENDING")) continue;

        const refusal = (Object.keys(REFUSALS) as Refusal[]).find((code) => message.includes(code));
        if (!refusal) {
          summary.failures.push({ subscriptionId: sub.id, error: message });
          continue;
        }
        const outcome = await this.refund(sub, refusal);
        if (outcome === "refunded") summary.refunded.push(sub.id);
        if (outcome === "refund_failed") summary.refundFailed.push(sub.id);
      }
    }

    // One line per failure, with the reason. The procedure's own audit row rolls back with
    // the failed allocation, so this log is the only place the cause is recorded.
    for (const f of summary.failures) {
      this.logger.error(`allocation failed for subscription ${f.subscriptionId}; retrying next tick: ${f.error}`);
    }
    return summary;
  }

  /**
   * Nothing was allocated, so there are no units to unwind: close the subscription, then
   * return the escrow. The status-guarded update is the claim — two instances racing for
   * the same subscription cannot both refund it.
   */
  private async refund(sub: DueSubscription, reason: Refusal): Promise<"refunded" | "refund_failed" | "skipped"> {
    const { count } = await this.prisma.subscription.updateMany({
      where: { id: sub.id, status: "pending" },
      data: { status: "refunded", cancelledAt: new Date() },
    });
    if (count === 0) return "skipped";

    await this.audit.record({
      bondId: sub.bondId, userId: sub.userId, event: "subscription_cancelled",
      payload: { subscriptionId: sub.id, reason, allocationReversed: false },
    });

    if (sub.escrowReference) {
      const ok = await refundEscrowAndRecord(
        { payments: this.payments, audit: this.audit },
        {
          subscriptionId: sub.id,
          bondId: sub.bondId,
          userId: sub.userId,
          amountMinor: sub.amountMinor,
          reference: sub.escrowReference,
          reason,
        },
      );
      if (!ok) return "refund_failed";
    }

    void this.notifyRefunded(sub, reason).catch(() => {});
    return "refunded";
  }

  private async notifyRefunded(sub: DueSubscription, reason: Refusal) {
    const bond = await this.prisma.bond.findUnique({ where: { id: sub.bondId }, select: { title: true } });
    if (!bond) return;

    await this.notifications.notify({
      userId: sub.userId,
      title: "Your subscription has been refunded",
      body: `${naira(sub.amountMinor)} for ${bond.title} is back in your wallet.`,
      href: "/dashboard/wallet",
      email: {
        subject: `Subscription refunded — ${bond.title}`,
        bodyHtml:
          `<p>We could not allocate your <strong>${naira(sub.amountMinor)}</strong> subscription ` +
          `to <strong>${bond.title}</strong>, because ${REFUSALS[reason]}.</p>` +
          `<p>The full amount has been returned to your Endeleo wallet.</p>`,
        ctaLabel: "View wallet",
        ctaHref: `${this.frontendUrl}/dashboard/wallet`,
      },
    });
  }
}
