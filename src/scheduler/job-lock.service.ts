// Makes a scheduled job safe to run on more than one instance.
//
// Without this, two servers both fire the hourly tick and both disburse the same
// coupon. The claim below is a single atomic statement: exactly one caller can win.
import { Injectable, Logger } from "@nestjs/common";
import { hostname } from "node:os";
import { PrismaService } from "@/database/prisma.service";

@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);
  private readonly instanceId = `${hostname()}:${process.pid}`;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run `task` only if this instance can claim the lease.
   *
   * Returns the task's result, or `null` if another instance already holds it.
   * `leaseSeconds` should comfortably exceed the job's expected runtime — if it expires
   * mid-run, a second instance may start the job alongside the first.
   */
  async withLock<T>(
    name: string,
    leaseSeconds: number,
    task: () => Promise<T>,
  ): Promise<T | null> {
    if (!(await this.claim(name, leaseSeconds))) {
      this.logger.debug(`Skipping "${name}" — held by another instance`);
      return null;
    }

    try {
      return await task();
    } finally {
      // Release even if the task threw, so a failure does not block the next run.
      await this.release(name);
    }
  }

  /**
   * Take the lease if it is free or expired.
   *
   * INSERT ... ON CONFLICT DO UPDATE ... WHERE is one statement, so Postgres serialises
   * competing callers: the loser's WHERE does not match and it updates nothing.
   */
  private async claim(name: string, leaseSeconds: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ name: string }[]>`
      INSERT INTO job_locks (name, locked_until, locked_by, last_run_at)
      VALUES (${name}, now() + make_interval(secs => ${leaseSeconds}), ${this.instanceId}, now())
      ON CONFLICT (name) DO UPDATE
        SET locked_until = EXCLUDED.locked_until,
            locked_by    = EXCLUDED.locked_by,
            last_run_at  = now()
        WHERE job_locks.locked_until < now()
      RETURNING name
    `;
    return rows.length > 0;
  }

  /** Expire the lease immediately so the next scheduled run is not delayed. */
  private async release(name: string): Promise<void> {
    await this.prisma.jobLock.updateMany({
      where: { name, lockedBy: this.instanceId },
      data: { lockedUntil: new Date() },
    });
  }
}
