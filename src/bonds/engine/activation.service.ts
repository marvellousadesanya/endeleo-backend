// Activation: the moment a subscribed bond becomes a live instrument.
//
// It is stamped with its issue and maturity dates, and its coupon schedule and
// redemption timeline are generated. Nothing downstream can run until this happens —
// in the original engine nothing ever set these dates, so the coupon and maturity
// engines were unreachable for any bond created through the app.
import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/audit/audit.service";
import { buildCouponSchedule, buildRedemptionStages, computeMaturityDate, toDateOnly, type CouponFrequency } from "./schedule";

export interface ActivationResult {
  bondId: string;
  issueDate: string;
  maturityDate: string;
  couponPeriods: number;
  redemptionEvents: number;
}

export interface TransitionSummary {
  closedUnfunded: string[];
  closedSubscribed: string[];
  activated: ActivationResult[];
  failures: { bondId: string; error: string }[];
}

@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Activate a subscribed bond. Idempotent: re-running against an already-active bond
   * refreshes its schedules without moving its dates or status.
   *
   * `asOf` exists so the simulation harness can activate at an arbitrary date.
   */
  async activate(bondId: string, opts: { actorId?: string; asOf?: string } = {}): Promise<ActivationResult> {
    const bond = await this.prisma.bond.findUnique({ where: { id: bondId } });
    if (!bond) throw new NotFoundException("Bond not found");
    if (bond.status !== "subscribed" && bond.status !== "active") {
      throw new BadRequestException(`Bond cannot be activated from status ${bond.status}`);
    }

    // Dates fixed at issuance win; otherwise derive them now.
    const issueDate = bond.issueDate ? toDateOnly(bond.issueDate) : (opts.asOf ?? toDateOnly(new Date()));
    const maturityDate = bond.maturityDate
      ? toDateOnly(bond.maturityDate)
      : computeMaturityDate(issueDate, bond.tenorMonths);

    const periods = buildCouponSchedule({
      issueDate,
      maturityDate,
      couponFrequency: bond.couponFrequency as CouponFrequency,
    });
    const stages = buildRedemptionStages(maturityDate);

    await this.prisma.$transaction(async (tx) => {
      await tx.bond.update({
        where: { id: bond.id },
        data: {
          issueDate: new Date(issueDate),
          maturityDate: new Date(maturityDate),
          ...(bond.status === "subscribed" ? { status: "active" as const } : {}),
        },
      });

      for (const p of periods) {
        await tx.couponSchedule.upsert({
          where: { bondId_periodIndex: { bondId: bond.id, periodIndex: p.periodIndex } },
          update: {
            periodStart: new Date(p.periodStart),
            periodEnd: new Date(p.periodEnd),
            scheduledPayDate: new Date(p.scheduledPayDate),
          },
          create: {
            bondId: bond.id,
            periodIndex: p.periodIndex,
            periodStart: new Date(p.periodStart),
            periodEnd: new Date(p.periodEnd),
            scheduledPayDate: new Date(p.scheduledPayDate),
          },
        });
      }

      for (const s of stages) {
        await tx.redemptionEvent.upsert({
          where: { bondId_stage: { bondId: bond.id, stage: s.stage } },
          update: { scheduledFor: new Date(s.scheduledFor) },
          create: { bondId: bond.id, stage: s.stage, scheduledFor: new Date(s.scheduledFor) },
        });
      }
    });

    await this.audit.recordMany([
      { bondId: bond.id, userId: opts.actorId, event: "bond_activated", payload: { issueDate, maturityDate } },
      { bondId: bond.id, userId: opts.actorId, event: "coupon_scheduled", payload: { periods: periods.length, frequency: bond.couponFrequency } },
    ]);

    return { bondId: bond.id, issueDate, maturityDate, couponPeriods: periods.length, redemptionEvents: stages.length };
  }

  /**
   * Close subscription windows that have passed, then activate everything fully
   * subscribed.
   *
   * There is deliberately no auto-open: publishing a draft stays a human decision, and
   * subscribing before `subscriptionOpenAt` is already refused elsewhere.
   */
  async runTransitions(opts: { asOf?: string } = {}): Promise<TransitionSummary> {
    const now = opts.asOf ? new Date(`${opts.asOf}T23:59:59.999Z`) : new Date();
    const summary: TransitionSummary = { closedUnfunded: [], closedSubscribed: [], activated: [], failures: [] };

    const expiring = await this.prisma.bond.findMany({
      where: { status: "open", subscriptionCloseAt: { lt: now } },
      select: { id: true, raisedMinor: true },
    });

    for (const bond of expiring) {
      const next = bond.raisedMinor > 0n ? "subscribed" : "closed";
      // Re-assert the status in the filter so a concurrent transition cannot be clobbered.
      const { count } = await this.prisma.bond.updateMany({
        where: { id: bond.id, status: "open" },
        data: { status: next },
      });
      if (count === 0) continue;

      await this.audit.record({
        bondId: bond.id,
        event: "bond_state_changed",
        payload: { to: next, reason: "subscription_window_closed", raisedMinor: bond.raisedMinor.toString() },
      });
      (next === "subscribed" ? summary.closedSubscribed : summary.closedUnfunded).push(bond.id);
    }

    const pending = await this.prisma.bond.findMany({ where: { status: "subscribed" }, select: { id: true } });
    for (const bond of pending) {
      try {
        summary.activated.push(await this.activate(bond.id, { asOf: opts.asOf }));
      } catch (e) {
        summary.failures.push({ bondId: bond.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return summary;
  }
}
