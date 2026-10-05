import { Global, Module } from "@nestjs/common";
import { MacroService } from "./macro.service";

// Global, like EmailModule and NotificationsModule: the arrangement screen wants it and
// so will anything that later reasons about the market, without a dependency edge back.
@Global()
@Module({
  providers: [MacroService],
  exports: [MacroService],
})
export class MacroModule {}
