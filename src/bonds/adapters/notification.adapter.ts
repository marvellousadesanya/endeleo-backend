// Investor and issuer messaging. Logs today; email/SMS providers slot in here.
import { Injectable, Logger } from "@nestjs/common";

export type NotificationTemplate =
  | "coupon_paid" | "coupon_failed"
  | "redemption_t90" | "redemption_t30" | "redemption_t7"
  | "principal_returned" | "default_declared" | "trustee_default_alert";

@Injectable()
export class NotificationAdapter {
  private readonly logger = new Logger(NotificationAdapter.name);

  async send(args: {
    userId: string;
    template: NotificationTemplate;
    data?: Record<string, unknown>;
  }): Promise<void> {
    this.logger.log(`[notify] ${args.template} → ${args.userId}`);
  }
}
