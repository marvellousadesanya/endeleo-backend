// Which origin to send a browser back to.
//
// Anything that hands the browser a link it will later follow — a Paystack callback, a
// password reset email — has to decide where "back" is. FRONTEND_URL is one value for
// an app that serves three domains, so using it alone means two of the three surfaces
// get a link pointing somewhere else, and any mistake in that single variable breaks
// the flow everywhere at once.
//
// That is not hypothetical. FRONTEND_URL pointed at app.endeleo.online, which still
// serves the old Lovable deployment, so every password reset link 404'd on a site that
// has no /reset-password route. The request itself knew better: it came from
// application.endeleo.online.
//
// So: prefer the caller's own Origin, and fall back to the configured value only when
// there isn't one.
import type { ConfigService } from "@nestjs/config";

/**
 * The origin a link should point back to.
 *
 * `origin` is only trusted when it appears in CORS_ORIGINS. It arrives as a request
 * header, which a caller controls freely — without that check this would happily mint
 * password reset links pointing at an attacker's domain.
 *
 * Falls back to FRONTEND_URL for callers that send no Origin at all: server-to-server
 * requests, curl, and anything triggered by a scheduled job rather than a browser.
 */
export function resolveReturnOrigin(config: ConfigService, origin?: string): string {
  const allowed = config.get<string[]>("CORS_ORIGINS") ?? [];
  if (origin && allowed.includes(origin)) return origin;
  return config.getOrThrow<string>("FRONTEND_URL");
}
