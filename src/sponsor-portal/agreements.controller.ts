import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { AgreementsService } from "./agreements.service";
import { SignAgreementDto, UpsertAgreementDto } from "./dto/agreements.dto";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get("sponsor/agreements")
  list(@CurrentUser() user: AuthUser, @Query("bondId", ParseUUIDPipe) bondId: string) {
    return this.agreements.listForSponsor(user, bondId);
  }

  @Post("sponsor/agreements/:id/download")
  @HttpCode(200)
  download(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.agreements.createDownloadToken(user, id);
  }

  @Post("sponsor/agreements/sign")
  @HttpCode(200)
  sign(@CurrentUser() user: AuthUser, @Body() dto: SignAgreementDto) {
    return this.agreements.sign(user, dto);
  }

  @Get("admin/sponsor-portal/agreements")
  @Roles("admin")
  listAdmin(@Query("bondId") bondId?: string) {
    return this.agreements.listForAdmin(bondId);
  }

  @Post("admin/sponsor-portal/agreements")
  @Roles("admin")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upsert(@Body() dto: UpsertAgreementDto, @UploadedFile() file?: Express.Multer.File) {
    return this.agreements.upsert(dto, file);
  }

  @Delete("admin/sponsor-portal/agreements/:id")
  @Roles("admin")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.agreements.delete(id);
  }
}
