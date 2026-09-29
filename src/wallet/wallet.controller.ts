import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import {
  InitializePaystackDepositDto, InitiatePaystackWithdrawalDto, ResolveBankAccountDto,
} from "./dto/wallet.dto";
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

  /** Starts a real charge — returns a Paystack checkout URL, does not touch the balance. */
  @Post("deposit/paystack/initialize")
  @HttpCode(200)
  initializePaystack(
    @CurrentUser() user: AuthUser,
    @Body() dto: InitializePaystackDepositDto,
    @Req() req: Request,
  ) {
    // The surface this came from decides where Paystack returns the browser —
    // see WalletService.returnOrigin.
    return this.wallet.initializePaystackDeposit(user, dto.amountMinor, req.get("origin") ?? undefined);
  }

  /** Polled by the frontend once Paystack redirects the browser back. */
  @Get("deposit/paystack/verify/:reference")
  verifyPaystack(@CurrentUser() user: AuthUser, @Param("reference") reference: string) {
    return this.wallet.verifyPaystackDeposit(user.id, reference);
  }

  /** For the bank picker — Paystack needs a bank code, not just an account number. */
  @Get("banks")
  banks() {
    return this.wallet.listBanks();
  }

  /** Looks up the account holder's name before anyone commits to sending money. */
  @Post("withdraw/paystack/resolve")
  @HttpCode(200)
  resolveAccount(@Body() dto: ResolveBankAccountDto) {
    return this.wallet.resolveWithdrawalAccount(dto.accountNumber, dto.bankCode);
  }

  /** Reserves the funds and starts a real transfer — see WalletService for why. */
  @Post("withdraw/paystack/initiate")
  @HttpCode(200)
  initiatePaystackWithdrawal(
    @CurrentUser() user: AuthUser,
    @Body() dto: InitiatePaystackWithdrawalDto,
  ) {
    return this.wallet.initiatePaystackWithdrawal(user.id, dto);
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
