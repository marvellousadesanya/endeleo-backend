import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { AllocationRunnerService } from "./allocation-runner.service";

// The promise in the subscription email: after 48 hours the money becomes units, or comes
// back. These cover which of the two happens, and that it can only happen once. Prisma and
// the money rail are stubbed — the procedure's own checks are the database's to test.

const DUE = {
  id: "s1", bondId: "b1", userId: "u1", amountMinor: 5_000_000n, escrowReference: "esc_1",
};

function makeRunner(opts: {
  due?: (typeof DUE)[];
  allocate?: (id: string) => Promise<unknown>;
  claimed?: number;
  refundFails?: boolean;
} = {}) {
  const prisma: any = {
    subscription: {
      findMany: vi.fn(async () => opts.due ?? [DUE]),
      updateMany: vi.fn(async () => ({ count: opts.claimed ?? 1 })),
    },
    bond: { findUnique: vi.fn(async () => ({ title: "Lagos Solar" })) },
  };
  const audit: any = { record: vi.fn(async () => {}) };
  const payments: any = {
    refundEscrow: vi.fn(async () => {
      if (opts.refundFails) throw new Error("wallet down");
      return { ok: true };
    }),
  };
  const notifications: any = { notify: vi.fn(async () => {}) };
  const subscriptions: any = { allocate: vi.fn(opts.allocate ?? (async () => ({ id: "h1" }))) };
  const config: any = { getOrThrow: () => "https://application.endeleo.online" };

  const runner = new AllocationRunnerService(prisma, audit, payments, notifications, subscriptions, config);
  return { runner, prisma, audit, payments, notifications, subscriptions };
}

const refusedWith = (code: string) => async () => {
  throw new BadRequestException(code);
};

describe("once cooling-off is over", () => {
  it("asks only for pending subscriptions past their 48 hours, oldest first", async () => {
    const { runner, prisma } = makeRunner({ due: [] });
    await runner.run({ asOf: "2026-10-25" });

    const query = prisma.subscription.findMany.mock.calls[0][0];
    expect(query.where.status).toBe("pending");
    expect(query.where.coolingOffExpiresAt.lte).toEqual(new Date("2026-10-25T23:59:59.999Z"));
    expect(query.orderBy).toEqual({ createdAt: "asc" });
  });

  it("allocates the subscription into units", async () => {
    const { runner, subscriptions, payments } = makeRunner();
    const summary = await runner.run();

    expect(subscriptions.allocate).toHaveBeenCalledWith("s1");
    expect(summary.allocated).toEqual(["s1"]);
    expect(payments.refundEscrow).not.toHaveBeenCalled();
  });
});

describe("a refused allocation is refunded", () => {
  it.each(["CAPACITY_EXCEEDED", "CONCENTRATION_LIMIT_EXCEEDED", "BOND_NOT_OPEN"])(
    "refunds the full escrow when the procedure says %s",
    async (code) => {
      const { runner, prisma, payments, notifications } = makeRunner({ allocate: refusedWith(code) });
      const summary = await runner.run();

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: "s1", status: "pending" },
        data: expect.objectContaining({ status: "refunded" }),
      });
      expect(payments.refundEscrow).toHaveBeenCalledWith({
        userId: "u1", amountMinor: 5_000_000n, reference: "esc_1",
      });
      expect(summary.refunded).toEqual(["s1"]);
      await vi.waitFor(() => expect(notifications.notify).toHaveBeenCalled());
    },
  );

  it("never refunds twice when another instance claimed it first", async () => {
    const { runner, payments } = makeRunner({ allocate: refusedWith("CAPACITY_EXCEEDED"), claimed: 0 });
    const summary = await runner.run();

    expect(payments.refundEscrow).not.toHaveBeenCalled();
    expect(summary.refunded).toEqual([]);
  });

  it("records a failed wallet credit instead of hiding it", async () => {
    const { runner, audit, notifications } = makeRunner({
      allocate: refusedWith("CAPACITY_EXCEEDED"),
      refundFails: true,
    });
    const summary = await runner.run();

    expect(summary.refundFailed).toEqual(["s1"]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: "funds_refunded", payload: expect.objectContaining({ failed: true }) }),
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe("anything else is retried next hour", () => {
  it("leaves the subscription pending on an unexpected error", async () => {
    const { runner, prisma, payments } = makeRunner({
      allocate: async () => {
        throw new Error("connection terminated");
      },
    });
    const summary = await runner.run();

    expect(summary.failures).toEqual([{ subscriptionId: "s1", error: "connection terminated" }]);
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(payments.refundEscrow).not.toHaveBeenCalled();
  });

  it("skips a subscription that was cancelled since it was read", async () => {
    const { runner, payments } = makeRunner({ allocate: refusedWith("SUBSCRIPTION_NOT_PENDING") });
    const summary = await runner.run();

    expect(summary).toEqual({ allocated: [], refunded: [], refundFailed: [], failures: [] });
    expect(payments.refundEscrow).not.toHaveBeenCalled();
  });
});
