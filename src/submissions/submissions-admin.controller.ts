// Sponsor submissions, admin side: review them, then promote an approved one into the
// bond investors actually see. Kept apart from SubmissionsController — that one is the
// public intake surface, this one is admin-only and touches a different service shape.
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post,
  Query, UseGuards,
} from "@nestjs/common";
import type { SubmissionStatus } from "@prisma/client";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import { ArrangementService } from "./arrangement/arrangement.service";
import { CurrentUser } from "@/auth/current-user.decorator";
import type { AuthUser } from "@/auth/jwt.strategy";
import { ApproveModuleDto, PromoteSubmissionDto, ReviewSubmissionDto } from "./dto/submissions.dto";
import { SubmissionsService } from "./submissions.service";

@Controller("admin/submissions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class SubmissionsAdminController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly arrangementService: ArrangementService,
  ) {}

  @Get()
  list(@Query("status") status?: SubmissionStatus) {
    return this.submissions.listAll(status);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.submissions.findOne(id);
  }

  /**
   * The M2/M3/M5 arrangement screen — DSCR table, bankability score, and rule-based
   * structuring and pricing recommendations. Computed live, not stored; see
   * ArrangementService for why.
   */
  @Get(":id/arrangement")
  arrangement(@Param("id", ParseUUIDPipe) id: string) {
    return this.arrangementService.computeFor(id);
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

  /** Which stages of this deal have been signed off, and by whom. */
  @Get(":id/approvals")
  approvals(@Param("id", ParseUUIDPipe) id: string) {
    return this.submissions.moduleApprovals(id);
  }

  /**
   * Sign off one stage of the pipeline. Refused out of order — see module-gates.ts.
   */
  @Post(":id/approvals/:module")
  @HttpCode(200)
  approveModule(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("module") module: string,
    @Body() dto: ApproveModuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.submissions.approveModule(id, module, user.id, dto.note);
  }

  /** Withdraw a sign-off, and everything downstream of it. */
  @Delete(":id/approvals/:module")
  revokeModule(@Param("id", ParseUUIDPipe) id: string, @Param("module") module: string) {
    return this.submissions.revokeModule(id, module);
  }

  /** Creates the investor-facing bond from an approved submission and links the two. */
  @Post(":id/promote")
  promote(@Param("id", ParseUUIDPipe) id: string, @Body() dto: PromoteSubmissionDto) {
    return this.submissions.promote(id, dto);
  }
}
