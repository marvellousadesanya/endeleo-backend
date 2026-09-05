import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { FundingService } from "./funding.service";
import { CreateMilestoneDto, UpdateMilestoneDto } from "./dto/funding.dto";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class FundingController {
  constructor(private readonly funding: FundingService) {}

  @Get("sponsor/funding")
  overview(@CurrentUser() user: AuthUser, @Query("bondId", ParseUUIDPipe) bondId: string) {
    return this.funding.overviewForSponsor(user, bondId);
  }

  @Get("admin/sponsor-portal/funding")
  @Roles("admin")
  listAdmin(@Query("bondId") bondId?: string) {
    return this.funding.listForAdmin(bondId);
  }

  @Post("admin/sponsor-portal/funding")
  @Roles("admin")
  create(@Body() dto: CreateMilestoneDto) {
    return this.funding.createMilestone(dto);
  }

  @Patch("admin/sponsor-portal/funding/:id")
  @Roles("admin")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateMilestoneDto) {
    return this.funding.updateMilestone(id, dto);
  }

  @Delete("admin/sponsor-portal/funding/:id")
  @Roles("admin")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.funding.deleteMilestone(id);
  }
}
