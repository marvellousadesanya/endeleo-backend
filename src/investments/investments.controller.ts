import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { CreateInvestmentDto } from "./dto/investments.dto";
import { InvestmentsService } from "./investments.service";

@Controller("investments")
@UseGuards(JwtAuthGuard)
export class InvestmentsController {
  constructor(private readonly investments: InvestmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.investments.list(user.id);
  }

  @Get("payouts")
  payouts(@CurrentUser() user: AuthUser) {
    return this.investments.listPayouts(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvestmentDto) {
    return this.investments.create(user.id, dto);
  }
}
