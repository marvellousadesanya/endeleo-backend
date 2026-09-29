// Subscription, allocation and the cooling-off cancellation.
//
// The decisions that must not race — capacity, the concentration cap, moving units —
// happen inside Postgres procedures. This layer does the checks that are policy rather
// than integrity, and orchestrates the money rail around them.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/audit/audit.service";
import { NotificationsService } from "@/notifications/notifications.service";
import { naira } from "@/email/money-format";
import { PaymentAdapter } from "./adapters/payment.adapter";
import { toMinor } from "./dto/bonds.dto";

/** Investors get 48 hours to change their mind. */
const COOLING_OFF_HOURS = 48;

@Injectable()
export class SubscriptionsService {
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentAdapter,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.frontendUrl = config.getOrThrow<string>("FRONTEND_URL");
  }

  /** Escrow has become units: the holding is real and the cooling-off window has closed. */
  private async notifyAllocated(holding: { bond_id: string; user_id: string; units_minor: bigint }) {
    const bond = await this.prisma.bond.findUnique({
      where: { id: holding.bond_id },
      select: { title: true },
    });
    if (!bond) return;

    await this.notifications.notify({
      userId: holding.user_id,
      title: "Your units have been allocated",
      body: `${naira(holding.units_minor)} of ${bond.title} is now held in your name.`,
      href: "/dashboard/portfolio",
      email: {
        subject: `Units allocated — ${bond.title}`,
        bodyHtml:
          `<p><strong>${naira(holding.units_minor)}</strong> of <strong>${bond.title}</strong> ` +
          `has been allocated to you and is now held in your name.</p>` +
          `<p>Coupon payments will be paid to your Endeleo wallet on the bond's schedule, ` +
          `and your principal is returned at maturity.</p>`,
        ctaLabel: "View portfolio",
        ctaHref: `${this.frontendUrl}/dashboard/portfolio`,
      },
    });
  }

  async subscribe(bondId: string, amountRaw: string, user: { id: string; kycTier: number }) {
    const amountMinor = toMinor(amountRaw, "amountMinor");
    const bond = await this.prisma.bond.findUnique({ where: { id: bondId } });
    if (!bond) throw new NotFoundException("Bond not found");

    if (bond.status !== "open") throw new BadRequestException("This bond is not open for subscription");
    const now = new Date();
    if (bond.subscriptionOpenAt > now) throw new BadRequestException("Subscription has not opened yet");
    if (bond.subscriptionCloseAt < now) throw new BadRequestException("Subscription has closed");
    if (amountMinor < bond.minimumInvestmentMinor) {
      throw new BadRequestException(`Minimum investment is ${bond.minimumInvestmentMinor} minor units`);
    }

    if (user.kycTier < bond.kycTierRequired) {
      await this.audit.record({
        bondId, userId: user.id, event: "kyc_block",
        payload: { required: bond.kycTierRequired, held: user.kycTier },
      });
      throw new ForbiddenException(`This bond requires KYC tier ${bond.kycTierRequired}`);
    }

    const escrow = await this.payments.holdInEscrow({
      userId: user.id,
      amountMinor,
      currency: bond.currency,
      reference: `${bond.isinRef}:${user.id.slice(0, 8)}:${Date.now()}`,
    });
    if (!escrow.ok) throw new BadRequestException("Insufficient wallet balance for this subscription");

    const subscription = await this.prisma.subscription.create({
      data: {
        bondId,
        userId: user.id,
        amountMinor,
        escrowReference: escrow.escrowReference,
        coolingOffExpiresAt: new Date(Date.now() + COOLING_OFF_HOURS * 3600_000),
      },
    });

    await this.audit.recordMany([
      { bondId, userId: user.id, event: "subscription_created", payload: { subscriptionId: subscription.id, amountMinor: amountMinor.toString() } },
      { bondId, userId: user.id, event: "funds_escrowed", payload: { reference: escrow.escrowReference } },
    ]);

    // Committing money with no confirmation is the single most alarming thing a
    // platform can do. Fired after the audit entries, and deliberately not awaited:
    // the subscription is already durable, and a slow mail provider must not make the
    // investor think their money went nowhere.
    void this.notifications
      .notify({
        userId: user.id,
        title: "Subscription confirmed",
        body: `${naira(amountMinor)} committed to ${bond.title}.`,
        href: "/dashboard/portfolio",
        email: {
          subject: `Subscription confirmed — ${bond.title}`,
          bodyHtml:
            `<p>You have committed <strong>${naira(amountMinor)}</strong> to ` +
            `<strong>${bond.title}</strong>.</p>` +
            `<p>The funds are held in escrow, not yet invested. You have ` +
            `${COOLING_OFF_HOURS} hours to cancel for a full refund; after that your ` +
            `subscription is allocated into units and the holding becomes yours.</p>`,
          ctaLabel: "View portfolio",
          ctaHref: `${this.frontendUrl}/dashboard/portfolio`,
        },
      })
      .catch(() => {});

    return subscription;
  }

  /** Admin action. Capacity and the concentration cap are checked inside the procedure. */
  async allocate(subscriptionId: string, actorId: string) {
    try {
      const [holding] = await this.prisma.$queryRaw<
        { id: string; bond_id: string; user_id: string; units_minor: bigint }[]
      >`SELECT * FROM allocate_subscription(${subscriptionId}::uuid)`;

      // The moment escrow becomes a real holding — the investor now owns units rather
      // than having money set aside, and the cooling-off window is over.
      if (holding) void this.notifyAllocated(holding).catch(() => {});

      return holding;
    } catch (e) {
      throw mapProcedureError(e);
    }
  }

  /**
   * Cooling-off cancellation.
   *
   * The unwind — units back, raise corrected, subscription closed — happens in one
   * transaction inside the database. The refund follows, deliberately: if it fails the
   * investor is left with no units and their money still held, which is recoverable.
   * The other order would hand out free bonds.
   */
  async cancel(subscriptionId: string, user: { id: string; roles: string[] }) {
    const subscription = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException("Subscription not found");
    if (subscription.userId !== user.id && !user.roles.includes("admin")) {
      throw new ForbiddenException("Not your subscription");
    }

    let cancelled;
    try {
      const [row] = await this.prisma.$queryRaw<{ id: string; bond_id: string; escrow_reference: string | null; amount_minor: bigint }[]>`
        SELECT * FROM cancel_subscription(${subscriptionId}::uuid)`;
      cancelled = row;
    } catch (e) {
      throw mapProcedureError(e);
    }

    if (cancelled?.escrow_reference) {
      try {
        await this.payments.refundEscrow({
          userId: subscription.userId,
          amountMinor: cancelled.amount_minor,
          reference: cancelled.escrow_reference,
        });
        await this.audit.record({
          bondId: cancelled.bond_id, userId: subscription.userId, event: "funds_refunded",
          payload: { subscriptionId, amountMinor: cancelled.amount_minor.toString() },
        });
      } catch (e) {
        // The unwind stands. Flag the stuck refund rather than losing it silently.
        await this.audit.record({
          bondId: cancelled.bond_id, userId: subscription.userId, event: "funds_refunded",
          payload: { subscriptionId, failed: true, error: e instanceof Error ? e.message : String(e) },
        });
        throw new BadRequestException("Units were returned but the refund failed. Support has been notified.");
      }
    }
    return { ok: true };
  }

  mine(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      include: {
        bond: {
          select: {
            id: true, title: true, isinRef: true, currency: true, status: true,
            couponRateBps: true, couponFrequency: true, maturityDate: true,
            tenorMonths: true, projectSlug: true, spvReference: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  listForBond(bondId: string) {
    return this.prisma.subscription.findMany({
      where: { bondId },
      include: { user: { select: { id: true, email: true, fullName: true, kycTier: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
}

/**
 * The procedures raise named errors. Surface them as 400s with the reason intact
 * instead of leaking a Postgres stack trace as a 500.
 */
export function mapProcedureError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  const known = [
    "SUBSCRIPTION_NOT_FOUND", "SUBSCRIPTION_NOT_PENDING", "BOND_NOT_OPEN",
    "CAPACITY_EXCEEDED", "CONCENTRATION_LIMIT_EXCEEDED", "NOT_CANCELLABLE",
    "COOLING_OFF_EXPIRED", "HOLDING_PARTIALLY_SOLD", "HOLDING_LISTED_FOR_SALE",
    "INSUFFICIENT_UNITS_TO_REVERSE", "LISTING_NOT_FOUND", "LISTING_NOT_ACTIVE",
    "LISTING_EXPIRED", "UNITS_EXCEED_LISTING", "SELF_TRADE_FORBIDDEN",
    "BOND_NOT_TRADEABLE", "SELLER_INSUFFICIENT_UNITS", "UNITS_MUST_BE_POSITIVE",
  ];
  const match = known.find((code) => raw.includes(code));
  return match ? new BadRequestException(match) : (e as Error);
}
