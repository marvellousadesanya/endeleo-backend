// Unauthenticated reads and the investor intake form. Deliberately outside the admin
// module: everything here is reachable without a session, so it must not sit behind a
// controller that carries guards.
import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ContentService } from "@/admin/content.service";
import { PrismaService } from "@/database/prisma.service";
import { SubmitApplicationDto } from "./dto/content.dto";

@Controller("content")
export class PublicContentController {
  constructor(private readonly content: ContentService) {}

  @Get("posts")
  posts() {
    return this.content.listPublishedPosts();
  }

  @Get("posts/:slug")
  post(@Param("slug") slug: string) {
    return this.content.publishedBySlug(slug);
  }

  @Get("updates")
  updates(@Query("projectSlug") projectSlug: string) {
    return this.content.listPublicUpdates(projectSlug ?? "");
  }
}

@Controller("applications")
export class PublicApplicationsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Investor intake from the marketing site. Public by design. */
  @Post()
  @HttpCode(200)
  async submit(@Body() dto: SubmitApplicationDto) {
    await this.prisma.investorApplication.create({
      data: {
        fullName: dto.fullName,
        email: dto.email.toLowerCase(),
        country: dto.country || null,
        investorType: dto.investorType ?? "retail",
        ticketRange: dto.ticketRange || null,
        sectors: dto.sectors ?? [],
        heardFrom: dto.heardFrom || null,
        utmSource: dto.utmSource || null,
        utmMedium: dto.utmMedium || null,
        utmCampaign: dto.utmCampaign || null,
        referrer: dto.referrer || null,
        landingPath: dto.landingPath || null,
        firm: dto.firm || null,
        role: dto.role || null,
        organizationType: dto.organizationType || null,
        timeline: dto.timeline || null,
        linkedinUrl: dto.linkedinUrl || null,
        notes: dto.notes || null,
      },
    });
    return { ok: true as const };
  }
}
