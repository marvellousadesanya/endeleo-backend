import { describe, it, expect, vi } from "vitest";
import { OAuthController } from "./oauth.controller";

// Google sign-in returns to the domain it started on. Before, every sign-in came back to
// FRONTEND_URL, so a sponsor signing in on submission. was signed in on another domain.
// Google, Prisma and the session layer are stubbed — only where the browser is sent is
// under test.

const FRONTEND_URL = "https://application.endeleo.online";
const SPONSOR = "https://submission.endeleo.online";
const ALLOWED = [FRONTEND_URL, SPONSOR, "https://arrangement.endeleo.online"];

function makeController(opts: { configured?: boolean; exchangeFails?: boolean } = {}) {
  const google: any = {
    isConfigured: opts.configured ?? true,
    name: "google",
    authorizationUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/auth?x=1"),
    exchangeCode: vi.fn(async () => {
      if (opts.exchangeFails) throw new Error("invalid_grant");
      return { sub: "g1", email: "s@x.ng" };
    }),
  };
  const oauth: any = {
    resolveUser: vi.fn(async () => ({ id: "u1" })),
    issueExchangeCode: vi.fn(async () => "one-time"),
  };
  const config: any = {
    get: (k: string) => (k === "CORS_ORIGINS" ? ALLOWED : undefined),
    getOrThrow: (k: string) => (k === "FRONTEND_URL" ? FRONTEND_URL : undefined),
  };
  const controller = new OAuthController(google, oauth, {} as any, {} as any, config);
  return { controller, google };
}

function fakeRes() {
  const res: any = { cookies: {} as Record<string, string> };
  res.cookie = vi.fn((name: string, value: string) => (res.cookies[name] = value));
  res.clearCookie = vi.fn();
  res.redirect = vi.fn();
  return res;
}

/** Run start, then the callback with the cookie start set — the browser's round trip. */
async function roundTrip(returnTo: string | undefined, opts: { exchangeFails?: boolean } = {}) {
  const { controller } = makeController(opts);
  const startRes = fakeRes();
  controller.start(returnTo, startRes);
  const raw = startRes.cookies.endeleo_oauth_flow;
  const { state } = JSON.parse(raw);
  const cbRes = fakeRes();
  await controller.callback(
    "code",
    state,
    undefined,
    { cookies: { endeleo_oauth_flow: raw } } as any,
    cbRes,
  );
  return cbRes.redirect.mock.calls[0][0] as string;
}

describe("Google sign-in returns to the domain it started on", () => {
  it("sends a sponsor back to submission., not to FRONTEND_URL", async () => {
    expect(await roundTrip(SPONSOR)).toBe(`${SPONSOR}/auth/callback?code=one-time`);
  });

  it("falls back to FRONTEND_URL when the frontend sends no return_to (older builds)", async () => {
    expect(await roundTrip(undefined)).toBe(`${FRONTEND_URL}/auth/callback?code=one-time`);
  });

  it("ignores an origin that isn't on the allowlist", async () => {
    expect(await roundTrip("https://evil.example")).toBe(
      `${FRONTEND_URL}/auth/callback?code=one-time`,
    );
  });

  it("shows a failed sign-in's error on the domain it started on too", async () => {
    expect(await roundTrip(SPONSOR, { exchangeFails: true })).toBe(
      `${SPONSOR}/auth?error=invalid_grant`,
    );
  });

  it("sends 'Google not configured' back to the starting domain", () => {
    const { controller } = makeController({ configured: false });
    const res = fakeRes();
    controller.start(SPONSOR, res);
    expect(res.redirect).toHaveBeenCalledWith(`${SPONSOR}/auth?error=google_not_configured`);
  });
});

describe("a callback without a usable flow cookie", () => {
  it("is an expired flow when the cookie is gone", async () => {
    const { controller } = makeController();
    const res = fakeRes();
    await controller.callback("code", "s", undefined, { cookies: {} } as any, res);
    expect(res.redirect).toHaveBeenCalledWith(`${FRONTEND_URL}/auth?error=expired_flow`);
  });

  it("is a bad flow when the cookie isn't ours", async () => {
    const { controller } = makeController();
    const res = fakeRes();
    await controller.callback(
      "code",
      "s",
      undefined,
      { cookies: { endeleo_oauth_flow: "{oops" } } as any,
      res,
    );
    expect(res.redirect).toHaveBeenCalledWith(`${FRONTEND_URL}/auth?error=bad_flow`);
  });

  it("refuses a state that doesn't match (CSRF)", async () => {
    const { controller } = makeController();
    const startRes = fakeRes();
    controller.start(SPONSOR, startRes);
    const res = fakeRes();
    await controller.callback(
      "code",
      "forged",
      undefined,
      { cookies: { endeleo_oauth_flow: startRes.cookies.endeleo_oauth_flow } } as any,
      res,
    );
    expect(res.redirect).toHaveBeenCalledWith(`${SPONSOR}/auth?error=state_mismatch`);
  });
});
