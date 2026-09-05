// Paystack calls this directly — no JWT, no session. The HMAC signature on the raw
// body is the entire authorisation mechanism, so it is checked before anything in the
// payload is trusted. Deliberately outside the "wallet" path prefix: it isn't a wallet
// action a signed-in user takes, it's the payment provider talking to us.
import type { RawBodyRequest } from "@nestjs/common";
import { Controller, Headers, HttpCode, Logger, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { PaystackService } from "./paystack.service";
import { WalletService } from "./wallet.service";

interface PaystackWebhookEvent {
  event: string;
  data?: { reference?: string; status?: string; amount?: number };
}

const TRANSFER_EVENTS = new Set(["transfer.success", "transfer.failed", "transfer.reversed"]);

@Controller("webhooks/paystack")
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly paystack: PaystackService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Always 200s. Paystack retries on anything else, and there is nothing a different
   * status code buys here: a bad signature is rejected either way, and a good one that
   * fails to apply is our problem to chase in the logs, not Paystack's to retry forever.
   */
  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-paystack-signature") signature?: string,
  ) {
    const raw = req.rawBody;
    let verified = false;
    if (raw) {
      try {
        verified = this.paystack.verifySignature(raw, signature);
      } catch {
        // PAYSTACK_SECRET_KEY unset — treat exactly like a bad signature rather than
        // letting a config gap surface as an unhandled 500 to Paystack's retry logic.
      }
    }
    if (!raw || !verified) {
      this.logger.warn("Rejected a Paystack webhook with a missing or invalid signature");
      return { ok: true };
    }

    let event: PaystackWebhookEvent;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      return { ok: true };
    }

    const reference = event.data?.reference;
    if (!reference) return { ok: true };

    try {
      if (event.event === "charge.success") {
        await this.wallet.confirmPaystackDeposit(reference, {
          status: event.data?.status ?? "success",
          amountMinor: BigInt(event.data?.amount ?? 0),
        });
      } else if (TRANSFER_EVENTS.has(event.event)) {
        const status = event.event === "transfer.success" ? "success" : "failed";
        await this.wallet.confirmPaystackWithdrawal(reference, status);
      }
    } catch (err) {
      this.logger.error(`Could not confirm ${event.event} for ${reference}`, (err as Error).stack);
    }
    return { ok: true };
  }
}
