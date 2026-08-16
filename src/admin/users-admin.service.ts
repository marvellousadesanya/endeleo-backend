// Admin view of users, and role grants.
import { BadRequestException, Injectable } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";

@Injectable()
export class UsersAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One query with the roles and profile joined, rather than the two-query-and-stitch
   * the Supabase version had to do.
   */
  async list(limit = 200) {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 500),
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        kycTier: true,
        createdAt: true,
        roles: { select: { role: true } },
        profile: { select: { kycStatus: true } },
      },
    });

    return users.map(({ roles, profile, ...user }) => ({
      ...user,
      kycStatus: profile?.kycStatus ?? "none",
      roles: roles.map((r) => r.role),
    }));
  }

  /** Investor intake, newest first. Read-only for now — nothing edits these yet. */
  listApplications(limit = 500) {
    return this.prisma.investorApplication.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 1000),
    });
  }

  async setRole(actorId: string, userId: string, role: Role, grant: boolean) {
    // An admin removing their own admin role locks everyone out of this screen if they
    // are the last one. Refuse it rather than let them strand the system.
    if (!grant && role === "admin" && actorId === userId) {
      throw new BadRequestException("You cannot remove your own admin role");
    }

    if (grant) {
      await this.prisma.userRoleAssignment.upsert({
        where: { userId_role: { userId, role } },
        create: { userId, role },
        update: {},
      });
    } else {
      await this.prisma.userRoleAssignment.deleteMany({ where: { userId, role } });
    }

    return { ok: true };
  }
}
