import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { SponsorAnalyticsService } from "./analytics.service";

@Controller("sponsor/analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SponsorAnalyticsController {
  constructor(private readonly analytics: SponsorAnalyticsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.analytics.forSponsor(user);
  }
}
