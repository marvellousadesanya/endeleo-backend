import { describe, it, expect } from "vitest";
import { buildDscrTable, scoreBankability, DSCR_MINIMUM, type CashflowYear } from "./feasibility";
import { recommendStructure } from "./structuring";
import { recommendPricing } from "./pricing";

describe("buildDscrTable", () => {
  const cashflows: CashflowYear[] = [
    { year: 2028, revenueMinor: 4_500_000_000n, opexMinor: 2_800_000_000n },
    { year: 2027, revenueMinor: 4_000_000_000n, opexMinor: 2_500_000_000n },
  ];

  it("sorts by year and computes net cashflow and debt service", () => {
    // ₦500M principal (50,000,000,000 kobo) at 15% (1500bps) → ₦75M annual debt service.
    const table = buildDscrTable(cashflows, 50_000_000_000n, 1500);
    expect(table.map((r) => r.year)).toEqual([2027, 2028]);
    expect(table[0].netCashflowMinor).toBe(1_500_000_000n);
    expect(table[0].annualDebtServiceMinor).toBe(7_500_000_000n);
  });

  it("computes base/downside/stress DSCR as net cashflow ÷ debt service under revenue shocks", () => {
    const table = buildDscrTable([cashflows[1]], 50_000_000_000n, 1500);
    // base: (4.0B - 2.5B) / 7.5B = 0.2
    expect(table[0].dscr.base).toBe(0.2);
    // downside (20% revenue shock): (3.2B - 2.5B) / 7.5B ≈ 0.09
    expect(table[0].dscr.downside).toBeCloseTo(0.09, 2);
    // stress (40% revenue shock): (2.4B - 2.5B) / 7.5B is negative
    expect(table[0].dscr.stress).toBeLessThan(0);
  });

  it("treats a zero coupon rate as infinite DSCR rather than dividing by zero", () => {
    const table = buildDscrTable([cashflows[1]], 50_000_000_000n, 0);
    expect(table[0].dscr.base).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("scoreBankability", () => {
  // ₦4B debt service (8% of ₦50B). Base DSCR 3.5x, and even a 40% revenue stress
  // still clears 2.0x — comfortable enough that neither DSCR check should flag.
  const healthyDscr = buildDscrTable(
    [{ year: 2027, revenueMinor: 15_000_000_000n, opexMinor: 1_000_000_000n }],
    50_000_000_000n,
    800,
  );

  it("scores a clean, well-covered submission as go", () => {
    const result = scoreBankability(healthyDscr, {
      revenueModel: "government_payment",
      offtakeAgreementInPlace: true,
      priorDfiFunding: true,
      ongoingLitigation: false,
      priorDefault: false,
    });
    expect(result.recommendation).toBe("go");
    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(result.riskFlags).toHaveLength(0);
  });

  it("forces no_go on a prior default regardless of score", () => {
    const result = scoreBankability(healthyDscr, {
      revenueModel: "government_payment",
      offtakeAgreementInPlace: true,
      priorDfiFunding: true,
      ongoingLitigation: false,
      priorDefault: true,
    });
    expect(result.recommendation).toBe("no_go");
    expect(result.riskFlags.some((f) => /prior default/i.test(f))).toBe(true);
  });

  it("flags missing cashflows and scores them at zero DSCR contribution", () => {
    const result = scoreBankability([], {
      revenueModel: null,
      offtakeAgreementInPlace: null,
      priorDfiFunding: null,
      ongoingLitigation: null,
      priorDefault: null,
    });
    expect(result.riskFlags).toContain("No cashflow projection submitted — feasibility cannot be scored");
    expect(result.recommendation).not.toBe("go");
  });

  it("flags base DSCR below the 1.25x floor", () => {
    const thinDscr = buildDscrTable(
      [{ year: 2027, revenueMinor: 3_000_000_000n, opexMinor: 2_000_000_000n }],
      50_000_000_000n,
      1000, // ₦5B debt service, ₦1B net → DSCR 0.2x
    );
    const result = scoreBankability(thinDscr, {
      revenueModel: "user_fee",
      offtakeAgreementInPlace: false,
      priorDfiFunding: false,
      ongoingLitigation: false,
      priorDefault: false,
    });
    expect(result.riskFlags.some((f) => f.includes(`below ${DSCR_MINIMUM}x`))).toBe(true);
  });

  // Regression: the M1 handoff contract's own worked example — NGN 500M raise against
  // NGN 17M of net annual cashflow — used to come back conditional_go on qualitative
  // points alone, despite a 0.34x base DSCR. Coverage now vetoes.
  it("returns no_go when operating cashflow cannot cover debt service, however clean the sponsor", () => {
    const cannotService = buildDscrTable(
      [{ year: 2027, revenueMinor: 4_500_000_000n, opexMinor: 2_800_000_000n }],
      50_000_000_000n,
      1000, // ₦5B debt service vs ₦1.7B net → 0.34x
    );
    const result = scoreBankability(cannotService, {
      revenueModel: "government_payment",
      offtakeAgreementInPlace: true,
      priorDfiFunding: true,
      ongoingLitigation: false,
      priorDefault: false,
    });
    expect(result.recommendation).toBe("no_go");
    expect(result.riskFlags.some((f) => /does not cover debt service at all/.test(f))).toBe(true);
  });

  it("caps at conditional_go when below the 1.25x floor but still covering debt service", () => {
    const thinButCovering = buildDscrTable(
      [{ year: 2027, revenueMinor: 7_000_000_000n, opexMinor: 1_000_000_000n }],
      50_000_000_000n,
      1000, // ₦5B debt service vs ₦6B net → 1.2x: above 1.0, below the 1.25 floor
    );
    const result = scoreBankability(thinButCovering, {
      revenueModel: "government_payment",
      offtakeAgreementInPlace: true,
      priorDfiFunding: true,
      ongoingLitigation: false,
      priorDefault: false,
    });
    expect(result.recommendation).toBe("conditional_go");
  });

  it("never returns go when no cashflow projection was submitted", () => {
    const result = scoreBankability([], {
      revenueModel: "government_payment",
      offtakeAgreementInPlace: true,
      priorDfiFunding: true,
      ongoingLitigation: false,
      priorDefault: false,
    });
    expect(result.recommendation).not.toBe("go");
  });

  it("clamps the score into [0, 100]", () => {
    const result = scoreBankability([], {
      revenueModel: "other",
      offtakeAgreementInPlace: false,
      priorDfiFunding: false,
      ongoingLitigation: true,
      priorDefault: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("recommendStructure", () => {
  it("recommends bullet repayment when base DSCR headroom is comfortable", () => {
    const comfortable = buildDscrTable(
      [{ year: 2027, revenueMinor: 10_000_000_000n, opexMinor: 1_000_000_000n }],
      50_000_000_000n,
      1000, // ₦5B debt service, ₦9B net → DSCR 1.8x
    );
    const rec = recommendStructure(36, comfortable);
    expect(rec.repayment).toBe("bullet");
    expect(rec.couponType).toBe("fixed");
    expect(rec.couponFrequency).toBe("semiannual");
  });

  it("recommends amortising when base DSCR headroom is thin", () => {
    const thin = buildDscrTable(
      [{ year: 2027, revenueMinor: 6_000_000_000n, opexMinor: 1_000_000_000n }],
      50_000_000_000n,
      1000, // ₦5B debt service, ₦5B net → DSCR 1.0x
    );
    const rec = recommendStructure(36, thin);
    expect(rec.repayment).toBe("amortising");
    expect(rec.notes.length).toBeGreaterThan(0);
  });

  it("does not report a measured headroom when there is no projection to measure", () => {
    const rec = recommendStructure(60, []);
    expect(rec.repayment).toBe("amortising");
    expect(rec.notes.some((n) => /No cashflow projection submitted/.test(n))).toBe(true);
    // The old wording claimed "min 0x headroom", which reads as a measurement.
    expect(rec.notes.some((n) => /0x/.test(n))).toBe(false);
  });

  it("flags a projection that does not span the requested tenor", () => {
    const oneYear = buildDscrTable(
      [{ year: 2027, revenueMinor: 10_000_000_000n, opexMinor: 1_000_000_000n }],
      50_000_000_000n,
      1000,
    );
    const rec = recommendStructure(60, oneYear); // 5-year bond, 1 year of cashflows
    expect(rec.notes.some((n) => /unevidenced/.test(n))).toBe(true);
    expect(rec.notes.some((n) => /covers 1 year but the requested tenor runs 5/.test(n))).toBe(true);
  });

  it("stays quiet about tenor coverage when the projection spans it", () => {
    const fiveYears = buildDscrTable(
      [2027, 2028, 2029, 2030, 2031].map((year) => ({
        year, revenueMinor: 10_000_000_000n, opexMinor: 1_000_000_000n,
      })),
      50_000_000_000n,
      1000,
    );
    const rec = recommendStructure(60, fiveYears);
    expect(rec.notes.some((n) => /unevidenced/.test(n))).toBe(false);
  });

  it("flags a final-year DSCR shortfall at the requested tenor", () => {
    const shortfall = buildDscrTable(
      [
        { year: 2027, revenueMinor: 10_000_000_000n, opexMinor: 1_000_000_000n },
        { year: 2028, revenueMinor: 5_500_000_000n, opexMinor: 1_000_000_000n },
      ],
      50_000_000_000n,
      1000,
    );
    const rec = recommendStructure(24, shortfall);
    expect(rec.notes.some((n) => /does not clear/.test(n))).toBe(true);
  });
});

describe("recommendPricing", () => {
  it("quotes a tighter spread for a higher bankability score", () => {
    const strong = recommendPricing(85, 1800);
    const weak = recommendPricing(30, 1800);
    expect(strong.spreadBps).toBeLessThan(weak.spreadBps);
    expect(strong.recommendedCouponBps).toBe(1800 + strong.spreadBps);
  });

  it("keeps the range centred on the recommended coupon", () => {
    const rec = recommendPricing(70, 1800);
    expect(rec.rangeBps.minBps).toBeLessThan(rec.recommendedCouponBps);
    expect(rec.rangeBps.maxBps).toBeGreaterThan(rec.recommendedCouponBps);
  });

  it("handles the edges of the score range without throwing", () => {
    expect(() => recommendPricing(0, 1800)).not.toThrow();
    expect(() => recommendPricing(100, 1800)).not.toThrow();
  });
});
