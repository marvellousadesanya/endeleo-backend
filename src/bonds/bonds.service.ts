// Issuance and the register.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/audit/audit.service";
import { ActivationService } from "./engine/activation.service";
import { generateIsinRef } from "./engine/money";
import { toMinor, type CreateBondDto } from "./dto/bonds.dto";

@Injectable()
export class BondsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activation: ActivationService,
  ) {}

  async create(dto: CreateBondDto, issuerId: string) {
    const totalSizeMinor = toMinor(dto.totalSizeMinor, "totalSizeMinor");
    const minimumInvestmentMinor = toMinor(dto.minimumInvestmentMinor, "minimumInvestmentMinor");
    if (new Date(dto.subscriptionCloseAt) <= new Date(dto.subscriptionOpenAt)) {
      throw new BadRequestException("subscriptionCloseAt must be after subscriptionOpenAt");
    }

    const bond = await this.prisma.bond.create({
      data: {
        isinRef: generateIsinRef(dto.spvReference),
        title: dto.title,
        spvReference: dto.spvReference,
        projectSlug: dto.projectSlug ?? null,
        issuerId,
        currency: dto.currency ?? "NGN",
        totalSizeMinor,
        minimumInvestmentMinor,
        tenorMonths: dto.tenorMonths,
        couponRateBps: dto.couponRateBps,
        couponFrequency: dto.couponFrequency ?? "quarterly",
        allocationRule: dto.allocationRule ?? "fcfs",
        concentrationLimitBps: dto.concentrationLimitBps ?? 2000,
        kycTierRequired: dto.kycTierRequired ?? 1,
        geoBlock: dto.geoBlock ?? [],
        subscriptionOpenAt: new Date(dto.subscriptionOpenAt),
        subscriptionCloseAt: new Date(dto.subscriptionCloseAt),
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        maturityDate: dto.maturityDate ? new Date(dto.maturityDate) : null,
      },
    });

    await this.audit.record({
      bondId: bond.id, userId: issuerId, event: "bond_created",
      payload: { isinRef: bond.isinRef, totalSizeMinor: totalSizeMinor.toString() },
    });
    return bond;
  }

  /** Investors see published bonds; drafts belong to their issuer and to admins. */
  listVisible(viewer: { id: string; roles: string[] }) {
    const isAdmin = viewer.roles.includes("admin");
    return this.prisma.bond.findMany({
      where: isAdmin ? {} : { OR: [{ status: { not: "draft" } }, { issuerId: viewer.id }] },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, viewer: { id: string; roles: string[] }) {
    const bond = await this.prisma.bond.findUnique({ where: { id } });
    if (!bond) throw new NotFoundException("Bond not found");
    const visible =
      bond.status !== "draft" || bond.issuerId === viewer.id || viewer.roles.includes("admin");
    if (!visible) throw new NotFoundException("Bond not found");
    return bond;
  }

  /**
   * Activation is more than a status flip — it stamps the dates and builds the coupon
   * and redemption schedules, so it is delegated rather than duplicated here.
   */
  async changeStatus(id: string, status: string, actorId: string) {
    const bond = await this.prisma.bond.findUnique({ where: { id } });
    if (!bond) throw new NotFoundException("Bond not found");

    if (status === "active") {
      await this.activation.activate(id, { actorId });
      return this.prisma.bond.findUniqueOrThrow({ where: { id } });
    }

    // The database enforces which transitions are legal; this surfaces the refusal as a
    // 400 rather than a 500.
    try {
      const updated = await this.prisma.bond.update({
        where: { id },
        data: { status: status as never },
      });
      await this.audit.record({ bondId: id, userId: actorId, event: "bond_state_changed", payload: { to: status } });
      return updated;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("Illegal bond status transition")) {
        throw new BadRequestException(`Cannot move a bond from ${bond.status} to ${status}`);
      }
      throw e;
    }
  }

  holdingsFor(userId: string) {
    return this.prisma.holding.findMany({
      where: { userId, unitsMinor: { gt: 0n } },
      include: {
        bond: {
          select: {
            id: true, title: true, isinRef: true, currency: true, status: true,
            couponRateBps: true, couponFrequency: true, maturityDate: true, issueDate: true,
            tenorMonths: true, projectSlug: true, spvReference: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  /** The bondholder register for one bond. Admins and the issuer only. */
  async register(bondId: string, viewer: { id: string; roles: string[] }) {
    const bond = await this.prisma.bond.findUnique({ where: { id: bondId } });
    if (!bond) throw new NotFoundException("Bond not found");
    if (!viewer.roles.includes("admin") && bond.issuerId !== viewer.id) {
      throw new ForbiddenException("Not your bond");
    }

    const holders = await this.prisma.holding.findMany({
      where: { bondId, unitsMinor: { gt: 0n } },
      include: { user: { select: { id: true, email: true, fullName: true, kycTier: true } } },
      orderBy: { unitsMinor: "desc" },
    });

    return {
      generatedAt: new Date().toISOString(),
      bond: { id: bond.id, isinRef: bond.isinRef, title: bond.title, totalSizeMinor: bond.totalSizeMinor, raisedMinor: bond.raisedMinor },
      holders: holders.map((h) => ({
        user: h.user,
        unitsMinor: h.unitsMinor,
        shareBps: Number((h.unitsMinor * 10000n) / bond.totalSizeMinor),
        firstSettledAt: h.firstSettledAt,
      })),
    };
  }
}
