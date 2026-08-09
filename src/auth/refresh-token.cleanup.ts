// Housekeeping: refresh tokens accumulate forever otherwise.
//
// Revoked and expired rows are kept for a grace period rather than deleted immediately,
// because they are evidence — a replayed token is how we detect theft, and that
// detection depends on the row still being there.
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "@/database/prisma.service";
import { JobLockService } from "@/scheduler/job-lock.service";

/** Long enough that a stolen token replayed weeks later is still recognised. */
const RETENTION_DAYS = 60;

@Injectable()
export class RefreshTokenCleanup {
  private readonly logger = new Logger(RefreshTokenCleanup.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: JobLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: "refresh-token-cleanup" })
  async run(): Promise<void> {
    await this.locks.withLock("refresh-token-cleanup", 300, async () => {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      });
      if (count > 0) this.logger.log(`Deleted ${count} expired refresh token(s)`);
    });
  }
}
