import {
  BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, UploadedFile,
  UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { SubmitKycDto, UpdateProfileDto } from "./dto/profiles.dto";
import { ProfilesService } from "./profiles.service";

/** Every route is scoped to the caller — there is no "read another user's profile" here. */
@Controller("profile")
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.profiles.findForUser(user.id);
  }

  @Get("roles")
  roles(@CurrentUser() user: AuthUser) {
    return this.profiles.rolesFor(user.id);
  }

  @Patch("me")
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user.id, dto);
  }

  @Post("kyc")
  @HttpCode(200)
  submitKyc(@CurrentUser() user: AuthUser, @Body() dto: SubmitKycDto) {
    return this.profiles.submitKyc(user.id, dto);
  }

  /** 8MB matches what the KYC form already enforces client-side. */
  @Post("kyc/documents")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024 } }))
  uploadKycDocument(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("A file is required");
    return this.profiles.uploadKycDocument(user.id, file);
  }
}
