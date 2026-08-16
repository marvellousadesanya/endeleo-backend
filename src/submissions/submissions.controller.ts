import {
  Body, Controller, Get, Post, UploadedFiles, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { CreateSubmissionDto } from "./dto/submissions.dto";
import { SubmissionsService } from "./submissions.service";

const MAX_FILES = 10;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@Controller("submissions")
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /**
   * Public on purpose — a sponsor can propose a project before they have an account,
   * which is how the marketing funnel feeds this. Files arrive with the form rather
   * than being uploaded separately first.
   */
  @Post()
  @UseInterceptors(FilesInterceptor("files", MAX_FILES, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  create(@Body() dto: CreateSubmissionDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.submissions.create(dto, files ?? []);
  }

  @Get("mine")
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.submissions.listMine(user.id);
  }
}
