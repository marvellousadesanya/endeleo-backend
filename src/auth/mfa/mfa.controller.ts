import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";
import { CurrentUser } from "../current-user.decorator";
import { JwtAuthGuard } from "../jwt-auth.guard";
import type { AuthUser } from "../jwt.strategy";
import { AuthService } from "../auth.service";
import { MfaService } from "./mfa.service";

const SIX_DIGITS = /^\d{6}$/;

export class EnrollDto {
  @IsOptional() @IsString() @Length(1, 60) friendlyName?: string;
}

export class VerifyEnrolmentDto {
  @IsUUID() factorId!: string;
  @Matches(SIX_DIGITS, { message: "Enter the six-digit code from your authenticator app" })
  code!: string;
}

/** Second step of login. Deliberately unauthenticated — there is no session yet. */
export class ChallengeDto {
  @IsUUID() challengeId!: string;
  @Matches(SIX_DIGITS, { message: "Enter the six-digit code from your authenticator app" })
  code!: string;
}

@Controller("auth/mfa")
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
  ) {}

  @Get("factors")
  @UseGuards(JwtAuthGuard)
  factors(@CurrentUser() user: AuthUser) {
    return this.mfa.listFactors(user.id);
  }

  @Post("enroll")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  enroll(@CurrentUser() user: AuthUser, @Body() dto: EnrollDto) {
    return this.mfa.enroll(user.id, dto.friendlyName);
  }

  @Post("verify")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyEnrolmentDto) {
    return this.mfa.verifyEnrolment(user.id, dto.factorId, dto.code);
  }

  @Delete("factors/:id")
  @UseGuards(JwtAuthGuard)
  unenroll(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.mfa.unenroll(user.id, id);
  }

  /**
   * Completes a login that stopped at the second factor. No guard: the challenge id
   * plus a valid code is the credential here.
   */
  @Post("challenge")
  @HttpCode(200)
  async challenge(@Body() dto: ChallengeDto, @Req() req: Request) {
    const userId = await this.mfa.redeemChallenge(dto.challengeId, dto.code);
    return this.auth.issueForUserId(userId, req.get("user-agent") ?? undefined);
  }
}
