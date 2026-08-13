// Every write to the audit log goes through here.
//
// The table rejects UPDATE and DELETE at the database level, so entries are permanent
// once written. Failures throw rather than being swallowed: a financial audit trail
// that silently drops entries is worse than one that fails loudly.
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";

/** Everything the engine can record. Kept as a union so typos fail to compile. */
export type AuditEvent =
  | "bond_created" | "bond_state_changed" | "bond_activated"
  | "subscription_created" | "subscription_cancelled" | "allocation_executed"
  | "allocation_reversed" | "funds_escrowed" | "funds_refunded"
  | "capacity_block" | "concentration_block" | "kyc_block"
  | "coupon_scheduled" | "coupon_paid" | "coupon_failed"
  | "escrow_deposit" | "redemption_stage" | "principal_returned"
  | "default_triggered" | "listing_created" | "listing_cancelled" | "trade_executed";

export interface AuditEntryInput {
  event: AuditEvent;
  bondId?: string | null;
  userId?: string | null;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntryInput): Promise<void> {
    await this.recordMany([entry]);
  }

  async recordMany(entries: AuditEntryInput[]): Promise<void> {
    if (entries.length === 0) return;
    await this.prisma.bondAuditEntry.createMany({
      data: entries.map((e) => ({
        bondId: e.bondId ?? null,
        userId: e.userId ?? null,
        event: e.event,
        payload: (e.payload ?? {}) as object,
      })),
    });
  }
}
