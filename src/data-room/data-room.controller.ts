import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { StorageService } from "@/storage/storage.service";
import { DataRoomService } from "./data-room.service";
import { SignDocumentDto, UpsertDocumentDto } from "./dto/data-room.dto";

/** Uploads are capped here; a data-room document is a prospectus, not a video. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Controller("data-room")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataRoomController {
  constructor(
    private readonly dataRoom: DataRoomService,
    private readonly storage: StorageService,
  ) {}

  @Get("documents")
  list(@CurrentUser() user: AuthUser, @Query("bondId") bondId?: string) {
    return this.dataRoom.list(user, bondId);
  }

  @Post("documents/:id/download")
  @HttpCode(200)
  download(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.dataRoom.createDownloadToken(user, id);
  }

  /**
   * Streams the bytes. The token carries the authorisation, so this route is reachable
   * with a session but proves nothing without a token bound to this user and document.
   */
  @Get("documents/:id/file")
  async file(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("token") token: string,
    @Res() res: Response,
  ) {
    const doc = await this.dataRoom.resolveDownload(id, user.id, token ?? "");
    const stream = await this.storage.openStream(doc.filePath);
    res.setHeader("Content-Type", doc.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    stream.pipe(res);
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
