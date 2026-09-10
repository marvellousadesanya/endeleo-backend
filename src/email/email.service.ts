// Outbound email, over Resend. Every call site treats this as best-effort: a failed or
// skipped email never blocks the action that triggered it (crediting a wallet, signing
// an agreement...) — it only ever logs. Money and state changes are already durable in
// the database and the in-app Notification row by the time this is called; email is a
// convenience on top, not the source of truth.
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>("RESEND_API_KEY");
    this.client = apiKey ? new Resend(apiKey) : null;
    this.from = config.getOrThrow<string>("EMAIL_FROM");
    if (!this.client) {
      this.logger.warn("RESEND_API_KEY not set — email alerts are disabled (logging only)");
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.client) {
      this.logger.log(`[email skipped] "${subject}" → ${to}`);
      return;
    }
    try {
      const { error } = await this.client.emails.send({ from: this.from, to, subject, html });
      if (error) this.logger.error(`Resend rejected "${subject}" → ${to}: ${error.message}`);
    } catch (err) {
      this.logger.error(`Failed to send "${subject}" → ${to}: ${String(err)}`);
    }
  }
}
