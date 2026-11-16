import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { WatchlistService } from "./watchlist.service";

// Starring and unstarring bonds. Prisma is stubbed; these pin down which bonds can be
// watched and that both directions are safe to repeat.

function makeService(bond: { status: string } | null = { status: "open" }) {
  const prisma: any = {
    bond: { findUnique: vi.fn(async () => bond) },
    watchlistItem: {
      findMany: vi.fn(async () => [{ bondId: "b2" }, { bondId: "b1" }]),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { service: new WatchlistService(prisma), prisma };
}

describe("listing", () => {
  it("returns only this user's bond ids, newest first", async () => {
    const { service, prisma } = makeService();
    expect(await service.bondIds("u1")).toEqual({ bondIds: ["b2", "b1"] });
    const query = prisma.watchlistItem.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ userId: "u1" });
    expect(query.orderBy).toEqual({ createdAt: "desc" });
  });
});

describe("starring a bond", () => {
  it("upserts on the user/bond pair, so a second star is a no-op", async () => {
    const { service, prisma } = makeService();
    expect(await service.add("u1", "b1")).toEqual({ bondId: "b1", watching: true });
    const call = prisma.watchlistItem.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId_bondId: { userId: "u1", bondId: "b1" } });
    expect(call.update).toEqual({});
  });

  it("can watch a bond in any published state, not only open ones", async () => {
    for (const status of ["open", "subscribed", "active", "matured", "closed", "defaulted"]) {
      const { service } = makeService({ status });
      await expect(service.add("u1", "b1")).resolves.toMatchObject({ watching: true });
    }
  });

  it("answers 404 for a draft exactly as for a missing bond", async () => {
    await expect(makeService({ status: "draft" }).service.add("u1", "b1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(makeService(null).service.add("u1", "b1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("unstarring a bond", () => {
  it("is scoped to this user and fine to repeat", async () => {
    const { service, prisma } = makeService();
    expect(await service.remove("u1", "b1")).toEqual({ bondId: "b1", watching: false });
    expect(prisma.watchlistItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", bondId: "b1" },
    });
  });
});
