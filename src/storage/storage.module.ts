import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { R2Storage } from "./r2.storage";
import { StorageService } from "./storage.service";

// Global: the data room, project submissions and KYC all need it, and threading it
// through three separate module imports buys nothing.
//
// R2 is the only driver — see storage.service.ts for why the local-disk one was
// removed. R2_* being required at all is enforced by validateEnv (src/config/env.ts),
// so a missing variable fails at boot rather than here.
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: (config: ConfigService) => new R2Storage(config),
      inject: [ConfigService],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
