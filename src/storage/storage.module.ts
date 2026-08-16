import { Global, Module } from "@nestjs/common";
import { StorageService } from "./storage.service";

// Global: the data room, project submissions and KYC all need it, and threading it
// through three separate module imports buys nothing.
@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
