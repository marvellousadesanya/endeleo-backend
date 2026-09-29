// Investor and issuer messaging for the bond engine.
//
// This used to be a stub that only wrote a log line, which meant every message the
// engine produced — coupon paid, principal returned, bond defaulted — went nowhere.
// It now goes through NotificationsService like every other notification in the app,
// so a holder gets an in-app row and an email, from one code path.
//
// Still best-effort: a delivery failure must never roll back a coupon payment or a
// redemption that has already moved money. Failures are logged and swallowed.
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationsService } from "@/notifications/notifications.service";
import { renderNotification, type NotificationTemplate } from "./notification-copy";

export type { NotificationTemplate };

@Injectable()
export class NotificationAdapter {
  private readonly logger = new Logger(NotificationAdapter.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async send(args: {
    userId: string;
    template: NotificationTemplate;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const copy = renderNotification(args.template, args.data ?? {});
    const frontendUrl = this.config.get<string>("FRONTEND_URL") ?? "";

    try {
      await this.notifications.notify({
        userId: args.userId,
        title: copy.title,
        body: copy.body,
        href: copy.href,
        email: {
          subject: copy.subject ?? copy.title,
          bodyHtml: copy.bodyHtml ?? `<p>${copy.body}</p>`,
          ctaLabel: copy.ctaLabel,
          ctaHref: copy.href ? `${frontendUrl}${copy.href}` : undefined,
        },
      });
    } catch (err) {
      // Swallowed on purpose: the caller has already paid a coupon or returned
      // principal, and that must stand whether or not the person was told.
      this.logger.error(`Failed to deliver ${args.template} → ${args.userId}: ${String(err)}`);
    }
  }
}
