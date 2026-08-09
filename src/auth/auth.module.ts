import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { UsersModule } from "@/users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { RefreshTokenCleanup } from "./refresh-token.cleanup";
import { GoogleProvider } from "./oauth/google.provider";
import { OAuthController } from "./oauth/oauth.controller";
import { OAuthService } from "./oauth/oauth.service";

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController, OAuthController],
  providers: [AuthService, JwtStrategy, RefreshTokenCleanup, GoogleProvider, OAuthService],
  exports: [AuthService],
})
export class AuthModule {}
