import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { BondsService } from "./bonds.service";
import type { CreateBondDto } from "./dto/bonds.dto";

// Creating a bond. Prisma and the other services are stubbed; these pin down that a bond
// can't be created without a sector, whichever path the request comes in by.

function makeService() {
  const prisma: any = {
    bond: {
      create: vi.fn(async ({ data }: any) => ({ id: "b1", coverImagePath: null, ...data })),
    },
    sponsorChecklistItem: { createMany: vi.fn(async () => ({ count: 0 })) },
    sponsorAgreement: { createMany: vi.fn(async () => ({ count: 0 })) },
  };
  const audit: any = { record: vi.fn(async () => {}) };
  const storage: any = { getPublicUrl: vi.fn(() => "") };
  return { service: new BondsService(prisma, audit, {} as any, storage), prisma };
}

const base: CreateBondDto = {
  title: "Test Bond",
  spvReference: "SPV-TEST-01",
  totalSizeMinor: "100000000",
  minimumInvestmentMinor: "1000000",
  tenorMonths: 24,
  couponRateBps: 1200,
  subscriptionOpenAt: "2026-12-01T00:00:00Z",
  subscriptionCloseAt: "2026-12-31T00:00:00Z",
  sector: "Energy",
};

describe("creating a bond", () => {
  it("stores the sector, trimmed", async () => {
    const { service, prisma } = makeService();
    await service.create({ ...base, sector: "  Energy " }, "u1");
    expect(prisma.bond.create.mock.calls[0][0].data.sector).toBe("Energy");
  });

  it("refuses a bond with no sector, so it can never land under 'Other'", async () => {
    for (const sector of [undefined, "", "   "]) {
      const { service, prisma } = makeService();
      await expect(
        service.create({ ...base, sector: sector as unknown as string }, "u1"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.bond.create).not.toHaveBeenCalled();
    }
  });
});
