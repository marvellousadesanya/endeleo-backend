// "New sign-in" detection and its email.
//
// Deliberately NOT sent on every login. An account holder who signs in daily would get
// thirty of these a month, stop reading them, and then miss the one that matters — the
// stranger. The alert is only worth sending when it carries information, so it fires
// only for a device we have not seen on this account before.
//
// Recognition works off the refresh_tokens table, which already records a user agent per
// session, so this needs no new schema and no device registry.
import { emailShell } from "@/email/email-templates";

/**
 * A stable fingerprint for "this kind of device", ignoring version numbers.
 *
 * Matching raw user-agent strings would be useless: Chrome ships a new version roughly
 * every four weeks and rewrites its UA each time, so every browser update would look
 * like a break-in. Browser family plus OS family is coarse enough to survive updates
 * and specific enough that a different machine reads as different.
 *
 * It is a heuristic, not identification — two people on the same Chrome-on-Windows
 * build share a signature. That is the accepted trade: this exists to catch the obvious
 * case, and MFA is what actually stops an attacker.
 */
export function deviceSignature(userAgent?: string | null): string {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();

  // Order matters: Edge and Opera both carry "chrome" in their UA, and every
  // Chromium browser carries "safari". Most specific first.
  const browser =
    ua.includes("edg/") || ua.includes("edge") ? "Edge"
    : ua.includes("opr/") || ua.includes("opera") ? "Opera"
    : ua.includes("firefox") ? "Firefox"
    : ua.includes("chrome") || ua.includes("chromium") ? "Chrome"
    : ua.includes("safari") ? "Safari"
    : "browser";

  // iPadOS reports as Macintosh in desktop mode, so iPad is checked before mac.
  const os =
    ua.includes("iphone") ? "iPhone"
    : ua.includes("ipad") ? "iPad"
    : ua.includes("android") ? "Android"
    : ua.includes("windows") ? "Windows"
    : ua.includes("mac os") || ua.includes("macintosh") ? "macOS"
    : ua.includes("linux") ? "Linux"
    : "an unrecognised device";

  return `${browser} on ${os}`;
}

/**
 * Is this a device we have not seen for this account?
 *
 * `priorUserAgents` must be read *before* the new session row is written, or the new
 * session matches itself and nothing is ever new.
 *
 * Returns false when there is no history at all: that is someone's first sign-in after
 * registering, and the welcome email has already told them the account exists. Two
 * emails a second apart saying the same thing is noise.
 */
export function isUnrecognisedDevice(
  userAgent: string | null | undefined,
  priorUserAgents: (string | null)[],
): boolean {
  if (priorUserAgents.length === 0) return false;
  const signature = deviceSignature(userAgent);
  return !priorUserAgents.some((prior) => deviceSignature(prior) === signature);
}

export function signInAlertEmail(opts: {
  device: string;
  when: Date;
  frontendUrl: string;
}): { subject: string; html: string } {
  // Written out in full rather than localised: the reader needs to judge "was that me?"
  // and an ambiguous timestamp defeats the whole message.
  const when = opts.when.toLocaleString("en-NG", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  });

  return {
    subject: "New sign-in to your Endeleo account",
    html: emailShell({
      heading: "New sign-in to your account",
      bodyHtml:
        `<p>Your Endeleo account was signed in to from a device we have not seen before.</p>` +
        `<table style="font-size:14px;line-height:1.7;">` +
        `<tr><td style="padding-right:12px;color:#9aa39a;">Device</td><td><strong>${opts.device}</strong></td></tr>` +
        `<tr><td style="padding-right:12px;color:#9aa39a;">When</td><td>${when} (WAT)</td></tr>` +
        `</table>` +
        `<p style="margin-top:16px;">If this was you, nothing further is needed — we will not email ` +
        `you again for this device.</p>` +
        `<p><strong>If this was not you</strong>, change your password immediately and turn on ` +
        `two-factor authentication. That signs out every other session.</p>`,
      ctaLabel: "Review security settings",
      ctaHref: `${opts.frontendUrl}/dashboard/security`,
    }),
  };
}
