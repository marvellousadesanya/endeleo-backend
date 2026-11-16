// Where an emailed or notified link should point, now that the frontend is four apps on
// four domains rather than one app that redirects between them.
//
// Every link used to be FRONTEND_URL + path. That only worked because whichever domain
// FRONTEND_URL named would redirect /sponsor/* or /admin/* to the domain that owns it.
// Once each app serves only its own routes, those links 404 — so a link is now built
// from the app that owns its path.
//
// Each app's URL falls back to FRONTEND_URL until it is set, so deploying this changes
// nothing; setting INVESTOR_URL etc. on Railway is what switches it on.
import type { ConfigService } from "@nestjs/config";

export type AppName = "investor" | "sponsor" | "arrangement" | "admin";

const ENV_KEY: Record<AppName, string> = {
  investor: "INVESTOR_URL",
  sponsor: "SPONSOR_URL",
  arrangement: "ARRANGEMENT_URL",
  admin: "ADMIN_URL",
};

/** The base URL of one app, e.g. https://submission.endeleo.online. */
export function appUrl(config: ConfigService, app: AppName): string {
  return config.get<string>(ENV_KEY[app]) || config.getOrThrow<string>("FRONTEND_URL");
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

/**
 * Which app serves a path. The same table the frontend's redirects use today
 * (surfaceForPath.ts), so every existing link lands where it already ends up — just
 * without the hop. Anything unclaimed is the investor app's.
 */
export function appForPath(path: string): AppName {
  if (isUnder(path, "/sponsor")) return "sponsor";
  if (isUnder(path, "/admin/submissions")) return "arrangement";
  if (isUnder(path, "/admin")) return "admin";
  return "investor";
}

/** A full link to `path` on the app that owns it. `path` starts with "/". */
export function linkTo(config: ConfigService, path: string): string {
  return `${appUrl(config, appForPath(path))}${path}`;
}
