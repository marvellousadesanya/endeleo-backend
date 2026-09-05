import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AuditModule } from "@/audit/audit.module";
import { AuthModule } from "@/auth/auth.module";
import { BondsModule } from "@/bonds/bonds.module";
import { validateEnv } from "@/config/env";
import { DatabaseModule } from "@/database/database.module";
import { HealthModule } from "@/health/health.module";
import { ProfilesModule } from "@/profiles/profiles.module";
import { WalletModule } from "@/wallet/wallet.module";
import { ReferralsModule } from "@/referrals/referrals.module";
import { AdminModule } from "@/admin/admin.module";
import { ContentModule } from "@/content/content.module";
import { DataRoomModule } from "@/data-room/data-room.module";
import { StorageModule } from "@/storage/storage.module";
import { SubmissionsModule } from "@/submissions/submissions.module";
import { SchedulerModule } from "@/scheduler/scheduler.module";
import { UsersModule } from "@/users/users.module";
import { SponsorPortalModule } from "@/sponsor-portal/sponsor-portal.module";

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
    ProfilesModule,
    WalletModule,
    ReferralsModule,
    StorageModule,
    AdminModule,
    DataRoomModule,
    ContentModule,
    SubmissionsModule,
    SponsorPortalModule,
    HealthModule,
  ],
})
export class AppModule {}
