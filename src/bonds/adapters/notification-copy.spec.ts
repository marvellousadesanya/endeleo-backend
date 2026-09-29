import { describe, it, expect } from "vitest";
import { renderNotification, type NotificationTemplate } from "./notification-copy";
import { majorAmount, naira } from "@/email/money-format";

// These messages are the only thing that tells a holder their coupon arrived or their
// bond defaulted. Before this module they were a log line, so the thing worth guarding
// is that every template produces real words — not that the wording is exactly this.
const ALL: NotificationTemplate[] = [
  "coupon_paid",
  "coupon_failed",
  "redemption_t90",
  "redemption_t30",
  "redemption_t7",
  "principal_returned",
  "default_declared",
  "trustee_default_alert",
];

describe("every template renders", () => {
  it.each(ALL)("%s has a title, body and link", (template) => {
    const out = renderNotification(template, { bond: "Lagos Solar Bond", isin: "ENDSPVLAGSOL" });
    expect(out.title.length).toBeGreaterThan(0);
    expect(out.body.length).toBeGreaterThan(0);
    expect(out.href).toMatch(/^\//);
  });

  it.each(ALL)("%s never leaks an undefined into the copy", (template) => {
    // Rendered with an empty bag on purpose: the engine's data shapes differ per
    // template, and a missing key must fall back rather than print "undefined".
    const out = renderNotification(template, {});
    const text = `${out.title} ${out.body} ${out.bodyHtml ?? ""} ${out.subject ?? ""}`;
    expect(text).not.toMatch(/undefined|null|NaN|\[object/);
  });
});

describe("coupon_paid", () => {
  it("renders the net amount as money, from minor units", () => {
    const out = renderNotification("coupon_paid", {
      bond: "Lagos Solar Bond",
      netMinor: "4512375",
    });
    expect(out.body).toContain("₦45,123.75");
    expect(out.bodyHtml).toContain("Lagos Solar Bond");
  });

  it("falls back to wording that still reads when the amount is missing", () => {
    const out = renderNotification("coupon_paid", { bond: "Lagos Solar Bond" });
    expect(out.body).not.toMatch(/undefined|NaN/);
    expect(out.body).toContain("Lagos Solar Bond");
  });
});

describe("default_declared", () => {
  // The worst message the platform sends. It must say what happened, that coupons stop,
  // and that other holdings are safe — softening any of those would mislead.
  const out = renderNotification("default_declared", { bond: "Obudu Mountain Resort Bond" });

  it("names the bond in the subject", () => {
    expect(out.subject).toContain("Obudu Mountain Resort Bond");
  });

  it("says coupons are suspended and other holdings are not affected", () => {
    expect(out.bodyHtml).toMatch(/suspended/i);
    expect(out.bodyHtml).toMatch(/other bonds are unaffected/i);
  });
});

describe("the issuer-facing redemption ladder", () => {
  it("points the issuer at funding, not at a portfolio", () => {
    for (const t of ["redemption_t90", "redemption_t30"] as const) {
      expect(renderNotification(t, {}).href).toBe("/sponsor/funding");
    }
  });

  it("points holders at their portfolio", () => {
    expect(renderNotification("redemption_t7", {}).href).toBe("/dashboard/portfolio");
    expect(renderNotification("principal_returned", {}).href).toBe("/dashboard/wallet");
  });
});

describe("money formatting", () => {
  it("renders minor units as major with two decimals", () => {
    expect(majorAmount(250000000n)).toBe("2,500,000.00");
    expect(naira(4512375n)).toBe("₦45,123.75");
    expect(naira(0n)).toBe("₦0.00");
  });

  it("accepts the string form bigints cross the wire as", () => {
    expect(naira("4512375")).toBe("₦45,123.75");
  });
});
