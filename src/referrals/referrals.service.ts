// Referrals: one code per user, one attribution per referee, ever.
//
// The Supabase version checked "already attributed?" with a SELECT and then INSERTed.
// Two requests interleaving between those two statements could both pass the check.
// Here the unique constraint on referee_id is the real guard and the check is only a
// fast path for a friendlier message — the database has the final say.
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";

/** No vowels and no 0/1/I/O — a code read aloud or retyped should not be ambiguous. */
const CODE_ALPHABET = "23456789BCDFGHJKLMNPQRSTVWXZ";
const CODE_LENGTH = 8;

export type ApplyResult = { ok: true } | { ok: false; reason: string };

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mints a code on first read, so no backfill is needed for existing accounts. */
  async findForUser(userId: string) {
    const profile = await this.ensureCode(userId);
    const attributions = await this.prisma.referralAttribution.findMany({
      where: { referrerId: userId },
      select: { refereeId: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return { code: profile.referralCode, referredBy: profile.referredBy, attributions };
  }

  private async ensureCode(userId: string) {
    const existing = await this.prisma.profile.findUnique({
      where: { userId },
      select: { referralCode: true, referredBy: true },
    });
    if (existing?.referralCode) return existing;

    // Retry on collision rather than pre-checking: the unique index is authoritative,
    // and at this alphabet size a second collision is vanishingly unlikely.
    for (let attempt = 0; attempt < 5; attempt++) {
      const referralCode = this.mintCode();
      try {
        const profile = await this.prisma.profile.upsert({
          where: { userId },
          create: { userId, referralCode },
          update: { referralCode },
          select: { referralCode: true, referredBy: true },
        });
        return profile;
      } catch (err) {
        if (!this.isUniqueViolation(err)) throw err;
      }
    }
    throw new Error("Could not allocate a referral code");
  }

  private mintCode(): string {
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  async apply(userId: string, rawCode: string): Promise<ApplyResult> {
    const code = rawCode.trim().toUpperCase();

    const referrerProfile = await this.prisma.profile.findUnique({
      where: { referralCode: code },
      select: { userId: true },
    });
    // Self-referral and unknown codes are the same answer on purpose: neither reveals
    // whether a given code exists.
    if (!referrerProfile || referrerProfile.userId === userId) {
      return { ok: false, reason: "INVALID_CODE" };
    }

    try {
      await this.prisma.$transaction([
        this.prisma.referralAttribution.create({
          data: { referrerId: referrerProfile.userId, refereeId: userId, code },
        }),
        this.prisma.profile.upsert({
          where: { userId },
          create: { userId, referredBy: referrerProfile.userId },
          update: { referredBy: referrerProfile.userId },
        }),
      ]);
      return { ok: true };
    } catch (err) {
      if (this.isUniqueViolation(err)) return { ok: false, reason: "ALREADY_ATTRIBUTED" };
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  }
}
