import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req,
  UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { DataRoomService } from "./data-room.service";
import { SignDocumentDto, UpsertDocumentDto } from "./dto/data-room.dto";

/** Uploads are capped here; a data-room document is a prospectus, not a video. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Controller("data-room")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataRoomController {
  constructor(private readonly dataRoom: DataRoomService) {}

  @Get("documents")
  list(@CurrentUser() user: AuthUser, @Query("bondId") bondId?: string) {
    return this.dataRoom.list(user, bondId);
  }

  /**
   * Returns a short-lived, presigned URL the browser loads directly from R2 — the
   * access check happens here, not on the URL itself, which carries no session.
   */
  @Post("documents/:id/download")
  @HttpCode(200)
  download(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.dataRoom.createDownloadToken(user, id);
  }

  @Post("documents/sign")
  @HttpCode(200)
  sign(@CurrentUser() user: AuthUser, @Body() dto: SignDocumentDto, @Req() req: Request) {
    return this.dataRoom.sign(user, dto, req.ip);
  }

  @Get("admin/documents")
  @Roles("admin", "editor")
  listAdmin(@Query("bondId") bondId?: string) {
    return this.dataRoom.listForAdmin(bondId);
  }

  @Post("admin/documents")
  @Roles("admin", "editor")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upsert(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.dataRoom.upsertDocument(dto, user.id, file);
  }

  @Delete("admin/documents/:id")
  @Roles("admin", "editor")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.dataRoom.deleteDocument(id);
  }
}
