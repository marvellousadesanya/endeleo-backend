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

@Injectable()
export class ArrangementService {
  private readonly benchmarkBps: number;

  constructor(
    private readonly ai: ArrangementAiService,
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

    // The AI layer's opinions on the three modules the specification describes as
    // model-driven. Requested in parallel — they are independent, and three round trips
    // in series would be felt on a screen someone opens per deal.
    //
    // Each returns null when the AI is off or the call fails, and every panel renders
    // from the computed figures in that case. The model reasons over the arithmetic
    // above; it never replaces it.
    const [feasibilityAi, structuringAi, pricingAi] = await Promise.all([
      this.ai.opine({
        module: "M2 Feasibility & Bankability",
        task: "Judge whether this project can service the debt it is asking for, and what a credit committee would ask next. `value` is your own bankability score out of 100.",
        facts: {
          capitalSoughtMinor: capitalRequiredMinor.toString(),
          requestedCouponBps: expectedReturnBps,
          tenorMonths,
          dscrTable: dscrTable.map((d) => ({
            year: d.year,
            netCashflowMinor: d.netCashflowMinor.toString(),
            annualDebtServiceMinor: d.annualDebtServiceMinor.toString(),
            dscr: d.dscr,
          })),
          computedScore: bankability.score,
          computedRecommendation: bankability.recommendation,
          scoreComponents: bankability.components,
          riskFlags: bankability.riskFlags,
          selfAssessment: {
            revenueModel: submission.revenueModel,
            offtakeAgreementInPlace: submission.offtakeAgreementInPlace,
            priorDfiFunding: submission.priorDfiFunding,
            ongoingLitigation: submission.ongoingLitigation,
            priorDefault: submission.priorDefault,
          },
        },
      }),
      this.ai.opine({
        module: "M3 Bond Structuring",
        task: "Judge the recommended instrument, repayment profile and covenant package against this deal's coverage. Say what you would change and why. `value` may be null.",
        facts: {
          computedStructure: structuring,
          dscrTable: dscrTable.map((d) => ({ year: d.year, dscr: d.dscr })),
          tenorMonths,
          sector: submission.sector,
          revenueModel: submission.revenueModel,
        },
      }),
      this.ai.opine({
        module: "M5 Bond Pricing",
        task: "Judge the indicative coupon for this deal in the Nigerian naira infrastructure market. `value` is the credit spread over the benchmark you would quote, in basis points.",
        facts: {
          computedPricing: pricing,
          bankabilityScore: bankability.score,
          recommendation: bankability.recommendation,
          tenorMonths,
          sector: submission.sector,
          capitalSoughtMinor: capitalRequiredMinor.toString(),
          note: "The benchmark is a manually configured placeholder, not a live FGN or FMDQ yield. There is no closed-deal history on this platform to compare against.",
        },
      }),
    ]);

    return {
      submissionId: submission.id,
      aiEnabled: this.ai.enabled,
      feasibility: { dscrTable, bankability, ai: feasibilityAi },
      structuring: { ...structuring, ai: structuringAi },
      pricing: { ...pricing, ai: pricingAi },
    };
  }
}
