// Authentication: passwords, access tokens, and rotating refresh tokens.
//
// Design notes worth keeping:
//   * Argon2id for password hashing — memory-hard, so GPU cracking is expensive.
//   * Refresh tokens are stored as SHA-256 hashes. A database leak therefore does not
//     hand an attacker usable sessions.
//   * Refresh tokens rotate on every use. Replaying a rotated token is treated as theft
//     and revokes the entire session family.
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "@/database/prisma.service";
import { UsersService, type UserWithRoles } from "@/users/users.service";
import { EmailService } from "@/email/email.service";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "./auth-emails";
import { deviceSignature, isUnrecognisedDevice, signInAlertEmail } from "./sign-in-alert";
import { MfaService } from "./mfa/mfa.service";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Returned by login when a second factor stands between the password and a session. */
export interface MfaRequired {
  mfaRequired: true;
  challengeId: string;
  expiresAt: string;
}

export interface AuthResult extends TokenPair {
  user: { id: string; email: string; fullName: string | null; roles: string[]; kycTier: number };
}

/**
 * How long a password reset link lives.
 *
 * Short on purpose: the link is a bearer credential sitting in an inbox, and the
 * person asking for it is, by definition, at their keyboard right now.
 */
const PASSWORD_RESET_TTL_MS = 60 * 60_000;

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
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mfa: MfaService,
    private readonly email: EmailService,
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

    // Not awaited: a signup must not hang because a mail provider is slow.
    void sendWelcomeEmail(
      this.email,
      this.config.getOrThrow<string>("FRONTEND_URL"),
      user.email,
      input.fullName,
    );

    return this.issue(user);
  }

  /**
   * Returns a token pair, or — when the account has a verified second factor — an
   * MfaChallenge instead. The challenge proves only that the password was right; the
   * caller must redeem it with a code at /auth/mfa/challenge to get tokens.
   */
  async login(
    input: { email: string; password: string },
    userAgent?: string,
  ): Promise<AuthResult | MfaRequired> {
    const user = await this.users.findByEmail(input.email);

    // Verify against a dummy hash when the user is unknown, so the response time does
    // not reveal whether an email is registered.
    const storedHash = user ? await this.users.passwordHashFor(user.id) : undefined;
    const ok = storedHash
      ? await argonVerify(storedHash, input.password).catch(() => false)
      : await argonVerify(DUMMY_HASH, input.password).catch(() => false);

    if (!user || !ok) throw new UnauthorizedException("Invalid email or password");
    if (user.status !== "active") throw new UnauthorizedException("Account is not active");

    if (await this.mfa.hasVerifiedFactor(user.id)) {
      const { challengeId, expiresAt } = await this.mfa.createChallenge(user.id, userAgent);
      return { mfaRequired: true, challengeId, expiresAt: expiresAt.toISOString() };
    }

    // Read the device history before issue() writes this session's row — afterwards
    // the new row would match itself and no device would ever look new.
    const unrecognised = await this.isNewDevice(user.id, userAgent);
    const issued = await this.issue(user, userAgent);
    if (unrecognised) void this.alertNewDevice(user.id, userAgent);
    return issued;
  }

  /** True when this account has history but none of it is from a device like this one. */
  private async isNewDevice(userId: string, userAgent?: string): Promise<boolean> {
    const prior = await this.prisma.refreshToken.findMany({
      where: { userId },
      select: { userAgent: true },
      // Enough to cover the devices someone actually uses; an account with hundreds of
      // sessions does not need all of them loaded to answer this.
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    return isUnrecognisedDevice(userAgent, prior.map((p) => p.userAgent));
  }

  /** Best-effort: never let a mail failure turn a successful sign-in into an error. */
  private async alertNewDevice(userId: string, userAgent?: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) return;
      const { subject, html } = signInAlertEmail({
        device: deviceSignature(userAgent),
        when: new Date(),
        frontendUrl: this.config.getOrThrow<string>("FRONTEND_URL"),
      });
      await this.email.send(user.email, subject, html);
    } catch {
      // Swallowed: the sign-in itself has already succeeded.
    }
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * If the presented token exists but has already been rotated or revoked, we treat it
   * as a stolen token and revoke every live session for that user.
   */
  async refresh(token: string, userAgent?: string): Promise<AuthResult> {
    const tokenHash = hashToken(token);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!row) throw new UnauthorizedException("Invalid refresh token");

    if (row.revokedAt || row.replacedBy) {
      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedException("Refresh token reuse detected — all sessions revoked");
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    const user = await this.users.findById(row.userId);
    if (!user || user.status !== "active") throw new UnauthorizedException("Account is not active");

    const issued = await this.issue(user, userAgent);
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), replacedBy: issued.refreshTokenId },
    });

    return issued;
  }

  async logout(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Issue a session for a user whose identity has already been established elsewhere —
   * currently the social sign-in flow, which verified them via the provider.
   */
  async issueForUserId(userId: string, userAgent?: string): Promise<AuthResult> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException("User not found");
    if (user.status !== "active") throw new UnauthorizedException("Account is not active");

    const unrecognised = await this.isNewDevice(user.id, userAgent);
    const issued = await this.issue(user, userAgent);
    if (unrecognised) void this.alertNewDevice(user.id, userAgent);
    return issued;
  }

  // ---- Password reset ------------------------------------------------------

  /**
   * Start a reset.
   *
   * Always resolves the same way, whether or not the address has an account. Answering
   * differently — a 404, a slower response, a different message — turns this endpoint
   * into a way to test which email addresses are registered on a financial platform.
   * The caller is told "if that address has an account, we've sent a link" regardless.
   *
   * Any earlier unused tokens for the account are consumed first, so a fresh request
   * silently invalidates a link that may already be sitting in a stolen inbox.
   */
  async forgotPassword(email: string, userAgent?: string): Promise<{ ok: true }> {
    const user = await this.users.findByEmail(email);

    if (user && user.status === "active") {
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const token = randomBytes(32).toString("base64url");
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
          userAgent: userAgent ?? null,
        },
      });

      await sendPasswordResetEmail(
        this.email,
        this.config.getOrThrow<string>("FRONTEND_URL"),
        user.email,
        token,
        PASSWORD_RESET_TTL_MS / 60_000,
      );
    }

    return { ok: true };
  }

  /**
   * Finish a reset.
   *
   * Everything that must not half-happen runs in one transaction: the token is spent,
   * the password is replaced, and every existing session is revoked. That last part is
   * the point — if the reset was triggered because someone else had the account,
   * leaving their refresh token alive would hand it straight back to them.
   *
   * Unlike the request step, this one does report failure. There is no enumeration risk
   * in saying a token is invalid: the caller already holds it.
   */
  async resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true, status: true } } },
    });

    if (!row) throw new BadRequestException("That reset link is not valid");
    if (row.usedAt) throw new BadRequestException("That reset link has already been used");
    if (row.expiresAt < new Date()) throw new BadRequestException("That reset link has expired");
    if (row.user.status !== "active") throw new UnauthorizedException("Account is not active");

    const passwordHash = await argonHash(newPassword);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.userCredential.upsert({
        where: { userId: row.user.id },
        // An account created through Google has no credential row yet; a reset is a
        // legitimate way to add a password to it.
        create: { userId: row.user.id, passwordHash },
        update: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: row.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    // After the transaction: the change is durable, and this is a notification, not a
    // step. It is also the alarm if the reset was not the account holder's doing.
    void sendPasswordChangedEmail(
      this.email,
      this.config.getOrThrow<string>("FRONTEND_URL"),
      row.user.email,
    );

    return { ok: true };
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(
    user: UserWithRoles,
    userAgent?: string,
  ): Promise<AuthResult & { refreshTokenId: string }> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, roles: user.roles, kycTier: user.kycTier },
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
    const stored = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt,
        userAgent: userAgent ?? null,
      },
      select: { id: true },
    });

    return {
      accessToken,
      refreshToken,
      refreshTokenId: stored.id,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles,
        kycTier: user.kycTier,
      },
    };
  }
}

// A real Argon2id hash of a random value, used only to equalise login timing.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8sBv3Ck5pKcHXBLPB7Y5wRfKQvV0KJmJqQz1nH0mS1o";
