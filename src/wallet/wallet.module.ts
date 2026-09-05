import { Module } from "@nestjs/common";
import { PaystackWebhookController } from "./paystack-webhook.controller";
import { PaystackService } from "./paystack.service";
import { NotificationsController, WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

@Module({
  controllers: [WalletController, NotificationsController, PaystackWebhookController],
  providers: [WalletService, PaystackService],
  exports: [WalletService],
})
export class WalletModule {}
