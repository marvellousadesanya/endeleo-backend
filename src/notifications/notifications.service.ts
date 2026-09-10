// The one place that writes an in-app Notification row and sends the matching email
// together, for call sites outside a DB transaction. (WalletService's own notifications
// stay direct tx.notification.create() calls — see wallet.service.ts — because they're
// written inside a money-moving transaction; it injects EmailService on its own and
// sends the email right after that transaction commits, using this service's
// `sendEmailOnly` for the second half.)
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { EmailService } from "@/email/email.service";
import { emailShell } from "@/email/email-templates";

export interface NotifyInput {
  userId: string;
  title: string;
  body?: string;
  href?: string;
  /** Defaults to `title`/`body` rendered through the shared shell. Pass false to skip email entirely. */
  email?: { subject: string; bodyHtml: string; ctaLabel?: string; ctaHref?: string } | false;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
      },
    });
    if (input.email === false) return;

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });
    if (!user) return;

    const e = input.email;
    const subject = e?.subject ?? input.title;
    const html = emailShell({
      heading: input.title,
      bodyHtml: e?.bodyHtml ?? `<p>${input.body ?? ""}</p>`,
      ctaLabel: e?.ctaLabel,
      ctaHref: e?.ctaHref,
    });
    await this.email.send(user.email, subject, html);
  }

  /** Email an address directly — for invites, where there's no user row yet. */
  async emailAddress(to: string, subject: string, html: string): Promise<void> {
    await this.email.send(to, subject, html);
  }
}
