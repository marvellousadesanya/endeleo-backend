// Turns a verified social profile into an Endeleo session.
//
// The provider proves who someone is. This decides which Endeleo user that maps to,
// and hands back a one-time code the browser can trade for real tokens.
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "@/database/prisma.service";
import { normaliseEmail, type UserWithRoles } from "@/users/users.service";
import type { GoogleProfile } from "./google.provider";

/** Long enough for a redirect, short enough to be useless if it leaks. */
const EXCHANGE_CODE_TTL_MS = 60_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Map a social profile onto an Endeleo user.
   *
   * Three cases: we have seen this provider identity before; we have not, but the email
   * matches an existing account; or this is someone new.
   */
  async resolveUser(provider: string, profile: GoogleProfile): Promise<UserWithRoles> {
    const email = normaliseEmail(profile.email);

    // 1. Known identity — the normal returning-user path.
    const existing = await this.prisma.userIdentity.findUnique({
      where: { provider_subject: { provider, subject: profile.subject } },
      include: { user: { include: { roles: true } } },
    });
    if (existing) return toUserWithRoles(existing.user);

    // 2. Same email, no linked identity yet.
    //
    // Only link when the provider says the address is verified. Otherwise anyone could
    // register a provider account claiming someone else's email and walk into their
    // Endeleo account — a well-known account-takeover route.
    const byEmail = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });
    if (byEmail) {
      if (!profile.emailVerified) {
        this.logger.warn(`Refused to link unverified ${provider} email to ${byEmail.id}`);
        throw new UnauthorizedException(
          "That email is already registered. Sign in with your password instead.",
        );
      }
      await this.prisma.userIdentity.create({
        data: { userId: byEmail.id, provider, subject: profile.subject },
      });
      return toUserWithRoles(byEmail);
    }

    // 3. New person. No credential row — they have no password and do not need one.
    const created = await this.prisma.user.create({
      data: {
        email,
        fullName: profile.fullName ?? null,
        identities: { create: { provider, subject: profile.subject } },
        roles: { create: { role: "investor" } },
      },
      include: { roles: true },
    });
    return toUserWithRoles(created);
  }

  /** Issue the single-use code carried back to the frontend in the redirect URL. */
  async issueExchangeCode(userId: string): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    await this.prisma.oAuthExchangeCode.create({
      data: {
        codeHash: sha256(code),
        userId,
        expiresAt: new Date(Date.now() + EXCHANGE_CODE_TTL_MS),
      },
    });
    return code;
  }

  /**
   * Redeem the code. Marks it used in the same statement that claims it, so two
   * simultaneous requests cannot both succeed.
   */
  async redeemExchangeCode(code: string): Promise<string> {
    const { count } = await this.prisma.oAuthExchangeCode.updateMany({
      where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException("Invalid or expired sign-in code");

    const row = await this.prisma.oAuthExchangeCode.findUnique({
      where: { codeHash: sha256(code) },
      select: { userId: true },
    });
    if (!row) throw new UnauthorizedException("Invalid sign-in code");
    return row.userId;
  }
}

function toUserWithRoles(user: {
  id: string;
  email: string;
  fullName: string | null;
  status: "active" | "suspended" | "closed";
  kycTier: number;
  roles: { role: "admin" | "editor" | "issuer" | "investor" }[];
}): UserWithRoles {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    kycTier: user.kycTier,
    roles: user.roles.map((r) => r.role),
  };
}
