import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("statement")
  statement(
    @CurrentUser() user: AuthUser,
    @Query("period", new DefaultValuePipe("month")) period: "month" | "year",
  ) {
    return this.reports.investorStatement(user.id, period === "year" ? "year" : "month");
  }

  @Get("coupons")
  coupons(@CurrentUser() user: AuthUser) {
    return this.reports.myCoupons(user.id);
  }

  @Get("escrow")
  @Roles("admin")
  escrow() {
    return this.reports.escrowLedger();
  }

  @Get("tax")
  @Roles("admin")
  tax(@Query("year", new DefaultValuePipe(new Date().getUTCFullYear()), ParseIntPipe) year: number) {
    return this.reports.taxReport(year);
  }
}
