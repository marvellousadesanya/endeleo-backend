// External money rails. Mock today; the interface is what Paystack slots into.
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

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
 * Needed because Paystack's own test mode reports every transfer as successful, so the
 * retry and escalation paths cannot be exercised against it. Never set in production.
 */
@Injectable()
export class PaymentAdapter {
  private readonly logger = new Logger(PaymentAdapter.name);

  constructor(private readonly config: ConfigService) {}

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
    return { ok: true, escrowReference: `mock_esc_${args.reference}` };
  }

  async refundEscrow(_reference: string): Promise<{ ok: boolean }> {
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
      default:
        this.logger.debug(`disbursed ${args.amountMinor} ${args.currency} to ${args.userId}`);
        return { ok: true, providerRef: `mock_pay_${randomUUID()}` };
    }
  }
}
