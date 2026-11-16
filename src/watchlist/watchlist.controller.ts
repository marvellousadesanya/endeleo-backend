import { Controller, Delete, Get, Param, ParseUUIDPipe, Put, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { WatchlistService } from "./watchlist.service";

// PUT/DELETE on the bond's own path rather than POST-a-body: both are idempotent, so a
// double-tapped star (or a retried request) lands in the same state either way.
@Controller("watchlist")
@UseGuards(JwtAuthGuard)
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.watchlist.bondIds(user.id);
  }

  @Put(":bondId")
  add(@CurrentUser() user: AuthUser, @Param("bondId", ParseUUIDPipe) bondId: string) {
    return this.watchlist.add(user.id, bondId);
  }

  @Delete(":bondId")
  remove(@CurrentUser() user: AuthUser, @Param("bondId", ParseUUIDPipe) bondId: string) {
    return this.watchlist.remove(user.id, bondId);
  }
}
