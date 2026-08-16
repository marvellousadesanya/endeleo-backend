// Investments: the pre-bond-engine allocation product. Distinct from Subscription,
// which belongs to the bond engine and has its own lifecycle.
//
// Money is integer minor units and the rate is basis points, replacing the float
// dollars and float percentage the Supabase table used.
import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import type { CreateInvestmentDto } from "./dto/investments.dto";

@Injectable()
export class InvestmentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.investment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  listPayouts(userId: string) {
    return this.prisma.payout.findMany({
      where: { userId },
      orderBy: { paidAt: "desc" },
    });
  }

  async create(userId: string, dto: CreateInvestmentDto) {
    // The KYC gate was a client-callable server function before; enforcing it here
    // means it cannot be skipped by calling the API directly.
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { kycStatus: true },
    });
    if (profile?.kycStatus !== "verified") {
      throw new ForbiddenException("KYC_REQUIRED");
    }

    const amountMinor = BigInt(dto.amountMinor);

    return this.prisma.$transaction(async (tx) => {
      const investment = await tx.investment.create({
        data: {
          userId,
          projectSlug: dto.projectSlug,
          amountMinor,
          ratePctBps: dto.ratePctBps,
          tenorMonths: dto.tenorMonths,
          status: "active",
        },
      });

      const major = (Number(amountMinor) / 100).toLocaleString();
      await tx.notification.create({
        data: {
          userId,
          title: "Allocation reserved",
          body: `Your $${major} allocation in ${dto.projectSlug} is active.`,
          href: "/dashboard/portfolio",
        },
      });

      return investment;
    });
  }
}
