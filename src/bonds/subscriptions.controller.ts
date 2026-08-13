import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { SubscriptionsService } from "./subscriptions.service";
import { SubscribeDto } from "./dto/bonds.dto";

@Controller("subscriptions")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.subscriptions.mine(user.id);
  }

  @Post()
  subscribe(@Body() dto: SubscribeDto, @CurrentUser() user: AuthUser) {
    return this.subscriptions.subscribe(dto.bondId, dto.amountMinor, user);
  }

  @Post(":id/cancel")
  cancel(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.subscriptions.cancel(id, user);
  }

  @Post(":id/allocate")
  @Roles("admin")
  allocate(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.subscriptions.allocate(id, user.id);
  }

  @Get("bond/:bondId")
  @Roles("admin")
  forBond(@Param("bondId", ParseUUIDPipe) bondId: string) {
    return this.subscriptions.listForBond(bondId);
  }
}
