// Paystack's Transactions API (deposits, money in) and Transfers API (withdrawals,
// money out) — two different rails, wired to the same webhook.
//
// Deposits: hosted-redirect, not the inline JS popup. We ask Paystack for a checkout
// URL, send the browser there, and Paystack sends it back to callbackUrl when done. No
// card data or Paystack script ever touches our frontend, and the Capacitor-wrapped
// native app can open the URL in its in-app browser the same way a plain web tab would.
// Two independent paths confirm a deposit and both funnel into WalletService's one
// "apply this result" method: the browser callback (fast, but the user could close the
// tab before it fires) and the webhook below (slow but guaranteed — Paystack retries
// until it gets a 2xx). Whichever arrives first wins; the other is a no-op, since
// confirmPaystackDeposit only ever acts on a transaction still "pending".
//
// Withdrawals: a transfer is requested, then confirmed asynchronously — the initiating
// call only ever means "accepted", never "done". Test-mode accounts sometimes settle
// synchronously in that same response; live ones always wait for transfer.success /
// transfer.failed on the webhook. WalletService handles both.
import { createHmac, timingSafeEqual } from "node:crypto";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface PaystackInitResult {
  authorizationUrl: string;
  accessCode: string;
}

export interface PaystackVerifyResult {
  status: string;
  reference: string;
  /** Kobo — Paystack's NGN amounts are already minor units, same as ours. */
  amount: number;
  currency: string;
}

export interface PaystackBank {
  name: string;
  code: string;
}

export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
}

export interface TransferRecipient {
  recipientCode: string;
  accountName: string;
}

export interface PaystackTransferResult {
  status: string;
  transferCode: string;
}

const BASE_URL = "https://api.paystack.co";

@Injectable()
export class PaystackService {
  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    const key = this.config.get<string>("PAYSTACK_SECRET_KEY");
    if (!key) throw new ServiceUnavailableException("Paystack is not configured");
    return key;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const body = (await res.json().catch(() => null)) as
      | { status?: boolean; message?: string; data?: unknown }
      | null;
    if (!res.ok || !body?.status) {
      throw new BadRequestException(body?.message ?? "Paystack request failed");
    }
    return body.data as T;
  }

  async initialize(args: {
    email: string;
    amountMinor: bigint;
    reference: string;
    callbackUrl: string;
  }): Promise<PaystackInitResult> {
    const data = await this.call<{ authorization_url: string; access_code: string }>(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: args.email,
          amount: args.amountMinor.toString(),
          reference: args.reference,
          callback_url: args.callbackUrl,
          currency: "NGN",
        }),
      },
    );
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code };
  }

  async verify(reference: string): Promise<PaystackVerifyResult> {
    const data = await this.call<{ status: string; reference: string; amount: number; currency: string }>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    return data;
  }

  // ---- Withdrawals (Transfers API) ------------------------------------------

  /** Nigerian banks and their codes, for a picker — the account number alone isn't enough. */
  async listBanks(): Promise<PaystackBank[]> {
    const data = await this.call<{ name: string; code: string; active: boolean }[]>(
      "/bank?currency=NGN&country=nigeria",
    );
    return data.filter((b) => b.active).map((b) => ({ name: b.name, code: b.code }));
  }

  /**
   * Looks up the account holder's name for an account number + bank. Moves no money —
   * this is what lets the UI show "Paying out to JOHN A. DOE" before anyone confirms
   * anything, so a mistyped digit doesn't quietly send money to a stranger.
   */
  async resolveAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount> {
    const data = await this.call<{ account_number: string; account_name: string }>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    return { accountNumber: data.account_number, accountName: data.account_name };
  }

  /**
   * Registers a payout destination with Paystack. `name` should come from
   * resolveAccount, not from the client — Paystack does not re-verify it here.
   */
  async createTransferRecipient(args: {
    accountNumber: string;
    bankCode: string;
    name: string;
  }): Promise<TransferRecipient> {
    const data = await this.call<{ recipient_code: string; details: { account_name: string } }>(
      "/transferrecipient",
      {
        method: "POST",
        body: JSON.stringify({
          type: "nuban",
          account_number: args.accountNumber,
          bank_code: args.bankCode,
          name: args.name,
          currency: "NGN",
        }),
      },
    );
    return { recipientCode: data.recipient_code, accountName: data.details.account_name };
  }

  /**
   * Moves money out of our Paystack balance to a recipient. The returned status is
   * "pending" more often than not — see the header note on why the caller cannot treat
   * this response as the final answer.
   */
  async initiateTransfer(args: {
    amountMinor: bigint;
    recipientCode: string;
    reason: string;
    reference: string;
  }): Promise<PaystackTransferResult> {
    const data = await this.call<{ status: string; transfer_code: string }>("/transfer", {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: args.amountMinor.toString(),
        recipient: args.recipientCode,
        reason: args.reason,
        reference: args.reference,
      }),
    });
    return { status: data.status, transferCode: data.transfer_code };
  }

  /**
   * Paystack signs the raw webhook body with the secret key (HMAC-SHA512), so this is
   * the only thing that makes a webhook request trustworthy — there is no separate
   * shared secret, and the payload alone must never be trusted without it.
   */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac("sha512", this.secretKey()).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
