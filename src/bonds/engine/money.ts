// Pure money maths. No I/O, so every rule here is unit-testable.
//
// Everything is integer arithmetic on BigInt in minor units (kobo). Floating point is
// never used: 0.1 + 0.2 is not 0.3, and that is not acceptable for a coupon payment.

/** Nigerian withholding tax on bond interest. */
export const WHT_BPS = 1000; // 10%
/** Endeleo's cut of a secondary-market trade. */
export const PLATFORM_FEE_BPS = 20; // 0.2%
/** Days in the year used for accrual. Simple ACT/365. */
export const DAY_COUNT_BASIS = 365n;

export interface CouponAmounts {
  grossMinor: bigint;
  whtMinor: bigint;
  netMinor: bigint;
}

/** Split a gross amount into the tax withheld and what the investor receives. */
export function applyWithholdingTax(grossMinor: bigint): CouponAmounts {
  if (grossMinor < 0n) throw new Error("gross cannot be negative");
  const whtMinor = (grossMinor * BigInt(WHT_BPS)) / 10000n;
  return { grossMinor, whtMinor, netMinor: grossMinor - whtMinor };
}

/**
 * Interest for a holding over a period.
 *
 *   gross = units × (rate / 10000) × (days / 365)
 *
 * Computed as one multiplication then one division, so rounding happens once.
 */
export function couponFor(unitsMinor: bigint, couponRateBps: number, days: number): CouponAmounts {
  if (unitsMinor < 0n) throw new Error("units cannot be negative");
  if (couponRateBps < 0 || couponRateBps > 5000) throw new Error("rate out of bounds");
  if (days < 0 || days > 3660) throw new Error("period out of bounds");
  const gross = (unitsMinor * BigInt(couponRateBps) * BigInt(days)) / (10000n * DAY_COUNT_BASIS);
  return applyWithholdingTax(gross);
}

/** Would this holding breach the bond's concentration cap? */
export function withinConcentrationLimit(
  currentMinor: bigint,
  incomingMinor: bigint,
  totalSizeMinor: bigint,
  limitBps: number,
): boolean {
  return currentMinor + incomingMinor <= (totalSizeMinor * BigInt(limitBps)) / 10000n;
}

export function platformFee(tradeValueMinor: bigint): bigint {
  return (tradeValueMinor * BigInt(PLATFORM_FEE_BPS)) / 10000n;
}

/** Deterministic internal ISIN-equivalent: END + 4 from the SPV + 4 random. */
export function generateIsinRef(spvReference: string): string {
  const seed = spvReference.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().padEnd(4, "X").slice(0, 4);
  const random = Array.from(crypto.getRandomValues(new Uint8Array(2)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `END${seed}${random}`;
}
