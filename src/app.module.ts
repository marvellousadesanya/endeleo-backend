import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AuditModule } from "@/audit/audit.module";
import { AuthModule } from "@/auth/auth.module";
import { BondsModule } from "@/bonds/bonds.module";
import { validateEnv } from "@/config/env";
import { DatabaseModule } from "@/database/database.module";
import { HealthModule } from "@/health/health.module";
import { SchedulerModule } from "@/scheduler/scheduler.module";
import { UsersModule } from "@/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Fails fast at boot on a bad or missing environment.
      validate: validateEnv,
      envFilePath: [".env.local", ".env"],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    SchedulerModule,
    UsersModule,
    AuditModule,
    AuthModule,
    BondsModule,
    HealthModule,
  ],
})
export class AppModule {}
