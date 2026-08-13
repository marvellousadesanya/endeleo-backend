import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { MarketService } from "./market.service";
import { BuyDto, CreateListingDto } from "./dto/bonds.dto";

@Controller("market")
@UseGuards(JwtAuthGuard)
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get("listings")
  listings(@Query("bondId") bondId?: string) {
    return this.market.activeListings(bondId);
  }

  @Get("trades")
  myTrades(@CurrentUser() user: AuthUser) {
    return this.market.myTrades(user.id);
  }

  @Post("listings")
  createListing(@Body() dto: CreateListingDto, @CurrentUser() user: AuthUser) {
    return this.market.createListing(dto, user.id);
  }

  @Post("listings/:id/cancel")
  cancelListing(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.market.cancelListing(id, user);
  }

  @Post("buy")
  buy(@Body() dto: BuyDto, @CurrentUser() user: AuthUser) {
    return this.market.buy(dto.listingId, dto.unitsMinor, user);
  }
}
