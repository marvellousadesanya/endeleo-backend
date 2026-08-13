// Part-period coupon accrual. Pure, no I/O.
//
// Interest belongs to whoever held the bond, for the days they held it. Paying the whole
// period to whoever happens to hold it on the pay date robs the seller, and lets anyone
// buy in the day before a coupon to collect a full period for nothing.
import { applyWithholdingTax, DAY_COUNT_BASIS } from "./money";
import { daysBetween, parseDateOnly } from "./schedule";

/** A change in one holder's position, applied at the start of `date` (YYYY-MM-DD). */
export interface HoldingDelta {
  date: string;
  userId: string;
  deltaMinor: bigint;
}

export interface HolderAccrual {
  userId: string;
  /** Σ (units held × days held) — the weight behind the split. */
  unitDays: bigint;
  daysHeld: number;
  closingUnitsMinor: bigint;
  grossMinor: bigint;
  whtMinor: bigint;
  netMinor: bigint;
}

const dayCount = (from: string, to: string) =>
  daysBetween(parseDateOnly(from), parseDateOnly(to));

/**
 * Split one coupon period across everyone who held the bond during it.
 *
 * `currentBalances` is today's register; `deltas` must include every position change
 * from `periodStart` onwards, so opening balances can be derived by unwinding them.
 * A delta dated d counts the buyer as holding from d, and the seller up to d.
 *
 * Gross is computed once per holder from total unit-days rather than per segment, so
 * splitting a period into more pieces does not lose money to repeated rounding.
 */
export function accruePeriod(args: {
  periodStart: string;
  periodEnd: string;
  currentBalances: Map<string, bigint>;
  deltas: HoldingDelta[];
  couponRateBps: number;
}): HolderAccrual[] {
  const { periodStart, periodEnd, currentBalances, deltas, couponRateBps } = args;
  if (couponRateBps < 0 || couponRateBps > 5000) throw new Error("rate out of bounds");
  if (dayCount(periodStart, periodEnd) <= 0) return [];

  // Opening balance = today's balance minus everything that has happened since the
  // period began, including anything after it ended.
  const balances = new Map(currentBalances);
  for (const d of deltas) {
    if (d.date >= periodStart) {
      balances.set(d.userId, (balances.get(d.userId) ?? 0n) - d.deltaMinor);
    }
  }

  const withinPeriod = deltas
    .filter((d) => d.date >= periodStart && d.date < periodEnd)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const unitDays = new Map<string, bigint>();
  const daysHeld = new Map<string, number>();
  let cursor = periodStart;

  const accrueUntil = (upTo: string) => {
    const days = dayCount(cursor, upTo);
    if (days > 0) {
      for (const [userId, balance] of balances) {
        if (balance <= 0n) continue;
        unitDays.set(userId, (unitDays.get(userId) ?? 0n) + balance * BigInt(days));
        daysHeld.set(userId, (daysHeld.get(userId) ?? 0) + days);
      }
    }
    cursor = upTo;
  };

  let i = 0;
  while (i < withinPeriod.length) {
    const at = withinPeriod[i].date;
    accrueUntil(at);
    while (i < withinPeriod.length && withinPeriod[i].date === at) {
      const d = withinPeriod[i];
      balances.set(d.userId, (balances.get(d.userId) ?? 0n) + d.deltaMinor);
      i++;
    }
  }
  accrueUntil(periodEnd);

  const results: HolderAccrual[] = [];
  for (const [userId, days] of unitDays) {
    if (days <= 0n) continue;
    const gross = (days * BigInt(couponRateBps)) / (10000n * DAY_COUNT_BASIS);
    const { whtMinor, netMinor } = applyWithholdingTax(gross);
    results.push({
      userId,
      unitDays: days,
      daysHeld: daysHeld.get(userId) ?? 0,
      closingUnitsMinor: balances.get(userId) ?? 0n,
      grossMinor: gross,
      whtMinor,
      netMinor,
    });
  }
  return results.sort((a, b) => (a.userId < b.userId ? -1 : 1));
}
