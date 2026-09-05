// A sponsor's own team — who else can see their bonds. Invites are keyed by email and
// stay "pending" until that email belongs to a registered user, at which point the row
// is reconciled to "active" the next time the list is read (no separate webhook/signup
// hook needed — this module owns its own state end to end).
//
// Note: `role` is recorded here but not yet enforced anywhere else in the platform — an
// invited "viewer" and "editor" both currently see exactly what the owner sees, because
// bond/data-room/checklist ownership checks only ever compare against the bond's own
// issuerId. Wiring role-based restrictions into those checks is future work; this module
// gives sponsors a real, persisted place to manage who's on their team in the meantime.
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import type { AuthUser } from "@/auth/jwt.strategy";
import type { InviteTeamMemberDto, UpdateTeamMemberDto } from "./dto/team.dto";

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const pending = await this.prisma.sponsorTeamMember.findMany({
      where: { ownerUserId: user.id, status: "pending" },
    });
    // Reconcile any invite whose email now belongs to a real account.
    for (const invite of pending) {
      const matched = await this.prisma.user.findUnique({
        where: { email: invite.invitedEmail },
        select: { id: true },
      });
      if (matched) {
        await this.prisma.sponsorTeamMember.update({
          where: { id: invite.id },
          data: { memberUserId: matched.id, status: "active", joinedAt: new Date() },
        });
      }
    }

    return this.prisma.sponsorTeamMember.findMany({
      where: { ownerUserId: user.id },
      orderBy: { invitedAt: "asc" },
      include: { member: { select: { fullName: true, email: true } } },
    });
  }

  async invite(user: AuthUser, dto: InviteTeamMemberDto) {
    const email = dto.email.trim().toLowerCase();
    if (email === user.email.toLowerCase()) {
      throw new ConflictException("You're already the owner of this team");
    }
    const matched = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });

    return this.prisma.sponsorTeamMember.upsert({
      where: { ownerUserId_invitedEmail: { ownerUserId: user.id, invitedEmail: email } },
      create: {
        ownerUserId: user.id,
        invitedEmail: email,
        role: dto.role,
        ...(matched ? { memberUserId: matched.id, status: "active", joinedAt: new Date() } : {}),
      },
      update: { role: dto.role },
    });
  }

  async updateRole(user: AuthUser, id: string, dto: UpdateTeamMemberDto) {
    const member = await this.prisma.sponsorTeamMember.findUnique({ where: { id } });
    if (!member) throw new NotFoundException("Team member not found");
    if (member.ownerUserId !== user.id) throw new ForbiddenException("Not your team");
    return this.prisma.sponsorTeamMember.update({ where: { id }, data: { role: dto.role } });
  }

  async remove(user: AuthUser, id: string) {
    const member = await this.prisma.sponsorTeamMember.findUnique({ where: { id } });
    if (!member) return { ok: true };
    if (member.ownerUserId !== user.id) throw new ForbiddenException("Not your team");
    await this.prisma.sponsorTeamMember.delete({ where: { id } });
    return { ok: true };
  }
}
