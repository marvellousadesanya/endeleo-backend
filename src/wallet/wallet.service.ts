// Wallet: balance, ledger, deposits and withdrawals — both real, over Paystack. Money
// only ever moves after a payment provider confirms it, never on the client's word
// alone; a former trust-the-client deposit/withdraw pair that instantly credited
// whatever amount a request claimed (and could be laundered straight into a real bank
// transfer via the Paystack withdrawal below) has been removed — see git history if
// you need to see what that looked like.
import { randomUUID } from "node:crypto";
import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";
import { PaystackService } from "./paystack.service";

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly paystack: PaystackService,
  ) {}

  /** A wallet row is created on first use, so accounts predating this module work. */
  async findForUser(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      userId,
      balanceMinor: wallet?.balanceMinor ?? 0n,
      currency: wallet?.currency ?? "NGN",
    };
  }

  async listTransactions(userId: string, limit = 100) {
    return this.prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
  }

  // ---- Paystack deposits ----------------------------------------------------
  // Replaces the trust-the-client instant credit above with a real charge: a pending
  // ledger row is opened here, and only ever moved to "completed" once Paystack has
  // confirmed the money actually arrived (see confirmPaystackDeposit).

  async initializePaystackDeposit(user: { id: string; email: string }, amountMinor: string) {
    const amount = BigInt(amountMinor);
    if (amount <= 0n) throw new BadRequestException("Amount must be positive");

    // App-generated, never client-supplied — a spoofed reference could otherwise let
    // one request confirm against another user's pending deposit.
    const reference = `dep_${randomUUID()}`;
    await this.prisma.walletTransaction.create({
      data: {
        userId: user.id,
        kind: "deposit",
        status: "pending",
        amountMinor: amount,
        method: "paystack",
        reference,
        note: "Wallet top-up via Paystack",
      },
    });

    const frontendUrl = this.config.get<string>("FRONTEND_URL");
    const { authorizationUrl } = await this.paystack.initialize({
      email: user.email,
      amountMinor: amount,
      reference,
      callbackUrl: `${frontendUrl}/dashboard/wallet?paystack_reference=${reference}`,
    });

    return { authorizationUrl, reference };
  }

  /**
   * Called after the browser is redirected back from Paystack. Fetches the
   * authoritative status from Paystack's own verify API rather than trusting the
   * reference alone — a callback URL is just a browser navigation, not proof of payment.
   */
  async verifyPaystackDeposit(userId: string, reference: string) {
    const record = await this.prisma.walletTransaction.findFirst({
      where: { reference, method: "paystack" },
    });
    if (!record) throw new NotFoundException("Deposit not found");
    if (record.userId !== userId) throw new ForbiddenException("Not your deposit");

    if (record.status !== "pending") {
      const wallet = await this.findForUser(userId);
      return { status: record.status, balanceMinor: wallet.balanceMinor };
    }

    const result = await this.paystack.verify(reference);
    return this.confirmPaystackDeposit(reference, {
      status: result.status,
      amountMinor: BigInt(result.amount),
    });
  }

  /**
   * The one place a Paystack deposit actually gets credited. Called from both
   * verifyPaystackDeposit (the browser-callback path) and the webhook controller — race
   * is expected, since either can arrive first. `FOR UPDATE` on the ledger row is what
   * makes it safe: the second caller blocks until the first commits, then sees the row
   * is no longer "pending" and returns without crediting twice.
   */
  async confirmPaystackDeposit(reference: string, result: { status: string; amountMinor: bigint }) {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { id: string; user_id: string; amount_minor: bigint; status: string }[]
      >`
        SELECT id, user_id, amount_minor, status FROM wallet_transactions
        WHERE reference = ${reference} AND method = 'paystack'
        FOR UPDATE
      `;
      if (!locked) throw new NotFoundException("Deposit not found");
      if (locked.status !== "pending") {
        return { alreadyProcessed: true, status: locked.status };
      }

      if (result.status !== "success") {
        await tx.walletTransaction.update({ where: { id: locked.id }, data: { status: "failed" } });
        return { alreadyProcessed: false, status: "failed" };
      }
      if (result.amountMinor !== locked.amount_minor) {
        // Paid a different amount than requested — never credit blindly.
        await tx.walletTransaction.update({ where: { id: locked.id }, data: { status: "failed" } });
        throw new BadRequestException("Paid amount did not match the requested deposit");
      }

      await tx.wallet.upsert({
        where: { userId: locked.user_id },
        create: { userId: locked.user_id, balanceMinor: 0n },
        update: {},
      });
      const wallet = await tx.wallet.update({
        where: { userId: locked.user_id },
        data: { balanceMinor: { increment: locked.amount_minor } },
      });
      await tx.walletTransaction.update({
        where: { id: locked.id },
        data: { status: "completed", completedAt: new Date() },
      });
      await tx.notification.create({
        data: {
          userId: locked.user_id,
          title: "Funds added",
          body: this.describe("deposit", locked.amount_minor, "Paystack", "Wallet top-up"),
          href: "/dashboard/wallet",
        },
      });

      return { alreadyProcessed: false, status: "completed", balanceMinor: wallet.balanceMinor };
    });
  }

  // ---- Paystack withdrawals ---------------------------------------------------
  // The mirror image of deposits, and for a deliberately different reason: a deposit
  // isn't credited until Paystack confirms the money arrived, but a withdrawal debits
  // (reserves) the wallet immediately — the money is already ours, and the risk is the
  // investor spending the same balance twice while a transfer is in flight. If the
  // transfer then fails, confirmPaystackWithdrawal puts it back.

  listBanks() {
    return this.paystack.listBanks();
  }

  resolveWithdrawalAccount(accountNumber: string, bankCode: string) {
    return this.paystack.resolveAccount(accountNumber, bankCode);
  }

  async initiatePaystackWithdrawal(
    userId: string,
    dto: { amountMinor: string; accountNumber: string; bankCode: string },
  ) {
    const amount = BigInt(dto.amountMinor);
    if (amount <= 0n) throw new BadRequestException("Amount must be positive");

    // Never trust a client-supplied account name — resolve it ourselves right before
    // committing to anything.
    const resolved = await this.paystack.resolveAccount(dto.accountNumber, dto.bankCode);
    const reference = `wd_${randomUUID()}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.upsert({
        where: { userId },
        create: { userId, balanceMinor: 0n },
        update: {},
      });
      const [locked] = await tx.$queryRaw<{ balance_minor: bigint }[]>`
        SELECT balance_minor FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE
      `;
      const current = locked?.balance_minor ?? 0n;
      if (current < amount) throw new BadRequestException("Insufficient funds");

      await tx.wallet.update({ where: { userId }, data: { balanceMinor: { decrement: amount } } });
      await tx.walletTransaction.create({
        data: {
          userId,
          kind: "withdrawal",
          status: "pending",
          amountMinor: amount,
          method: "paystack",
          reference,
          note: `Withdrawal to ${resolved.accountName} · ${dto.accountNumber}`,
        },
      });
    });

    // The transfer call itself is a network round trip to Paystack — it belongs
    // outside the DB transaction above, not holding that row lock open across it.
    try {
      const recipient = await this.paystack.createTransferRecipient({
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
        name: resolved.accountName,
      });
      const transfer = await this.paystack.initiateTransfer({
        amountMinor: amount,
        recipientCode: recipient.recipientCode,
        reason: "Wallet withdrawal",
        reference,
      });

      // Some accounts (typically test mode) settle synchronously instead of waiting
      // for the webhook. Either way confirmPaystackWithdrawal is idempotent, so acting
      // on it here and again from a webhook that arrives later is harmless.
      if (transfer.status === "success") {
        await this.confirmPaystackWithdrawal(reference, "success");
      } else if (transfer.status === "failed" || transfer.status === "reversed") {
        await this.confirmPaystackWithdrawal(reference, "failed");
      }
    } catch (err) {
      // Paystack rejected the transfer outright — refund now rather than leaving the
      // investor's money reserved, waiting for a webhook that will never arrive.
      await this.confirmPaystackWithdrawal(reference, "failed");
      throw err;
    }

    const wallet = await this.findForUser(userId);
    return { reference, accountName: resolved.accountName, balanceMinor: wallet.balanceMinor };
  }

  /**
   * The one place a Paystack withdrawal is actually settled — reached from
   * initiatePaystackWithdrawal's synchronous path and from transfer.success /
   * transfer.failed / transfer.reversed on the webhook. `FOR UPDATE` makes it safe for
   * both to reach the same reference: the second caller blocks until the first
   * commits, then sees the row is no longer "pending" and no-ops.
   */
  async confirmPaystackWithdrawal(reference: string, status: "success" | "failed") {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { id: string; user_id: string; amount_minor: bigint; status: string }[]
      >`
        SELECT id, user_id, amount_minor, status FROM wallet_transactions
        WHERE reference = ${reference} AND method = 'paystack' AND kind = 'withdrawal'
        FOR UPDATE
      `;
      if (!locked) throw new NotFoundException("Withdrawal not found");
      if (locked.status !== "pending") {
        return { alreadyProcessed: true, status: locked.status };
      }

      if (status === "success") {
        await tx.walletTransaction.update({
          where: { id: locked.id },
          data: { status: "completed", completedAt: new Date() },
        });
        await tx.notification.create({
          data: {
            userId: locked.user_id,
            title: "Withdrawal sent",
            body: this.describe("withdrawal", locked.amount_minor, "Paystack", "your bank account"),
            href: "/dashboard/wallet",
          },
        });
        return { alreadyProcessed: false, status: "completed" };
      }

      // Failed or reversed — give the reserved funds back.
      await tx.wallet.update({
        where: { userId: locked.user_id },
        data: { balanceMinor: { increment: locked.amount_minor } },
      });
      await tx.walletTransaction.update({ where: { id: locked.id }, data: { status: "failed" } });
      await tx.notification.create({
        data: {
          userId: locked.user_id,
          title: "Withdrawal failed",
          body: "Your withdrawal could not be completed. The funds have been returned to your wallet.",
          href: "/dashboard/wallet",
        },
      });
      return { alreadyProcessed: false, status: "failed" };
    });
  }

  // ---- Bond engine payouts and escrow ---------------------------------------
  // Used by PaymentAdapter (src/bonds/adapters/payment.adapter.ts) so coupon payments,
  // principal redemptions and subscription escrow are real wallet movements — not a
  // mocked provider reference. A coupon/redemption payout lands here rather than going
  // straight to a bank account because no bank details are ever collected from an
  // investor up front; it becomes real, spendable, withdrawable money the moment it's
  // credited, and leaves for a real bank account through the Paystack withdrawal above
  // whenever the investor chooses.

  /** Coupon and principal payouts, and an escrow refund on a cancelled subscription. */
  async creditWallet(args: {
    userId: string;
    amountMinor: bigint;
    kind: "payout" | "refund";
    note: string;
    reference?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.wallet.upsert({
        where: { userId: args.userId },
        create: { userId: args.userId, balanceMinor: 0n },
        update: {},
      });
      const wallet = await tx.wallet.update({
        where: { userId: args.userId },
        data: { balanceMinor: { increment: args.amountMinor } },
      });
      await tx.walletTransaction.create({
        data: {
          userId: args.userId,
          kind: args.kind,
          status: "completed",
          amountMinor: args.amountMinor,
          method: "bond-engine",
          reference: args.reference ?? null,
          note: args.note,
          completedAt: new Date(),
        },
      });
      await tx.notification.create({
        data: {
          userId: args.userId,
          title: args.kind === "payout" ? "Payout received" : "Refund received",
          body: `₦${this.majorAmount(args.amountMinor)} ${
            args.kind === "payout" ? "credited to your wallet" : "refunded to your wallet"
          } — ${args.note}.`,
          href: "/dashboard/wallet",
        },
      });
      return { balanceMinor: wallet.balanceMinor };
    });
  }

  /**
   * The escrow hold behind subscribing to a bond: a real debit against the investor's
   * own wallet balance, not a no-op. Returns `{ ok: false }` on insufficient funds
   * rather than throwing — SubscriptionsService already treats a failed hold as an
   * ordinary rejected subscription, not a server error.
   */
  async debitForEscrow(args: { userId: string; amountMinor: bigint; reference: string; note: string }) {
    const insufficientFunds = Symbol("insufficient-funds");
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.wallet.upsert({
          where: { userId: args.userId },
          create: { userId: args.userId, balanceMinor: 0n },
          update: {},
        });
        const [locked] = await tx.$queryRaw<{ balance_minor: bigint }[]>`
          SELECT balance_minor FROM wallets WHERE user_id = ${args.userId}::uuid FOR UPDATE
        `;
        if ((locked?.balance_minor ?? 0n) < args.amountMinor) throw insufficientFunds;

        await tx.wallet.update({
          where: { userId: args.userId },
          data: { balanceMinor: { decrement: args.amountMinor } },
        });
        await tx.walletTransaction.create({
          data: {
            userId: args.userId,
            kind: "investment",
            status: "completed",
            amountMinor: args.amountMinor,
            method: "bond-engine",
            reference: args.reference,
            note: args.note,
            completedAt: new Date(),
          },
        });
      });
      return { ok: true };
    } catch (err) {
      if (err === insufficientFunds) return { ok: false };
      throw err;
    }
  }

  private majorAmount(amountMinor: bigint): string {
    return (Number(amountMinor) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private describe(kind: string, amountMinor: bigint, method: string, note: string) {
    const major = (Number(amountMinor) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return kind === "deposit"
      ? `₦${major} added to your wallet via ${method}.`
      : `₦${major} sent to ${note} via ${method}.`;
  }

  // ---- Notifications -------------------------------------------------------
  // Same domain in practice: every wallet movement writes one, and the UI reads them
  // from the same screen group.

  listNotifications(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    });
  }

  async markNotificationRead(userId: string, id: string) {
    // Scoped by userId as well as id, so one user cannot mark another's as read.
    const result = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, updated: result.count };
  }

  /** Used by other services (subscriptions, coupons) to raise a message. */
  notify(tx: Prisma.TransactionClient, userId: string, title: string, body: string, href?: string) {
    return tx.notification.create({ data: { userId, title, body, href } });
  }
}
