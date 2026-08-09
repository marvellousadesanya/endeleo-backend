// Authentication: passwords, access tokens, and rotating refresh tokens.
//
// Design notes worth keeping:
//   * Argon2id for password hashing — memory-hard, so GPU cracking is expensive.
//   * Refresh tokens are stored as SHA-256 hashes. A database leak therefore does not
//     hand an attacker usable sessions.
//   * Refresh tokens rotate on every use. Replaying a rotated token is treated as theft
//     and revokes the entire session family.
import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import { DB, type Db } from "@/database/database.module";
import { UsersService, type UserWithRoles } from "@/users/users.service";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: { id: string; email: string; fullName: string | null; roles: string[]; kycTier: number };
}

/** Opaque random string — a refresh token carries no claims, it is just a lookup key. */
function newRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** "30d" / "15m" / "3600" → milliseconds. */
function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const value = Number(match[1]);
  const unit = match[2] ?? "s";
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return value * multiplier;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: { email: string; password: string; fullName?: string }): Promise<AuthResult> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) throw new ConflictException("An account with that email already exists");

    const passwordHash = await argonHash(input.password);
    const user = await this.users.createWithPassword({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
    });
    return this.issue(user);
  }

  async login(input: { email: string; password: string }, userAgent?: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);

    // Verify against a dummy hash when the user is unknown, so the response time does
    // not reveal whether an email is registered.
    const storedHash = user ? await this.users.passwordHashFor(user.id) : undefined;
    const ok = storedHash
      ? await argonVerify(storedHash, input.password).catch(() => false)
      : await argonVerify(DUMMY_HASH, input.password).catch(() => false);

    if (!user || !ok) throw new UnauthorizedException("Invalid email or password");
    if (user.status !== "active") throw new UnauthorizedException("Account is not active");

    const roles = await this.users.rolesFor(user.id);
    return this.issue({ ...user, roles }, userAgent);
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * If the presented token exists but has already been rotated or revoked, we treat it
   * as a stolen token and revoke every live session for that user.
   */
  async refresh(token: string, userAgent?: string): Promise<AuthResult> {
    const tokenHash = hashToken(token);
    const row = await this.db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();

    if (!row) throw new UnauthorizedException("Invalid refresh token");

    if (row.revoked_at || row.replaced_by) {
      await this.revokeAllForUser(row.user_id);
      throw new UnauthorizedException("Refresh token reuse detected — all sessions revoked");
    }
    if (new Date(row.expires_at) < new Date()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    const user = await this.users.findById(row.user_id);
    if (!user || user.status !== "active") throw new UnauthorizedException("Account is not active");

    const issued = await this.issue(user, userAgent);
    await this.db
      .updateTable("refresh_tokens")
      .set({ revoked_at: new Date(), replaced_by: issued.refreshTokenId })
      .where("id", "=", row.id)
      .execute();

    return issued;
  }

  async logout(token: string): Promise<void> {
    await this.db
      .updateTable("refresh_tokens")
      .set({ revoked_at: new Date() })
      .where("token_hash", "=", hashToken(token))
      .where("revoked_at", "is", null)
      .execute();
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .updateTable("refresh_tokens")
      .set({ revoked_at: new Date() })
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .execute();
  }

  private async issue(
    user: UserWithRoles,
    userAgent?: string,
  ): Promise<AuthResult & { refreshTokenId: string }> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, roles: user.roles, kycTier: user.kyc_tier },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        // Seconds, so the config value stays a plain string like "15m" without
        // depending on jsonwebtoken's narrow template-literal type.
        expiresIn: Math.floor(ttlToMs(this.config.getOrThrow<string>("JWT_ACCESS_TTL")) / 1000),
      },
    );

    const refreshToken = newRefreshToken();
    const expiresAt = new Date(
      Date.now() + ttlToMs(this.config.getOrThrow<string>("JWT_REFRESH_TTL")),
    );
    const stored = await this.db
      .insertInto("refresh_tokens")
      .values({
        user_id: user.id,
        token_hash: hashToken(refreshToken),
        expires_at: expiresAt,
        user_agent: userAgent ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return {
      accessToken,
      refreshToken,
      refreshTokenId: stored.id,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roles: user.roles,
        kycTier: user.kyc_tier,
      },
    };
  }
}

// A real Argon2id hash of a random value, used only to equalise login timing.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8sBv3Ck5pKcHXBLPB7Y5wRfKQvV0KJmJqQz1nH0mS1o";
