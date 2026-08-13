import { describe, it, expect } from "vitest";
import { couponFor, withinConcentrationLimit, platformFee, WHT_BPS, PLATFORM_FEE_BPS } from "./money";
import { addMonths, buildCouponSchedule, buildRedemptionStages, computeMaturityDate, couponStepMonths, parseDateOnly, toDateOnly } from "./schedule";
import { accruePeriod, type HoldingDelta } from "./accrual";

describe("money", () => {
  it("applies day count and 10% withholding tax", () => {
    // ₦10,000 held for a full year at 10% → ₦1,000 gross, ₦100 tax, ₦900 net.
    const r = couponFor(1_000_000n, 1000, 365);
    expect(r.grossMinor).toBe(100_000n);
    expect(r.whtMinor).toBe(10_000n);
    expect(r.netMinor).toBe(90_000n);
  });

  it("handles a partial period without float drift", () => {
    const r = couponFor(50_000_000n, 1250, 90);
    expect(r.grossMinor).toBe(1_541_095n);
    expect(r.netMinor).toBe(1_386_986n);
  });

  it("survives amounts beyond Number.MAX_SAFE_INTEGER", () => {
    // ₦10 billion. A JS number would have lost precision long before this.
    expect(couponFor(1_000_000_000_000n, 1000, 365).grossMinor).toBe(100_000_000_000n);
  });

  it("rejects impossible inputs", () => {
    expect(() => couponFor(1n, 6000, 30)).toThrow();
    expect(() => couponFor(1n, 1000, -1)).toThrow();
    expect(() => couponFor(-1n, 1000, 30)).toThrow();
  });

  it("enforces the concentration cap at the boundary", () => {
    expect(withinConcentrationLimit(15_000_000n, 5_000_000n, 100_000_000n, 2000)).toBe(true);
    expect(withinConcentrationLimit(15_000_000n, 5_000_001n, 100_000_000n, 2000)).toBe(false);
  });

  it("takes 0.2% on a trade", () => {
    expect(platformFee(1_000_000n)).toBe(2_000n);
    expect(platformFee(0n)).toBe(0n);
    expect([WHT_BPS, PLATFORM_FEE_BPS]).toEqual([1000, 20]);
  });
});

describe("schedule", () => {
  it("clamps month-end instead of spilling into the next month", () => {
    expect(toDateOnly(addMonths(parseDateOnly("2027-01-31"), 1))).toBe("2027-02-28");
    expect(toDateOnly(addMonths(parseDateOnly("2028-01-31"), 1))).toBe("2028-02-29");
  });

  it("derives maturity from tenor", () => {
    expect(computeMaturityDate("2027-01-15", 24)).toBe("2029-01-15");
    expect(() => computeMaturityDate("2027-01-15", 0)).toThrow();
  });

  it("builds contiguous quarterly periods", () => {
    const rows = buildCouponSchedule({ issueDate: "2027-01-01", maturityDate: "2029-01-01", couponFrequency: "quarterly" });
    expect(rows).toHaveLength(8);
    for (let i = 1; i < rows.length; i++) expect(rows[i].periodStart).toBe(rows[i - 1].periodEnd);
    expect(rows.at(-1)!.periodEnd).toBe("2029-01-01");
  });

  it("honours each frequency and pays nothing on a zero-coupon bond", () => {
    const a = { issueDate: "2027-01-01", maturityDate: "2029-01-01" } as const;
    expect(buildCouponSchedule({ ...a, couponFrequency: "monthly" })).toHaveLength(24);
    expect(buildCouponSchedule({ ...a, couponFrequency: "annual" })).toHaveLength(2);
    expect(couponStepMonths("zero")).toBe(0);
    expect(buildCouponSchedule({ ...a, couponFrequency: "zero" })).toEqual([]);
  });

  it("drops a trailing stub shorter than a full period", () => {
    const rows = buildCouponSchedule({ issueDate: "2027-01-01", maturityDate: "2027-08-01", couponFrequency: "quarterly" });
    expect(rows).toHaveLength(2);
  });

  it("plans four redemption checkpoints, including the T-7 notice", () => {
    const rows = buildRedemptionStages("2029-01-01");
    expect(rows.map((r) => r.stage)).toEqual(["t_minus_90", "t_minus_30", "t_minus_7", "maturity"]);
    expect(rows.map((r) => r.scheduledFor)).toEqual(["2028-10-03", "2028-12-02", "2028-12-25", "2029-01-01"]);
  });
});

describe("part-period accrual", () => {
  const PERIOD = { periodStart: "2027-01-01", periodEnd: "2027-04-01" } as const; // 90 days
  const RATE = 1200;
  const AMINA = "amina", BOLA = "bola";

  it("matches the whole-period formula for a holder who never traded", () => {
    const rows = accruePeriod({ ...PERIOD, currentBalances: new Map([[AMINA, 10_000_000n]]), deltas: [], couponRateBps: RATE });
    expect(rows[0].grossMinor).toBe(couponFor(10_000_000n, RATE, 90).grossMinor);
    expect(rows[0].daysHeld).toBe(90);
  });

  it("splits a sale by days held, not by who holds on payday", () => {
    const deltas: HoldingDelta[] = [
      { date: "2027-03-31", userId: AMINA, deltaMinor: -10_000_000n },
      { date: "2027-03-31", userId: BOLA, deltaMinor: 10_000_000n },
    ];
    const rows = accruePeriod({ ...PERIOD, currentBalances: new Map([[AMINA, 0n], [BOLA, 10_000_000n]]), deltas, couponRateBps: RATE });
    const amina = rows.find((r) => r.userId === AMINA)!;
    const bola = rows.find((r) => r.userId === BOLA)!;
    expect([amina.daysHeld, bola.daysHeld]).toEqual([89, 1]);
    // Under the old behaviour Bola took the lot.
    expect(amina.grossMinor).toBeGreaterThan(bola.grossMinor * 80n);
  });

  it("never pays out more than the period is worth", () => {
    const deltas: HoldingDelta[] = [
      { date: "2027-02-01", userId: AMINA, deltaMinor: -4_000_000n },
      { date: "2027-02-01", userId: BOLA, deltaMinor: 4_000_000n },
    ];
    const rows = accruePeriod({ ...PERIOD, currentBalances: new Map([[AMINA, 6_000_000n], [BOLA, 4_000_000n]]), deltas, couponRateBps: RATE });
    const total = rows.reduce((s, r) => s + r.grossMinor, 0n);
    expect(total).toBeLessThanOrEqual(couponFor(10_000_000n, RATE, 90).grossMinor);
  });

  it("pays nothing to someone who bought and sold the same day", () => {
    const deltas: HoldingDelta[] = [
      { date: "2027-02-01", userId: AMINA, deltaMinor: -1_000_000n },
      { date: "2027-02-01", userId: BOLA, deltaMinor: 1_000_000n },
      { date: "2027-02-01", userId: BOLA, deltaMinor: -1_000_000n },
      { date: "2027-02-01", userId: AMINA, deltaMinor: 1_000_000n },
    ];
    const rows = accruePeriod({ ...PERIOD, currentBalances: new Map([[AMINA, 10_000_000n], [BOLA, 0n]]), deltas, couponRateBps: RATE });
    expect(rows.find((r) => r.userId === BOLA)).toBeUndefined();
  });

  it("pro-rates someone allocated mid-period", () => {
    const rows = accruePeriod({ ...PERIOD, currentBalances: new Map([["chidi", 6_000_000n]]),
      deltas: [{ date: "2027-01-31", userId: "chidi", deltaMinor: 6_000_000n }], couponRateBps: RATE });
    expect(rows[0].daysHeld).toBe(60);
    expect(rows[0].grossMinor).toBe(couponFor(6_000_000n, RATE, 60).grossMinor);
  });
});
