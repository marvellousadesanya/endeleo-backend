// Returning escrowed money to an investor's wallet, with the audit trail either way.
//
// Two callers: the investor's own cooling-off cancellation, and the allocation runner
// refunding a subscription that could not be allocated. Both close the subscription
// first and refund second, deliberately — a failed refund leaves money held, which is
// recoverable, while the other order could pay the same escrow out twice.
import type { AuditService } from "@/audit/audit.service";
import type { PaymentAdapter } from "./adapters/payment.adapter";

export interface EscrowRefund {
  subscriptionId: string;
  bondId: string;
  userId: string;
  amountMinor: bigint;
  reference: string;
  /** Why the money is going back, when it was not the investor's own choice. */
  reason?: string;
}

/** True when the money reached the wallet. A failure is recorded, never thrown. */
export async function refundEscrowAndRecord(
  deps: { payments: PaymentAdapter; audit: AuditService },
  refund: EscrowRefund,
): Promise<boolean> {
  const { subscriptionId, bondId, userId, amountMinor, reference, reason } = refund;
  try {
    await deps.payments.refundEscrow({ userId, amountMinor, reference });
    await deps.audit.record({
      bondId, userId, event: "funds_refunded",
      payload: { subscriptionId, amountMinor: amountMinor.toString(), ...(reason ? { reason } : {}) },
    });
    return true;
  } catch (e) {
    // The unwind stands. Flag the stuck refund rather than losing it silently.
    await deps.audit.record({
      bondId, userId, event: "funds_refunded",
      payload: { subscriptionId, failed: true, error: e instanceof Error ? e.message : String(e) },
    });
    return false;
  }
}
