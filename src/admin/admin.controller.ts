import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { ContentService } from "./content.service";
import { CreateProjectUpdateDto, SetUserRoleDto, UpsertPostDto } from "./dto/admin.dto";
import { UsersAdminService } from "./users-admin.service";

/** Editorial surface: posts and project updates. Editors and admins. */
@Controller("admin/content")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "editor")
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get("posts")
  listPosts() {
    return this.content.listPosts();
  }

  @Get("posts/:idOrSlug")
  getPost(@Param("idOrSlug") idOrSlug: string) {
    return this.content.getPost(idOrSlug);
  }

  @Post("posts")
  upsertPost(@Body() dto: UpsertPostDto, @CurrentUser() user: AuthUser) {
    return this.content.upsertPost(dto, user.id);
  }

  @Delete("posts/:id")
  deletePost(@Param("id", ParseUUIDPipe) id: string) {
    return this.content.deletePost(id);
  }

  @Get("updates")
  listUpdates(@Query("projectSlug") projectSlug?: string) {
    return this.content.listProjectUpdates(projectSlug);
  }

  @Post("updates")
  createUpdate(@Body() dto: CreateProjectUpdateDto, @CurrentUser() user: AuthUser) {
    return this.content.createProjectUpdate(dto, user.id);
  }

  @Delete("updates/:id")
  deleteUpdate(@Param("id", ParseUUIDPipe) id: string) {
    return this.content.deleteProjectUpdate(id);
  }
}

/** User administration and role grants. Admins only — editors must not reach this. */
@Controller("admin/users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class UsersAdminController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post("role")
  @HttpCode(200)
  setRole(@CurrentUser() actor: AuthUser, @Body() dto: SetUserRoleDto) {
    return this.users.setRole(actor.id, dto.userId, dto.role, dto.grant);
  }
}

/** Investor intake. Its own path — an application is not a user. */
@Controller("admin/applications")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class ApplicationsController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  list() {
    return this.users.listApplications();
  }
}
