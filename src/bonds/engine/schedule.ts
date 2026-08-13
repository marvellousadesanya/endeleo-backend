// Lifecycle dates. Pure, no I/O.
export type CouponFrequency = "monthly" | "quarterly" | "semiannual" | "annual" | "zero";
export type RedemptionStageName = "t_minus_90" | "t_minus_30" | "t_minus_7" | "maturity";

export interface CouponPeriod {
  periodIndex: number;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  scheduledPayDate: string;
}

export interface RedemptionStagePlan {
  stage: RedemptionStageName;
  scheduledFor: string;
}

/** A 30-year monthly bond is 360 periods; this is a runaway guard, not a limit. */
const MAX_PERIODS = 400;

export function couponStepMonths(freq: CouponFrequency): number {
  switch (freq) {
    case "monthly": return 1;
    case "quarterly": return 3;
    case "semiannual": return 6;
    case "annual": return 12;
    default: return 0; // zero-coupon
  }
}

export const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const parseDateOnly = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
export const daysBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

/**
 * Add months, clamping to the end of the target month.
 * Plain setUTCMonth turns 31 January + 1 month into 3 March; a bond schedule needs 28
 * or 29 February.
 */
export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDayOfTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTarget));
  return target;
}

export function computeMaturityDate(issueDate: string, tenorMonths: number): string {
  if (!Number.isInteger(tenorMonths) || tenorMonths < 1) throw new Error("tenor out of bounds");
  return toDateOnly(addMonths(parseDateOnly(issueDate), tenorMonths));
}

/**
 * Coupon periods from issue to maturity.
 * A trailing stub shorter than a full period is dropped — that interest settles with
 * principal at redemption rather than as its own coupon run.
 */
export function buildCouponSchedule(args: {
  issueDate: string;
  maturityDate: string;
  couponFrequency: CouponFrequency;
}): CouponPeriod[] {
  const step = couponStepMonths(args.couponFrequency);
  if (step === 0) return [];

  const end = parseDateOnly(args.maturityDate);
  const periods: CouponPeriod[] = [];
  let start = parseDateOnly(args.issueDate);

  while (periods.length < MAX_PERIODS) {
    const periodEnd = addMonths(start, step);
    if (periodEnd > end) break;
    periods.push({
      periodIndex: periods.length,
      periodStart: toDateOnly(start),
      periodEnd: toDateOnly(periodEnd),
      scheduledPayDate: toDateOnly(periodEnd),
    });
    start = periodEnd;
  }
  return periods;
}

/**
 * Redemption checkpoints counting back from maturity.
 * T-7 is the bondholder notice the spec asks for; the original engine had no such stage.
 */
export function buildRedemptionStages(maturityDate: string): RedemptionStagePlan[] {
  const maturity = parseDateOnly(maturityDate);
  const minus = (days: number) => {
    const d = new Date(maturity);
    d.setUTCDate(d.getUTCDate() - days);
    return toDateOnly(d);
  };
  return [
    { stage: "t_minus_90", scheduledFor: minus(90) },
    { stage: "t_minus_30", scheduledFor: minus(30) },
    { stage: "t_minus_7", scheduledFor: minus(7) },
    { stage: "maturity", scheduledFor: maturityDate },
  ];
}
