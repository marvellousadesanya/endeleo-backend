import { Module } from "@nestjs/common";
import { NotificationAdapter } from "./notification.adapter";
import { PaymentAdapter } from "./payment.adapter";

@Module({
  providers: [PaymentAdapter, NotificationAdapter],
  exports: [PaymentAdapter, NotificationAdapter],
})
export class AdaptersModule {}
