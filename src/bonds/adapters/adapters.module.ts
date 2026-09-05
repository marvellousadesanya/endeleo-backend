import { Module } from "@nestjs/common";
import { WalletModule } from "@/wallet/wallet.module";
import { NotificationAdapter } from "./notification.adapter";
import { PaymentAdapter } from "./payment.adapter";

@Module({
  // PaymentAdapter credits/debits a real wallet balance for escrow holds, refunds and
  // payouts — see payment.adapter.ts.
  imports: [WalletModule],
  providers: [PaymentAdapter, NotificationAdapter],
  exports: [PaymentAdapter, NotificationAdapter],
})
export class AdaptersModule {}
