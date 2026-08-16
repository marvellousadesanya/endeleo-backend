import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { IsString, Length } from "class-validator";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { ReferralsService } from "./referrals.service";

export class ApplyReferralDto {
  @IsString() @Length(4, 16) code!: string;
}

@Controller("referrals")
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.referrals.findForUser(user.id);
  }

  /**
   * Returns 200 with { ok: false, reason } rather than a 4xx for a bad code — the UI
   * distinguishes the reasons, and an invalid code is a normal outcome, not an error.
   */
  @Post("apply")
  @HttpCode(200)
  apply(@CurrentUser() user: AuthUser, @Body() dto: ApplyReferralDto) {
    return this.referrals.apply(user.id, dto.code);
  }
}
