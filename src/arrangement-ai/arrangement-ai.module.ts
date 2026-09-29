import { Global, Module } from "@nestjs/common";
import { ArrangementAiService } from "./arrangement-ai.service";

// Global so any module can ask for an opinion without a dependency edge back here —
// the same posture as EmailModule and NotificationsModule.
@Global()
@Module({
  providers: [ArrangementAiService],
  exports: [ArrangementAiService],
})
export class ArrangementAiModule {}
