import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/jwt.strategy";
import { DocumentsService } from "./documents.service";

// The signed-in user's own documents. Signed agreements download through the data room's
// existing endpoint; only KYC files need a route of their own.
@Controller("documents")
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.documents.mine(user.id);
  }

  /** POST, like the data room's download: minting a link is an action, not a read. */
  @Post("kyc/:key/download")
  @HttpCode(200)
  kycDownload(@CurrentUser() user: AuthUser, @Param("key") key: string) {
    return this.documents.kycDownload(user.id, key);
  }
}
