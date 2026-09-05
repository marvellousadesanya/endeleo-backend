// Bond issuance, browsing and the register.
import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { BondsService } from "./bonds.service";
import { ReportsService } from "./reports.service";
import { ChangeStatusDto, CreateBondDto, RecordEscrowDto } from "./dto/bonds.dto";

const MAX_COVER_BYTES = 5 * 1024 * 1024;

@Controller("bonds")
@UseGuards(JwtAuthGuard, RolesGuard)
export class BondsController {
  constructor(
    private readonly bonds: BondsService,
    private readonly reports: ReportsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.bonds.listVisible(user);
  }

  @Get("holdings")
  holdings(@CurrentUser() user: AuthUser) {
    return this.bonds.holdingsFor(user.id);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bonds.findOne(id, user);
  }

  @Get(":id/register")
  register(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bonds.register(id, user);
  }

  @Get(":id/audit")
  audit(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.reports.auditTrail(id, user);
  }

  @Post()
  @Roles("admin", "issuer")
  create(@Body() dto: CreateBondDto, @CurrentUser() user: AuthUser) {
    return this.bonds.create(dto, user.id);
  }

  /** Set or replace a bond's cover image. Sent right after create, or on its own later. */
  @Post(":id/cover")
  @Roles("admin", "issuer")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_COVER_BYTES } }))
  setCover(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.bonds.setCoverImage(id, user, file);
  }

  @Patch(":id/status")
  @Roles("admin")
  changeStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bonds.changeStatus(id, dto.status, user.id);
  }

  @Post("escrow")
  @Roles("admin")
  recordEscrow(@Body() dto: RecordEscrowDto, @CurrentUser() user: AuthUser) {
    return this.reports.recordEscrowDeposit(dto, user.id);
  }
}
