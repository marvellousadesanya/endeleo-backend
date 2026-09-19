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

@Injectable()
export class ArrangementService {
  private readonly benchmarkBps: number;

  constructor(
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

    return {
      submissionId: submission.id,
      feasibility: { dscrTable, bankability },
      structuring,
      pricing,
    };
  }
}
