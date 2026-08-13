// The hourly heartbeat.
//
// Supabase drove this with pg_cron calling the app over HTTP. Plain Postgres has no such
// extension, so the schedule lives here — behind a lock, because two instances both
// disbursing the same coupon is exactly the failure this must not have.
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { JobLockService } from "@/scheduler/job-lock.service";
import { ActivationService } from "./activation.service";
import { CouponRunnerService } from "./coupon-runner.service";
import { RedemptionRunnerService } from "./redemption-runner.service";

@Injectable()
export class EngineTick {
  private readonly logger = new Logger(EngineTick.name);

  constructor(
    private readonly locks: JobLockService,
    private readonly activation: ActivationService,
    private readonly coupons: CouponRunnerService,
    private readonly redemption: RedemptionRunnerService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: "bond-engine-tick" })
  async run(): Promise<void> {
    await this.locks.withLock("bond-engine-tick", 900, async () => {
      // Ordered deliberately: closing windows and activating bonds creates the coupon
      // and redemption rows the next two passes read. Running them together would leave
      // a freshly activated bond unprocessed for an hour.
      const transitions = await this.activation.runTransitions();
      // The default check runs before coupons so a bond found to be in default today
      // does not disburse today's interest; the maturity payout runs after, so the
      // final coupon is paid before the bond closes.
      const checks = await this.redemption.runChecks();
      const coupons = await this.coupons.run();
      const maturity = await this.redemption.runMaturity();
      const redemption = {
        processed: checks.processed + maturity.processed,
        defaulted: [...checks.defaulted, ...maturity.defaulted],
      };

      const touched =
        transitions.activated.length + coupons.paid + coupons.failed + redemption.processed;
      if (touched > 0) {
        this.logger.log(
          `activated ${transitions.activated.length}, coupons paid ${coupons.paid} ` +
            `(failed ${coupons.failed}, escalated ${coupons.escalated}), ` +
            `redemption events ${redemption.processed}`,
        );
      }
      if (redemption.defaulted.length > 0) {
        this.logger.error(`DEFAULT declared on ${redemption.defaulted.length} bond(s)`);
      }
    });
  }
}
