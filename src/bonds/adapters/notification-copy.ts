// What each bond-engine notification actually says.
//
// Separated from the adapter that delivers it for the same reason the frontend keeps
// its auth copy in a table: the delivery mechanism and the wording change for entirely
// different reasons, and a `switch` buried in a service is where copy goes to rot.
//
// Every template here is triggered by the bond engine's scheduled runners — coupon
// payments, redemption reminders, default. These are the highest-stakes messages the
// platform sends: an investor learning their bond has defaulted should not learn it
// from a log line, which is exactly what happened before this file existed.
import { naira } from "@/email/money-format";

export type NotificationTemplate =
  | "coupon_paid"
  | "coupon_failed"
  | "redemption_t90"
  | "redemption_t30"
  | "redemption_t7"
  | "principal_returned"
  | "default_declared"
  | "trustee_default_alert";

export interface RenderedNotification {
  /** In-app notification title, and the email subject unless `subject` overrides it. */
  title: string;
  /** Plain one-liner for the in-app row. */
  body: string;
  /** HTML for the email body. Defaults to `body` wrapped in a paragraph. */
  bodyHtml?: string;
  subject?: string;
  /** In-app link, relative to the app root. */
  href?: string;
  ctaLabel?: string;
}

type TemplateData = Record<string, unknown>;

/** Reads a string off the loosely-typed `data` bag the engine passes. */
const str = (data: TemplateData, key: string, fallback = "your bond"): string => {
  const v = data[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
};

export function renderNotification(
  template: NotificationTemplate,
  data: TemplateData = {},
): RenderedNotification {
  const bond = str(data, "bond");

  switch (template) {
    case "coupon_paid": {
      // netMinor crosses as a string because it is a bigint at source.
      const amount = data.netMinor != null ? naira(String(data.netMinor)) : "Your coupon";
      return {
        title: "Coupon payment received",
        body: `${amount} from ${bond} has been paid to you.`,
        bodyHtml:
          `<p><strong>${amount}</strong> has been paid to you for <strong>${bond}</strong>.</p>` +
          `<p>This is the net amount after withholding tax. Your tax record for the period has been updated.</p>`,
        href: "/dashboard/portfolio",
        ctaLabel: "View portfolio",
      };
    }

    case "coupon_failed":
      return {
        title: "A coupon payment could not be completed",
        body: `We could not pay your coupon for ${bond}. No action is needed from you.`,
        bodyHtml:
          `<p>A coupon payment for <strong>${bond}</strong> could not be completed.</p>` +
          `<p>We are retrying it, and our team has been alerted. You do not need to do anything — ` +
          `the amount remains owed to you and is not lost.</p>`,
        href: "/dashboard/portfolio",
        ctaLabel: "View portfolio",
      };

    // The redemption ladder. Ninety days out is aimed at the issuer, who has to fund the
    // principal escrow; seven days out is aimed at holders, who just need to expect money.
    case "redemption_t90": {
      const isin = str(data, "isin", "your bond");
      return {
        title: "Principal funding due in 90 days",
        subject: "Action needed: fund the principal escrow",
        body: `${isin} matures in 90 days. The principal escrow must be funded before then.`,
        bodyHtml:
          `<p><strong>${isin}</strong> reaches maturity in 90 days.</p>` +
          `<p>The principal escrow has to be fully funded before the redemption window opens. ` +
          `If it is still short 30 days out, the bond is declared in default automatically.</p>`,
        href: "/sponsor/funding",
        ctaLabel: "Open funding",
      };
    }

    case "redemption_t30":
      return {
        title: "Principal funding due in 30 days",
        subject: "Urgent: principal escrow still due",
        body: `${bond} matures in 30 days and the principal escrow is not yet funded.`,
        bodyHtml:
          `<p><strong>${bond}</strong> matures in 30 days.</p>` +
          `<p>The principal escrow is not yet fully funded. If it remains short at this point ` +
          `the bond is declared in default and outstanding coupons are suspended.</p>`,
        href: "/sponsor/funding",
        ctaLabel: "Open funding",
      };

    case "redemption_t7":
      return {
        title: "Your bond matures in 7 days",
        body: `${bond} matures in 7 days. Your principal will be returned to your wallet.`,
        bodyHtml:
          `<p><strong>${bond}</strong> matures in 7 days.</p>` +
          `<p>Your principal will be returned to your Endeleo wallet automatically. ` +
          `There is nothing you need to do.</p>`,
        href: "/dashboard/portfolio",
        ctaLabel: "View portfolio",
      };

    case "principal_returned":
      return {
        title: "Your principal has been returned",
        body: `Your principal from ${bond} has been returned to your wallet.`,
        bodyHtml:
          `<p>Your principal from <strong>${bond}</strong> has been returned to your Endeleo wallet.</p>` +
          `<p>You can withdraw it to your bank account or put it toward another bond.</p>`,
        href: "/dashboard/wallet",
        ctaLabel: "View wallet",
      };

    // Worst case. Said plainly, without softening: someone reading this needs to know
    // what has happened to their money and what happens next.
    case "default_declared":
      return {
        title: "Important: a bond you hold has defaulted",
        subject: `Important: ${bond} has been declared in default`,
        body: `${bond} has been declared in default. Recovery is being handled by the trustee.`,
        bodyHtml:
          `<p><strong>${bond}</strong> has been declared in default because the issuer did not ` +
          `fund the principal escrow before the deadline.</p>` +
          `<p>Outstanding coupon payments on this bond are suspended. The trustee has been ` +
          `notified and is responsible for recovery on behalf of holders. We will write to you ` +
          `again as soon as there is something concrete to report.</p>` +
          `<p>Your holdings in other bonds are unaffected.</p>`,
        href: "/dashboard/portfolio",
        ctaLabel: "View portfolio",
      };

    case "trustee_default_alert":
      return {
        title: "Default declared — trustee action required",
        subject: `Default declared on ${bond}`,
        body: `${bond} has been declared in default and requires trustee action.`,
        bodyHtml:
          `<p><strong>${bond}</strong> has been declared in default: the principal escrow was ` +
          `unfunded at the 30-day deadline.</p>` +
          `<p>The bond is frozen and outstanding coupons are suspended pending recovery. ` +
          `Holders have been notified.</p>`,
        href: "/sponsor/governance",
        ctaLabel: "Open governance",
      };
  }
}
