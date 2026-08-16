import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { LoginDto, RefreshDto, RegisterDto } from "./dto/auth.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import type { AuthUser } from "./jwt.strategy";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req.get("user-agent") ?? undefined);
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, req.get("user-agent") ?? undefined);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  /** Revokes every refresh token for the caller — "sign out of all devices". */
  @Post("logout-all")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.revokeAllForUser(user.id);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
