// Users are the domain's identity. Everything downstream (holdings, subscriptions,
// audit entries) will reference users.id — never an auth provider's id.
import { Injectable } from "@nestjs/common";
import type { Role, UserStatus } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";

export interface UserWithRoles {
  id: string;
  email: string;
  fullName: string | null;
  status: UserStatus;
  kycTier: number;
  roles: Role[];
}

/** Emails are stored lowercase, so every lookup must normalise the same way. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<UserWithRoles | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    return user ? toUserWithRoles(user) : null;
  }

  async findByEmail(email: string): Promise<UserWithRoles | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(email) },
      include: { roles: true },
    });
    return user ? toUserWithRoles(user) : null;
  }

  /**
   * Create the user, their password and their default role together. Prisma nests these
   * writes into one transaction, so a user can never exist without a way to sign in.
   */
  async createWithPassword(input: {
    email: string;
    passwordHash: string;
    fullName?: string;
  }): Promise<UserWithRoles> {
    const user = await this.prisma.user.create({
      data: {
        email: normaliseEmail(input.email),
        fullName: input.fullName ?? null,
        credential: { create: { passwordHash: input.passwordHash } },
        roles: { create: { role: "investor" } },
      },
      include: { roles: true },
    });
    return toUserWithRoles(user);
  }

  async passwordHashFor(userId: string): Promise<string | undefined> {
    const row = await this.prisma.userCredential.findUnique({
      where: { userId },
      select: { passwordHash: true },
    });
    return row?.passwordHash;
  }
}

function toUserWithRoles(user: {
  id: string;
  email: string;
  fullName: string | null;
  status: UserStatus;
  kycTier: number;
  roles: { role: Role }[];
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
