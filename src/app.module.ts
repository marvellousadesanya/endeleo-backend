import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "@/auth/auth.module";
import { validateEnv } from "@/config/env";
import { DatabaseModule } from "@/database/database.module";
import { HealthModule } from "@/health/health.module";
import { UsersModule } from "@/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Fails fast at boot on a bad or missing environment.
      validate: validateEnv,
      envFilePath: [".env.local", ".env"],
    }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
