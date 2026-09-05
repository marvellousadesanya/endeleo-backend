// Sponsor submissions, admin side: review them, then promote an approved one into the
// bond investors actually see. Kept apart from SubmissionsController — that one is the
// public intake surface, this one is admin-only and touches a different service shape.
import {
  Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from "@nestjs/common";
import type { SubmissionStatus } from "@prisma/client";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import { PromoteSubmissionDto, ReviewSubmissionDto } from "./dto/submissions.dto";
import { SubmissionsService } from "./submissions.service";

@Controller("admin/submissions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class SubmissionsAdminController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get()
  list(@Query("status") status?: SubmissionStatus) {
    return this.submissions.listAll(status);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.submissions.findOne(id);
  }

  @Get(":id/attachments/:index/download")
  attachmentDownload(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("index", ParseIntPipe) index: number,
  ) {
    return this.submissions.getAttachmentDownloadUrl(id, index);
  }

  /** Moves a submission to in_review / approved / rejected, with reviewer notes. */
  @Patch(":id")
  review(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ReviewSubmissionDto) {
    return this.submissions.review(id, dto);
  }

  /** Creates the investor-facing bond from an approved submission and links the two. */
  @Post(":id/promote")
  promote(@Param("id", ParseUUIDPipe) id: string, @Body() dto: PromoteSubmissionDto) {
    return this.submissions.promote(id, dto);
  }
}
