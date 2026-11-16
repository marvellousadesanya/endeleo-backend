// Who issued a bond. There is no "sponsor" role — a sponsor is whoever a bond's
// issuerId points at — so every sponsor-facing service asks this same question.
// Plain functions over Prisma rather than an injectable: it's one lookup, and sharing
// it shouldn't mean wiring the sponsor-portal module into everything that needs it.
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "@/database/prisma.service";
import type { AuthUser } from "@/auth/jwt.strategy";

type BondReader = Pick<PrismaService, "bond">;

/** True when this user issued the bond. A missing bond, or no bond at all, is false. */
export async function isBondIssuer(
  prisma: BondReader,
  user: AuthUser,
  bondId: string | null | undefined,
): Promise<boolean> {
  if (!bondId) return false;
  const bond = await prisma.bond.findUnique({ where: { id: bondId }, select: { issuerId: true } });
  return !!bond && bond.issuerId === user.id;
}

/** Admins pass; otherwise the bond must exist (404) and be this user's (403). */
export async function assertOwnsBond(
  prisma: BondReader,
  user: AuthUser,
  bondId: string,
): Promise<void> {
  if (user.roles.includes("admin")) return;
  const bond = await prisma.bond.findUnique({ where: { id: bondId }, select: { issuerId: true } });
  if (!bond) throw new NotFoundException("Bond not found");
  if (bond.issuerId !== user.id) throw new ForbiddenException("Not your bond");
}
