import { Module } from "@nestjs/common";
import { ApplicationsController, ContentController, UsersAdminController } from "./admin.controller";
import { ContentService } from "./content.service";
import { UsersAdminService } from "./users-admin.service";

@Module({
  controllers: [ContentController, UsersAdminController, ApplicationsController],
  providers: [ContentService, UsersAdminService],
})
export class AdminModule {}
