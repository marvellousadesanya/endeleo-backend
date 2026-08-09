// Validates the access token on every protected request.
//
// The token is only a claim of identity — we re-read the user so that a suspended
// account or a revoked role takes effect immediately, rather than lingering until the
// access token expires.
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { UsersService } from "@/users/users.service";

export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
  kycTier: number;
}

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.status !== "active") throw new UnauthorizedException();
    return { id: user.id, email: user.email, roles: user.roles, kycTier: user.kyc_tier };
  }
}
