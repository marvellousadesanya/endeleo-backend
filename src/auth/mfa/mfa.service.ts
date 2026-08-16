// Two-factor authentication: enrolment, and the second step of login.
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as QRCode from "qrcode";
import { PrismaService } from "@/database/prisma.service";
import { codeForStep, currentStep, generateSecret, otpauthUri, verifyCode } from "./totp";

const CHALLENGE_TTL_MS = 5 * 60_000;
/** Enough for a fat-fingered code or two, few enough to make guessing hopeless. */
const MAX_CHALLENGE_ATTEMPTS = 5;

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Only verified factors count — a pending enrolment must not lock anyone out. */
  async hasVerifiedFactor(userId: string): Promise<boolean> {
    const count = await this.prisma.mfaFactor.count({ where: { userId, status: "verified" } });
    return count > 0;
  }

  async listFactors(userId: string) {
    const factors = await this.prisma.mfaFactor.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      // The secret is deliberately not selected — it never leaves the server after
      // enrolment, and returning it here would put it in every page load.
      select: { id: true, friendlyName: true, status: true, verifiedAt: true, createdAt: true },
    });
    return { totp: factors };
  }

  /**
   * Creates a pending factor and returns the secret once, as a QR code and as text for
   * manual entry. It is not usable for login until a code from it is verified.
   */
  async enroll(userId: string, friendlyName?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new NotFoundException("User not found");

    // Clear out abandoned enrolments so the list does not fill with pending rows.
    await this.prisma.mfaFactor.deleteMany({ where: { userId, status: "pending" } });

    const secret = generateSecret();
    const factor = await this.prisma.mfaFactor.create({
      data: { userId, secret, friendlyName: friendlyName ?? "Authenticator" },
    });

    const uri = otpauthUri({
      secret,
      account: user.email,
      issuer: this.config.get<string>("MFA_ISSUER") ?? "Endeleo",
    });

    return {
      id: factor.id,
      totp: { secret, uri, qrCode: await QRCode.toDataURL(uri) },
    };
  }

  /** Proves the user's device is producing correct codes, activating the factor. */
  async verifyEnrolment(userId: string, factorId: string, code: string) {
    const factor = await this.prisma.mfaFactor.findFirst({ where: { id: factorId, userId } });
    if (!factor) throw new NotFoundException("Factor not found");

    const result = verifyCode(factor.secret, code, {
      lastUsedStep: factor.lastUsedStep === null ? null : Number(factor.lastUsedStep),
    });
    if (!result.valid) throw new BadRequestException("That code is not valid. Try the next one.");

    await this.prisma.mfaFactor.update({
      where: { id: factor.id },
      data: {
        status: "verified",
        verifiedAt: new Date(),
        lastUsedStep: BigInt(result.step ?? currentStep()),
      },
    });
    return { ok: true };
  }

  async unenroll(userId: string, factorId: string) {
    const result = await this.prisma.mfaFactor.deleteMany({ where: { id: factorId, userId } });
    if (result.count === 0) throw new NotFoundException("Factor not found");
    return { ok: true };
  }

  // ---- Login second step ---------------------------------------------------

  /** Issued once the password is correct. Grants nothing by itself. */
  async createChallenge(userId: string, userAgent?: string) {
    const challenge = await this.prisma.mfaChallenge.create({
      data: { userId, userAgent, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
    return { challengeId: challenge.id, expiresAt: challenge.expiresAt };
  }

  /**
   * Consumes a challenge with a TOTP code and returns the user id to issue tokens for.
   * Every failure path is the same message: distinguishing "wrong code" from "expired
   * challenge" tells an attacker which half they got right.
   */
  async redeemChallenge(challengeId: string, code: string): Promise<string> {
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
    const invalid = () => new UnauthorizedException("That code is not valid or has expired.");

    if (!challenge || challenge.consumedAt) throw invalid();
    if (challenge.expiresAt < new Date()) throw invalid();
    if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) throw invalid();

    const factors = await this.prisma.mfaFactor.findMany({
      where: { userId: challenge.userId, status: "verified" },
    });

    for (const factor of factors) {
      const result = verifyCode(factor.secret, code, {
        lastUsedStep: factor.lastUsedStep === null ? null : Number(factor.lastUsedStep),
      });
      if (!result.valid) continue;

      await this.prisma.$transaction([
        this.prisma.mfaFactor.update({
          where: { id: factor.id },
          data: { lastUsedStep: BigInt(result.step ?? currentStep()) },
        }),
        this.prisma.mfaChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        }),
      ]);
      return challenge.userId;
    }

    await this.prisma.mfaChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw invalid();
  }

  /** Exposed for tests: the code a given secret produces right now. */
  currentCodeFor(secret: string): string {
    return codeForStep(secret, currentStep());
  }
}
