import { Module } from "@nestjs/common";
import { BondsModule } from "@/bonds/bonds.module";
import { ArrangementService } from "./arrangement/arrangement.service";
import { SubmissionsAdminController } from "./submissions-admin.controller";
import { SubmissionsController } from "./submissions.controller";
import { SubmissionsService } from "./submissions.service";

@Module({
  imports: [BondsModule],
  controllers: [SubmissionsController, SubmissionsAdminController],
  providers: [SubmissionsService, ArrangementService],
})
export class SubmissionsModule {}
