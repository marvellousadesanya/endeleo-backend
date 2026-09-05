import { Module } from "@nestjs/common";
import { ChecklistController } from "./checklist.controller";
import { ChecklistService } from "./checklist.service";
import { AgreementsController } from "./agreements.controller";
import { AgreementsService } from "./agreements.service";
import { FundingController } from "./funding.controller";
import { FundingService } from "./funding.service";
import { TeamController } from "./team.controller";
import { TeamService } from "./team.service";
import { SponsorAnalyticsController } from "./analytics.controller";
import { SponsorAnalyticsService } from "./analytics.service";

/** The sponsor's deal-management workspace: checklists, agreements, funding, team, analytics. */
@Module({
  controllers: [
    ChecklistController,
    AgreementsController,
    FundingController,
    TeamController,
    SponsorAnalyticsController,
  ],
  providers: [ChecklistService, AgreementsService, FundingService, TeamService, SponsorAnalyticsService],
})
export class SponsorPortalModule {}
