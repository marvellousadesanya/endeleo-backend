// Orchestrates M2 (feasibility) → M3 (structuring) → M5 (pricing) for one
// submission. Nothing here is persisted: every input is either already on the
// submission or a config constant, so this is cheap to recompute on every read
// rather than a stale snapshot an admin has to remember to refresh.
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/database/prisma.service";
import { buildDscrTable, scoreBankability, type CashflowYear } from "./feasibility";
import { recommendStructure } from "./structuring";
import { recommendPricing } from "./pricing";
import { ArrangementAiService, type AiOpinion } from "@/arrangement-ai/arrangement-ai.service";
import { MacroService, realRatePct } from "@/macro/macro.service";

@Injectable()
export class ArrangementService {
  private readonly benchmarkBps: number;

  constructor(
    private readonly ai: ArrangementAiService,
    private readonly macro: MacroService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.benchmarkBps = config.getOrThrow<number>("ARRANGEMENT_BENCHMARK_BPS");
  }

  async computeFor(submissionId: string) {
    const submission = await this.prisma.projectSubmission.findUnique({
      where: { id: submissionId },
      include: { cashflows: { orderBy: { year: "asc" } } },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    // Same per-field guard style as SubmissionsService.promote(): the screen needs
    // real numbers to run on, and "arrangement is incomplete" is less useful to a
    // reviewer than knowing exactly which field is missing.
    const capitalRequiredMinor = submission.capitalRequiredMinor;
    if (capitalRequiredMinor == null) {
      throw new BadRequestException("capitalRequiredMinor is required to run the arrangement screen");
    }
    const expectedReturnBps = submission.expectedReturnBps;
    if (expectedReturnBps == null) {
      throw new BadRequestException("expectedReturnBps is required to run the arrangement screen");
    }
    const tenorMonths = submission.tenorMonths;
    if (tenorMonths == null) {
      throw new BadRequestException("tenorMonths is required to run the arrangement screen");
    }

    const cashflows: CashflowYear[] = submission.cashflows.map((c) => ({
      year: c.year,
      revenueMinor: c.revenueMinor,
      opexMinor: c.opexMinor,
    }));

    const dscrTable = buildDscrTable(cashflows, capitalRequiredMinor, expectedReturnBps);
    const bankability = scoreBankability(dscrTable, {
      revenueModel: submission.revenueModel,
      offtakeAgreementInPlace: submission.offtakeAgreementInPlace,
      priorDfiFunding: submission.priorDfiFunding,
      ongoingLitigation: submission.ongoingLitigation,
      priorDefault: submission.priorDefault,
    });
    const structuring = recommendStructure(tenorMonths, dscrTable);
    const pricing = recommendPricing(bankability.score, this.benchmarkBps);

    // Whatever opinions are already stored for this version of the deal. Never blocks:
    // three model calls added ~13 seconds to a page open, so the screen renders from the
    // computed figures and the AI arrives from its own endpoint.
    const stored = await this.storedOpinions(submissionId, submission.updatedAt);

    // Free, annual, and cached for a day — it cannot hold up the screen, and the screen
    // is complete without it. What it adds is somewhere to stand: a coupon means little
    // without the inflation it has to beat.
    const macro = await this.macro.nigeria();
    const latestInflation = macro?.inflation[0];
    const realCouponPct =
      latestInflation !== undefined
        ? realRatePct(pricing.recommendedCouponBps / 100, latestInflation.value)
        : null;

    return {
      submissionId: submission.id,
      macro: macro
        ? {
            inflation: macro.inflation,
            fx: macro.fx,
            gdpGrowth: macro.gdpGrowth,
            fetchedAt: macro.fetchedAt,
            source: macro.source,
            /** The recommended coupon after inflation, on the latest reading. */
            realCouponPct,
          }
        : null,
      aiEnabled: this.ai.enabled,
      aiStale: this.ai.enabled && stored.size === 0,
      feasibility: { dscrTable, bankability, ai: stored.get("m2") ?? null },
      structuring: { ...structuring, ai: stored.get("m3") ?? null },
      pricing: { ...pricing, ai: stored.get("m5") ?? null },
    };
  }

  // ---- AI opinions -----------------------------------------------------------

  /** Opinions already stored for this exact version of the deal. */
  private async storedOpinions(submissionId: string, basedOn: Date) {
    const rows = await this.prisma.submissionAiOpinion.findMany({
      where: { submissionId, basedOn },
    });
    return new Map(
      rows.map((r) => [
        r.module,
        {
          verdict: r.verdict,
          rationale: r.rationale,
          value: r.value,
          confidence: r.confidence,
          flags: r.flags,
          model: r.model,
        },
      ]),
    );
  }

  /**
   * Produce the AI opinions for a deal, reusing any that are still current.
   *
   * Called from its own endpoint so the arrangement screen never waits on it. Safe to
   * call repeatedly: once stored against the submission's updatedAt, it costs nothing
   * until the sponsor changes something.
   */
  async aiOpinionsFor(submissionId: string) {
    const screen = await this.computeFor(submissionId);
    // The prompts used to say "you have no comparables to price against" and leave it
    // there. They still have no comparables — there are no closed deals — but inflation
    // and the naira are knowable, and a model reasoning without them is guessing.
    const macro = screen.macro;
    const submission = await this.prisma.projectSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { updatedAt: true, sector: true, revenueModel: true },
    });

    if (!this.ai.enabled) return { aiEnabled: false, opinions: {} as Record<string, unknown> };

    const stored = await this.storedOpinions(submissionId, submission.updatedAt);
    const wanted = [
      {
        module: "m2",
        label: "M2 Feasibility & Bankability",
        task: "Judge whether this project can service the debt it is asking for, and what a credit committee would ask next. `value` is your own bankability score out of 100.",
        facts: {
          nigerianMacro: macro
            ? { inflationAnnualPct: macro.inflation.slice(0, 5), ngnPerUsd: macro.fx.slice(0, 5) }
            : null,
          dscrTable: screen.feasibility.dscrTable,
          computedScore: screen.feasibility.bankability.score,
          computedRecommendation: screen.feasibility.bankability.recommendation,
          scoreComponents: screen.feasibility.bankability.components,
          riskFlags: screen.feasibility.bankability.riskFlags,
        },
      },
      {
        module: "m3",
        label: "M3 Bond Structuring",
        task: "Judge the recommended instrument, repayment profile and covenant package against this deal's coverage. Say what you would change and why. `value` may be null.",
        facts: { computedStructure: screen.structuring, dscrTable: screen.feasibility.dscrTable },
      },
      {
        module: "m5",
        label: "M5 Bond Pricing",
        task: "Judge the indicative coupon for this deal in the Nigerian naira infrastructure market. `value` is the credit spread over the benchmark you would quote, in basis points.",
        facts: {
          computedPricing: screen.pricing,
          bankabilityScore: screen.feasibility.bankability.score,
          sector: submission.sector,
          nigerianMacro: macro
            ? {
                inflationAnnualPct: macro.inflation.slice(0, 5),
                ngnPerUsd: macro.fx.slice(0, 5),
                gdpGrowthPct: macro.gdpGrowth.slice(0, 5),
                recommendedCouponRealPct: macro.realCouponPct,
                source: macro.source,
              }
            : null,
          note: "The benchmark is a manually configured placeholder, not a live FGN or FMDQ yield, and there is no closed-deal history to compare against. The macro series above are annual World Bank figures — use them to judge whether the coupon is plausible in real terms, not as a substitute for a market yield.",
        },
      },
    ].filter((w) => !stored.has(w.module));

    const fresh = await Promise.all(
      wanted.map(async (w) => {
        const opinion = await this.ai.opine({
          module: w.label,
          task: w.task,
          // BigInt does not survive JSON.stringify; the prompt builder needs plain values.
          facts: JSON.parse(
            JSON.stringify(w.facts, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
          ) as Record<string, unknown>,
        });
        return { module: w.module, opinion };
      }),
    );

    for (const { module, opinion } of fresh) {
      if (!opinion) continue;
      await this.prisma.submissionAiOpinion.upsert({
        where: { submissionId_module: { submissionId, module } },
        create: {
          submissionId,
          module,
          basedOn: submission.updatedAt,
          ...opinion,
          model: this.ai.modelName,
        },
        update: { basedOn: submission.updatedAt, ...opinion, model: this.ai.modelName },
      });
    }

    const all = await this.storedOpinions(submissionId, submission.updatedAt);
    return { aiEnabled: true, opinions: Object.fromEntries(all) };
  }
}
