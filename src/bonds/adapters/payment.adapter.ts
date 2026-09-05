// Money rail for the bond engine — real now, not mocked, but real in a specific sense:
// it moves money into and out of an investor's Endeleo wallet (src/wallet/wallet.service.ts),
// not straight to an external bank account. No path in this engine ever collects an
// investor's bank details up front, so there is nowhere else for a coupon or principal
// payout to land; from the wallet, the investor reaches their own bank through the real
// Paystack withdrawal flow whenever they choose. Subscribing debits the wallet as a
// real escrow hold — insufficient funds now genuinely blocks a subscription.
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WalletService } from "@/wallet/wallet.service";

export interface EscrowHold {
  ok: boolean;
  escrowReference: string;
}

export interface Disbursement {
  ok: boolean;
  providerRef: string;
  error?: string;
}

/**
 * Fault injection via BOND_ENGINE_MOCK_DISBURSE: "ok" | "fail" | "throw".
 *
 * Kept even though disbursement is real now: a wallet credit is a plain DB write and
 * will "succeed" just as unconditionally as the old mock did, so exercising the retry
 * and escalation paths still needs a way to force a failure on demand. Never set in
 * production.
 */
@Injectable()
export class PaymentAdapter {
  private readonly logger = new Logger(PaymentAdapter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly wallet: WalletService,
  ) {}

  private get mode(): "ok" | "fail" | "throw" {
    const m = this.config.get<string>("BOND_ENGINE_MOCK_DISBURSE");
    return m === "fail" || m === "throw" ? m : "ok";
  }

  async holdInEscrow(args: {
    userId: string;
    amountMinor: bigint;
    currency: string;
    reference: string;
  }): Promise<EscrowHold> {
    const result = await this.wallet.debitForEscrow({
      userId: args.userId,
      amountMinor: args.amountMinor,
      reference: args.reference,
      note: `Subscription hold — ${args.reference}`,
    });
    if (!result.ok) return { ok: false, escrowReference: "" };
    // The same reference threads through to refundEscrow on cancellation and is stored
    // on Subscription.escrowReference — real now, not a mock_esc_ prefix, but the shape
    // callers already depend on is unchanged.
    return { ok: true, escrowReference: args.reference };
  }

  async refundEscrow(args: { userId: string; amountMinor: bigint; reference: string }): Promise<{ ok: boolean }> {
    await this.wallet.creditWallet({
      userId: args.userId,
      amountMinor: args.amountMinor,
      kind: "refund",
      note: `Subscription cancelled — ${args.reference}`,
      reference: args.reference,
    });
    return { ok: true };
  }

  async disburse(args: {
    userId: string;
    amountMinor: bigint;
    currency: string;
    note: string;
  }): Promise<Disbursement> {
    switch (this.mode) {
      case "throw":
        throw new Error("mock rail unreachable");
      case "fail":
        return { ok: false, providerRef: "", error: "provider reported failure" };
      default: {
        const result = await this.wallet.creditWallet({
          userId: args.userId,
          amountMinor: args.amountMinor,
          kind: "payout",
          note: args.note,
        });
        this.logger.debug(
          `disbursed ${args.amountMinor} ${args.currency} to ${args.userId} — new wallet balance ${result.balanceMinor}`,
        );
        return { ok: true, providerRef: `wallet:${args.userId}` };
      }
    }
  }
}
