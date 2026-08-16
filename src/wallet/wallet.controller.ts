import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { TransferDto, WithdrawDto } from "./dto/wallet.dto";
import { WalletService } from "./wallet.service";

@Controller("wallet")
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.wallet.findForUser(user.id);
  }

  @Get("transactions")
  transactions(@CurrentUser() user: AuthUser) {
    return this.wallet.listTransactions(user.id);
  }

  @Post("deposit")
  @HttpCode(200)
  deposit(@CurrentUser() user: AuthUser, @Body() dto: TransferDto) {
    return this.wallet.deposit(user.id, dto);
  }

  @Post("withdraw")
  @HttpCode(200)
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawDto) {
    return this.wallet.withdraw(user.id, dto);
  }
}

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.wallet.listNotifications(user.id);
  }

  @Post(":id/read")
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.wallet.markNotificationRead(user.id, id);
  }
}
