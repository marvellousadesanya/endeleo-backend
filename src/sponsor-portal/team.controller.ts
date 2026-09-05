import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { TeamService } from "./team.service";
import { InviteTeamMemberDto, UpdateTeamMemberDto } from "./dto/team.dto";

@Controller("sponsor/team")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.team.list(user);
  }

  @Post("invite")
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteTeamMemberDto) {
    return this.team.invite(user, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.team.updateRole(user, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.team.remove(user, id);
  }
}
