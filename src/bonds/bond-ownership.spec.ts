import { describe, it, expect, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { assertOwnsBond, isBondIssuer } from "./bond-ownership";

// The single "is this your bond?" check behind every sponsor-facing service.

const SPONSOR = { id: "sponsor-1", email: "s@x.ng", roles: ["investor"], kycTier: 0 };
const ADMIN = { id: "adm-1", email: "a@x.ng", roles: ["admin"], kycTier: 0 };

const prismaWith = (bond: { issuerId: string } | null) =>
  ({ bond: { findUnique: vi.fn(async () => bond) } }) as any;

describe("isBondIssuer", () => {
  it("is true only for the user the bond points at", async () => {
    expect(await isBondIssuer(prismaWith({ issuerId: "sponsor-1" }), SPONSOR, "b1")).toBe(true);
    expect(await isBondIssuer(prismaWith({ issuerId: "someone-else" }), SPONSOR, "b1")).toBe(false);
  });

  it("is false, without a lookup, when there is no bond to ask about", async () => {
    const prisma = prismaWith({ issuerId: "sponsor-1" });
    expect(await isBondIssuer(prisma, SPONSOR, null)).toBe(false);
    expect(prisma.bond.findUnique).not.toHaveBeenCalled();
  });

  it("is false when the bond doesn't exist", async () => {
    expect(await isBondIssuer(prismaWith(null), SPONSOR, "missing")).toBe(false);
  });
});

describe("assertOwnsBond", () => {
  it("lets the issuer through", async () => {
    await expect(
      assertOwnsBond(prismaWith({ issuerId: "sponsor-1" }), SPONSOR, "b1"),
    ).resolves.toBeUndefined();
  });

  it("lets an admin through without looking the bond up", async () => {
    const prisma = prismaWith(null);
    await expect(assertOwnsBond(prisma, ADMIN, "b1")).resolves.toBeUndefined();
    expect(prisma.bond.findUnique).not.toHaveBeenCalled();
  });

  it("is 404 for a missing bond and 403 for someone else's", async () => {
    await expect(assertOwnsBond(prismaWith(null), SPONSOR, "b1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      assertOwnsBond(prismaWith({ issuerId: "x" }), SPONSOR, "b1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
