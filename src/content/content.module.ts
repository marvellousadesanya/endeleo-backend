import { Module } from "@nestjs/common";
import { ContentService } from "@/admin/content.service";
import { PublicApplicationsController, PublicContentController } from "./content.controller";

@Module({
  controllers: [PublicContentController, PublicApplicationsController],
  providers: [ContentService],
})
export class ContentModule {}
