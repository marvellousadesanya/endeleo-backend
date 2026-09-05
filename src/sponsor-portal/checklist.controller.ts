import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { ChecklistService } from "./checklist.service";
import {
  AdminUpdateChecklistItemDto, CreateChecklistItemDto, SponsorUpdateChecklistItemDto,
} from "./dto/checklist.dto";

type ChecklistKind = "compliance" | "due_diligence";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChecklistController {
  constructor(private readonly checklist: ChecklistService) {}

  @Get("sponsor/checklist")
  list(
    @CurrentUser() user: AuthUser,
    @Query("bondId", ParseUUIDPipe) bondId: string,
    @Query("kind") kind?: ChecklistKind,
  ) {
    return this.checklist.listForSponsor(user, bondId, kind);
  }

  @Patch("sponsor/checklist/:id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SponsorUpdateChecklistItemDto,
  ) {
    return this.checklist.updateAsSponsor(user, id, dto);
  }

  @Get("admin/sponsor-portal/checklist")
  @Roles("admin")
  listAdmin(@Query("bondId") bondId?: string, @Query("kind") kind?: ChecklistKind) {
    return this.checklist.listForAdmin(bondId, kind);
  }

  @Post("admin/sponsor-portal/checklist")
  @Roles("admin")
  create(@Body() dto: CreateChecklistItemDto) {
    return this.checklist.createItem(dto);
  }

  @Patch("admin/sponsor-portal/checklist/:id")
  @Roles("admin")
  updateAdmin(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateChecklistItemDto,
  ) {
    return this.checklist.updateAsAdmin(id, dto, user.id);
  }

  @Delete("admin/sponsor-portal/checklist/:id")
  @Roles("admin")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.checklist.deleteItem(id);
  }
}
