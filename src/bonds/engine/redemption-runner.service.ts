// Maturity, and the default protocol.
//
// A bond's ending is a countdown, not a single day. The point of the checkpoints is
// that nobody discovers a funding problem on the day the money is owed: T-30 verifies
// the cash exists a month early, leaving time to act.
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/audit/audit.service";
import { PaymentAdapter } from "../adapters/payment.adapter";
import { NotificationAdapter } from "../adapters/notification.adapter";

export interface RedemptionRunSummary {
  processed: number;
  defaulted: string[];
  principalPaid: number;
  failures: { eventId: string; error: string }[];
}

@Injectable()
export class RedemptionRunnerService {
  private readonly logger = new Logger(RedemptionRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentAdapter,
    private readonly notifications: NotificationAdapter,
  ) {}

  async run(asOf?: string): Promise<RedemptionRunSummary> {
    const today = asOf ? new Date(`${asOf}T00:00:00Z`) : new Date();
    const summary: RedemptionRunSummary = { processed: 0, defaulted: [], principalPaid: 0, failures: [] };

    const due = await this.prisma.redemptionEvent.findMany({
      where: { scheduledFor: { lte: today }, executedAt: null },
      include: { bond: true },
      orderBy: { scheduledFor: "asc" },
    });

    for (const event of due) {
      try {
        switch (event.stage) {
          case "t_minus_90":
            await this.notifyIssuerToFund(event.bondId, event.bond.issuerId, event.bond.isinRef);
            break;
          case "t_minus_30":
            if (await this.principalIsUnfunded(event.bondId, event.bond.totalSizeMinor)) {
              await this.declareDefault(event.bondId, event.bond.issuerId, event.bond.title);
              summary.defaulted.push(event.bondId);
            }
            break;
          case "t_minus_7":
            await this.notifyHoldersOfMaturity(event.bondId, event.bond.title);
            break;
          case "maturity":
            summary.principalPaid += await this.redeem(event.bondId);
            break;
          default:
            break;
        }

        await this.prisma.redemptionEvent.update({
          where: { id: event.id },
          data: { executedAt: new Date() },
        });
        await this.audit.record({
          bondId: event.bondId, event: "redemption_stage", payload: { stage: event.stage },
        });
        summary.processed++;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        summary.failures.push({ eventId: event.id, error });
        await this.audit.record({
          bondId: event.bondId, event: "redemption_stage", payload: { stage: event.stage, error },
        });
      }
    }
    return summary;
  }

  private async notifyIssuerToFund(bondId: string, issuerId: string, isin: string) {
    await this.notifications.send({ userId: issuerId, template: "redemption_t90", data: { bondId, isin } });
  }

  /** Is the principal escrow short of what the bond owes? */
  private async principalIsUnfunded(bondId: string, totalSizeMinor: bigint): Promise<boolean> {
    const escrow = await this.prisma.escrowAccount.findUnique({
      where: { bondId_purpose: { bondId, purpose: "principal" } },
      select: { balanceMinor: true },
    });
    return (escrow?.balanceMinor ?? 0n) < totalSizeMinor;
  }

  /**
   * The default protocol: freeze the bond, tell everyone, escalate.
   * This is the highest-stakes path in the engine and, in the original, had never run.
   */
  private async declareDefault(bondId: string, issuerId: string, title: string) {
    await this.prisma.bond.updateMany({
      where: { id: bondId, status: "active" },
      data: { status: "defaulted" },
    });
    await this.audit.record({ bondId, event: "default_triggered", payload: { reason: "principal_escrow_unfunded_at_t30" } });

    const holders = await this.prisma.holding.findMany({
      where: { bondId, unitsMinor: { gt: 0n } },
      select: { userId: true },
    });
    for (const h of holders) {
      await this.notifications.send({ userId: h.userId, template: "default_declared", data: { bond: title } });
    }
    await this.notifications.send({ userId: issuerId, template: "trustee_default_alert", data: { bond: title } });
    this.logger.warn(`Bond ${bondId} declared in default: principal escrow unfunded at T-30`);
  }

  private async notifyHoldersOfMaturity(bondId: string, title: string) {
    const holders = await this.prisma.holding.findMany({
      where: { bondId, unitsMinor: { gt: 0n } },
      select: { userId: true },
    });
    for (const h of holders) {
      await this.notifications.send({ userId: h.userId, template: "redemption_t7", data: { bond: title } });
    }
  }

  /** Return principal to every holder, then mark the bond matured. */
  private async redeem(bondId: string): Promise<number> {
    const bond = await this.prisma.bond.findUniqueOrThrow({ where: { id: bondId } });
    // A defaulted bond does not pay out on schedule; that is the whole point of default.
    if (bond.status !== "active") return 0;

    const holders = await this.prisma.holding.findMany({
      where: { bondId, unitsMinor: { gt: 0n } },
    });

    let paid = 0;
    for (const holder of holders) {
      const record = await this.prisma.principalReturn.upsert({
        where: { bondId_userId: { bondId, userId: holder.userId } },
        update: {},
        create: { bondId, userId: holder.userId, amountMinor: holder.unitsMinor },
      });
      if (record.status === "paid") continue;

      try {
        const result = await this.payments.disburse({
          userId: holder.userId,
          amountMinor: holder.unitsMinor,
          currency: bond.currency,
          note: `Principal ${bond.isinRef}`,
        });
        await this.prisma.principalReturn.update({
          where: { id: record.id },
          data: result.ok
            ? { status: "paid", providerRef: result.providerRef, paidAt: new Date() }
            : { status: "retry", attempts: { increment: 1 }, lastError: result.error ?? "provider reported failure" },
        });
        if (result.ok) {
          await this.audit.record({
            bondId, userId: holder.userId, event: "principal_returned",
            payload: { amountMinor: holder.unitsMinor.toString() },
          });
          await this.notifications.send({ userId: holder.userId, template: "principal_returned", data: { bond: bond.title } });
          paid++;
        }
      } catch (e) {
        await this.prisma.principalReturn.update({
          where: { id: record.id },
          data: { status: "retry", attempts: { increment: 1 }, lastError: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    // Only close the bond once every holder has actually been paid.
    const stillOwed = await this.prisma.principalReturn.count({
      where: { bondId, status: { not: "paid" } },
    });
    if (stillOwed === 0) {
      await this.prisma.bond.updateMany({ where: { id: bondId, status: "active" }, data: { status: "matured" } });
    }
    return paid;
  }
}
