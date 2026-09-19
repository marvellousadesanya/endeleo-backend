// M2 — feasibility screen: a DSCR table across three scenarios, and a bankability
// score built from threshold checks and a fixed points rubric.
//
// This is deliberately not a trained classifier. The pitch deck's Bankability
// Classifier (XGBoost, >80% precision) needs 500+ closed deals to train on; Endeleo
// has zero. Every number here is arithmetic a licensed reviewer can retrace by hand —
// that's the point until there's deal history worth fitting a model to.
import type { RevenueModel } from "@prisma/client";

/** Industry-standard floor for infrastructure bonds — see the architecture notes. */
export const DSCR_MINIMUM = 1.25;

export interface CashflowYear {
  year: number;
  revenueMinor: bigint;
  opexMinor: bigint;
}

export interface DscrYear {
  year: number;
  netCashflowMinor: bigint;
  annualDebtServiceMinor: bigint;
  /** Ratio, not money — a display figure, not an input to further money math. */
  dscr: { base: number; downside: number; stress: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Debt service is estimated interest-only against the sponsor's requested coupon —
 * the most conservative assumption available before M3 has picked a repayment
 * structure. Recompute once recommendStructure() has actually chosen bullet vs
 * amortising for a tighter number.
 */
export function buildDscrTable(
  cashflows: CashflowYear[],
  principalMinor: bigint,
  couponRateBps: number,
): DscrYear[] {
  const annualDebtServiceMinor = (principalMinor * BigInt(couponRateBps)) / 10_000n;

  return [...cashflows]
    .sort((a, b) => a.year - b.year)
    .map((cf) => {
      const netCashflowMinor = cf.revenueMinor - cf.opexMinor;
      const dscrUnderShock = (shockPct: number) => {
        if (annualDebtServiceMinor === 0n) return Number.POSITIVE_INFINITY;
        const shockedRevenue = Number(cf.revenueMinor) * (1 - shockPct);
        const shockedNet = shockedRevenue - Number(cf.opexMinor);
        return round2(shockedNet / Number(annualDebtServiceMinor));
      };
      return {
        year: cf.year,
        netCashflowMinor,
        annualDebtServiceMinor,
        dscr: {
          base: dscrUnderShock(0),
          downside: dscrUnderShock(0.2),
          stress: dscrUnderShock(0.4),
        },
      };
    });
}

export type BankabilityRecommendation = "go" | "conditional_go" | "no_go";

export interface SelfAssessmentInput {
  revenueModel: RevenueModel | null;
  offtakeAgreementInPlace: boolean | null;
  priorDfiFunding: boolean | null;
  ongoingLitigation: boolean | null;
  priorDefault: boolean | null;
}

export interface BankabilityResult {
  score: number;
  recommendation: BankabilityRecommendation;
  riskFlags: string[];
}

/** Points for revenue certainty — a government or offtake-backed deal de-risks the raise. */
const REVENUE_MODEL_POINTS: Record<RevenueModel, number> = {
  government_payment: 25,
  offtake: 22,
  tariff: 15,
  user_fee: 8,
  other: 5,
};

/**
 * A fixed-weight scorecard, not a fitted model. Weights (revenue certainty 25,
 * offtake 15, DSCR coverage up to 40, track record up to 25) are a starting point for
 * a reviewer to challenge, not a calibrated output — there is no deal history yet to
 * calibrate against.
 */
export function scoreBankability(dscrTable: DscrYear[], self: SelfAssessmentInput): BankabilityResult {
  const riskFlags: string[] = [];
  let score = 0;

  score += self.revenueModel ? REVENUE_MODEL_POINTS[self.revenueModel] : 0;
  if (!self.revenueModel) riskFlags.push("Revenue model not specified");

  if (self.offtakeAgreementInPlace) score += 15;
  else riskFlags.push("No offtake or revenue agreement on file");

  // Coverage is a veto, not just a scoring input. Without this, a government-backed
  // sponsor with a clean record scores 60 on qualitative points alone and lands on
  // conditional_go even when the project cannot service its coupon at all — which is
  // exactly what the M1 contract's own worked example does (NGN 17M of net cashflow
  // against a NGN 500M raise, a base DSCR of 0.34x). Reputation does not pay coupons.
  let cannotServiceDebt = false;
  let belowDscrFloor = false;

  if (dscrTable.length === 0) {
    riskFlags.push("No cashflow projection submitted — feasibility cannot be scored");
  } else {
    const minBaseDscr = Math.min(...dscrTable.map((d) => d.dscr.base));
    if (minBaseDscr < DSCR_MINIMUM) {
      belowDscrFloor = true;
      riskFlags.push(`Base-case DSCR falls below ${DSCR_MINIMUM}x in at least one year (min ${minBaseDscr}x)`);
    } else {
      const headroom = Math.min(minBaseDscr - DSCR_MINIMUM, 1); // credit capped at +1.0x
      score += 25 + headroom * 15;
    }

    if (minBaseDscr < 1) {
      cannotServiceDebt = true;
      riskFlags.push(`Base-case operating cashflow does not cover debt service at all in at least one year (${minBaseDscr}x)`);
    }

    const minStressDscr = Math.min(...dscrTable.map((d) => d.dscr.stress));
    if (minStressDscr < 1) {
      riskFlags.push(`DSCR falls below 1.0x under the 40% revenue-stress scenario in at least one year (${minStressDscr}x)`);
    }
  }

  score += 20;
  if (self.priorDefault) {
    score -= 30;
    riskFlags.push("Sponsor has a prior default on record");
  }
  if (self.ongoingLitigation) {
    score -= 10;
    riskFlags.push("Ongoing litigation disclosed");
  }
  if (self.priorDfiFunding) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let recommendation: BankabilityRecommendation;
  if (self.priorDefault || cannotServiceDebt || score < 40) {
    recommendation = "no_go";
  } else if (belowDscrFloor || dscrTable.length === 0 || score < 65 || riskFlags.length > 2) {
    // Failing the floor caps the outcome: never "go", however good the rest looks.
    recommendation = "conditional_go";
  } else {
    recommendation = "go";
  }

  return { score, recommendation, riskFlags };
}
