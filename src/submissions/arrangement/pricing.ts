// M5 — pricing: a static spread table over a manually-configured benchmark
// (ARRANGEMENT_BENCHMARK_BPS — see env.ts), not a trained credit-spread model. The
// deck's own M5 slide says to launch this way and replace it with ML once there's
// enough subscription history to fit a model to — that hasn't happened yet, so
// neither has the model.

export interface PricingRecommendation {
  benchmarkBps: number;
  spreadBps: number;
  recommendedCouponBps: number;
  rangeBps: { minBps: number; maxBps: number };
  notes: string[];
}

/** Spread over benchmark, in basis points, by bankability score tier. Reviewed by hand, not fitted. */
const SPREAD_BY_SCORE_TIER: { minScore: number; spreadBps: number }[] = [
  { minScore: 80, spreadBps: 300 },
  { minScore: 65, spreadBps: 450 },
  { minScore: 40, spreadBps: 650 },
  { minScore: 0, spreadBps: 900 },
];

export function recommendPricing(bankabilityScore: number, benchmarkBps: number): PricingRecommendation {
  const tier = SPREAD_BY_SCORE_TIER.find((t) => bankabilityScore >= t.minScore) ?? SPREAD_BY_SCORE_TIER.at(-1)!;
  const recommendedCouponBps = benchmarkBps + tier.spreadBps;

  return {
    benchmarkBps,
    spreadBps: tier.spreadBps,
    recommendedCouponBps,
    rangeBps: { minBps: recommendedCouponBps - 100, maxBps: recommendedCouponBps + 150 },
    notes: [
      "Benchmark is a manually configured placeholder, not a live FMDQ feed — see ARRANGEMENT_BENCHMARK_BPS.",
      `Spread of ${tier.spreadBps}bps reflects a bankability score of ${bankabilityScore}/100 against a static table with no deal history behind it — confirm with a human before quoting a sponsor.`,
    ],
  };
}
