// Wallet: balance, ledger, deposits and withdrawals.
//
// Two things were wrong in the Supabase implementation this replaces, and both are
// fixed here rather than ported:
//
//  1. Balances were floats (`balance_usd numeric`) added with JavaScript arithmetic.
//     Money is now integer minor units in BIGINT, like the rest of the system.
//
//  2. A withdrawal read the balance, subtracted in application code, then wrote it
//     back — three separate round-trips. Two concurrent withdrawals could both read
//     the same balance and both pass the funds check, overdrawing the account. The
//     balance change, the ledger row and the notification now happen inside one
//     transaction, and the debit is applied by the database rather than computed here.
import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma, WalletTxKind } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";
import type { TransferDto } from "./dto/wallet.dto";

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /** A wallet row is created on first use, so accounts predating this module work. */
  async findForUser(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      userId,
      balanceMinor: wallet?.balanceMinor ?? 0n,
      currency: wallet?.currency ?? "USD",
    };
  }

  async listTransactions(userId: string, limit = 100) {
    return this.prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
  }

  deposit(userId: string, dto: TransferDto) {
    return this.applyTransaction(userId, "deposit", dto, `Deposit via ${dto.method}`);
  }

  withdraw(userId: string, dto: TransferDto & { destination: string }) {
    return this.applyTransaction(userId, "withdrawal", dto, dto.destination);
  }

  private async applyTransaction(
    userId: string,
    kind: Extract<WalletTxKind, "deposit" | "withdrawal">,
    dto: TransferDto,
    note: string,
  ) {
    const amount = BigInt(dto.amountMinor);
    if (amount <= 0n) throw new BadRequestException("Amount must be positive");

    const delta = kind === "deposit" ? amount : -amount;

    return this.prisma.$transaction(async (tx) => {
      // Ensure the row exists and lock it for the rest of the transaction. Without the
      // lock, two concurrent withdrawals could each pass the funds check below.
      await tx.wallet.upsert({
        where: { userId },
        create: { userId, balanceMinor: 0n },
        update: {},
      });
      const [locked] = await tx.$queryRaw<{ balance_minor: bigint }[]>`
        SELECT balance_minor FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE
      `;

      const current = locked?.balance_minor ?? 0n;
      if (current + delta < 0n) {
        throw new BadRequestException("Insufficient funds");
      }

      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balanceMinor: { increment: delta } },
      });

      const record = await tx.walletTransaction.create({
        data: {
          userId,
          kind,
          status: "completed",
          amountMinor: amount,
          method: dto.method,
          reference: dto.reference || null,
          note,
          completedAt: new Date(),
        },
      });

      await tx.notification.create({
        data: {
          userId,
          title: kind === "deposit" ? "Funds added" : "Withdrawal processed",
          body: this.describe(kind, amount, dto.method, note),
          href: "/dashboard/wallet",
        },
      });

      return { tx: record, balanceMinor: wallet.balanceMinor };
    });
  }

  private describe(kind: string, amountMinor: bigint, method: string, note: string) {
    const major = (Number(amountMinor) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return kind === "deposit"
      ? `$${major} added to your wallet via ${method}.`
      : `$${major} sent to ${note} via ${method}.`;
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

  /** Used by other services (investments, payouts) to raise a message. */
  notify(tx: Prisma.TransactionClient, userId: string, title: string, body: string, href?: string) {
    return tx.notification.create({ data: { userId, title, body, href } });
  }
}
