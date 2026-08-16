import { Module } from "@nestjs/common";
import { NotificationsController, WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

@Module({
  controllers: [WalletController, NotificationsController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
