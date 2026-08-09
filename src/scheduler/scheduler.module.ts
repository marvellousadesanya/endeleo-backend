import { Global, Module } from "@nestjs/common";
import { JobLockService } from "./job-lock.service";

// Global so any domain module can schedule work without re-importing the lock.
@Global()
@Module({ providers: [JobLockService], exports: [JobLockService] })
export class SchedulerModule {}
