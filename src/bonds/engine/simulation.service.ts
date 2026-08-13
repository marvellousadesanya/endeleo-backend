// Time-travel harness.
//
// A bond takes years to mature, so the coupon, maturity and default paths are otherwise
// untestable — the default protocol in particular had never executed once. The engine
// decides everything by comparing dates, so feeding it a pretend today replays a whole
// lifecycle in seconds.
//
// Gated behind an environment flag rather than only a permission check: a tool whose job
// is to convince the engine it is the future must never be reachable where real money is.
import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/database/prisma.service";
import { ActivationService } from "./activation.service";
import { CouponRunnerService } from "./coupon-runner.service";
import { RedemptionRunnerService } from "./redemption-runner.service";
import { addMonths, parseDateOnly, toDateOnly } from "./schedule";

export interface EngineStep {
  asOf: string;
  transitions: { closed: number; subscribed: number; activated: number };
  coupons: { created: number; paid: number; failed: number; escalated: number };
  redemption: { processed: number; defaulted: number; principalPaid: number };
}

export interface SimulationResult {
  bondId: string;
  steps: EngineStep[];
  final: {
    status: string;
    issueDate: string | null;
    maturityDate: string | null;
    couponsPaid: number;
    couponsEscalated: number;
    principalReturned: number;
  };
}

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly activation: ActivationService,
    private readonly coupons: CouponRunnerService,
    private readonly redemption: RedemptionRunnerService,
  ) {}

  get isEnabled(): boolean {
    return this.config.get<string>("BOND_ENGINE_ALLOW_SIMULATION") === "true";
  }

  private assertEnabled() {
    if (!this.isEnabled) {
      throw new ForbiddenException("Simulation is disabled. Set BOND_ENGINE_ALLOW_SIMULATION=true (never in production).");
    }
  }

  /** One full engine pass at a pretend date, in the same order as the real tick. */
  async runEngineAt(asOf: string): Promise<EngineStep> {
    this.assertEnabled();
    const transitions = await this.activation.runTransitions({ asOf });
    const coupons = await this.coupons.run(asOf);
    const redemption = await this.redemption.run(asOf);

    return {
      asOf,
      transitions: {
        closed: transitions.closedUnfunded.length,
        subscribed: transitions.closedSubscribed.length,
        activated: transitions.activated.length,
      },
      coupons: { created: coupons.created, paid: coupons.paid, failed: coupons.failed, escalated: coupons.escalated },
      redemption: {
        processed: redemption.processed,
        defaulted: redemption.defaulted.length,
        principalPaid: redemption.principalPaid,
      },
    };
  }

  /**
   * The dates where something can actually happen to this bond.
   * Stepping day by day would be thousands of no-op passes; these cover every branch.
   */
  private async interestingDates(bondId: string): Promise<string[]> {
    const bond = await this.prisma.bond.findUnique({
      where: { id: bondId },
      select: { subscriptionCloseAt: true, issueDate: true, maturityDate: true, tenorMonths: true },
    });
    if (!bond) throw new NotFoundException("Bond not found");

    const dates = new Set<string>([toDateOnly(bond.subscriptionCloseAt)]);
    const [schedules, events] = await Promise.all([
      this.prisma.couponSchedule.findMany({ where: { bondId }, select: { scheduledPayDate: true } }),
      this.prisma.redemptionEvent.findMany({ where: { bondId }, select: { scheduledFor: true } }),
    ]);
    for (const s of schedules) dates.add(toDateOnly(s.scheduledPayDate));
    for (const e of events) dates.add(toDateOnly(e.scheduledFor));

    if (bond.maturityDate) {
      const after = parseDateOnly(toDateOnly(bond.maturityDate));
      after.setUTCDate(after.getUTCDate() + 7);
      dates.add(toDateOnly(after));
    } else {
      // Not yet activated, so project where maturity will land; the first pass fills in
      // the real dates and the loop re-derives them.
      const projected = bond.issueDate ? toDateOnly(bond.issueDate) : toDateOnly(new Date());
      dates.add(toDateOnly(addMonths(parseDateOnly(projected), bond.tenorMonths)));
    }
    return [...dates].sort();
  }

  /** Replay a bond's whole life from wherever it is now. */
  async simulateLifecycle(bondId: string, maxSteps = 60): Promise<SimulationResult> {
    this.assertEnabled();
    const steps: EngineStep[] = [];
    const done = new Set<string>();

    for (let i = 0; i < maxSteps; i++) {
      // Re-derived each pass: activating the bond is what creates its dates.
      const upcoming = (await this.interestingDates(bondId)).filter((d) => !done.has(d));
      if (upcoming.length === 0) break;
      done.add(upcoming[0]);
      steps.push(await this.runEngineAt(upcoming[0]));
    }

    const [bond, couponsPaid, couponsEscalated, principalReturned] = await Promise.all([
      this.prisma.bond.findUniqueOrThrow({ where: { id: bondId }, select: { status: true, issueDate: true, maturityDate: true } }),
      this.prisma.couponPayment.count({ where: { bondId, status: "paid" } }),
      this.prisma.couponPayment.count({ where: { bondId, status: "escalated" } }),
      this.prisma.principalReturn.count({ where: { bondId, status: "paid" } }),
    ]);

    return {
      bondId,
      steps,
      final: {
        status: bond.status,
        issueDate: bond.issueDate ? toDateOnly(bond.issueDate) : null,
        maturityDate: bond.maturityDate ? toDateOnly(bond.maturityDate) : null,
        couponsPaid,
        couponsEscalated,
        principalReturned,
      },
    };
  }
}
