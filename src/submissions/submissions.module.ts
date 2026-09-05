import { Module } from "@nestjs/common";
import { BondsModule } from "@/bonds/bonds.module";
import { SubmissionsAdminController } from "./submissions-admin.controller";
import { SubmissionsController } from "./submissions.controller";
import { SubmissionsService } from "./submissions.service";

@Module({
  imports: [BondsModule],
  controllers: [SubmissionsController, SubmissionsAdminController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
