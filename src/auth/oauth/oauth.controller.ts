// Social sign-in endpoints.
//
//   GET  /api/auth/google           → redirect the browser to Google
//   GET  /api/auth/google/callback  → Google sends the user back here
//   POST /api/auth/oauth/exchange   → frontend trades the one-time code for tokens
//
// The state and PKCE verifier live in a short-lived httpOnly cookie rather than in the
// database: the browser carries them between the two requests, so the flow works
// unchanged across multiple server instances with no shared state.
//
// The same cookie carries the origin the sign-in started on (`?return_to=`), so the
// browser comes back to the domain it left. Without it every Google sign-in returned to
// FRONTEND_URL — a sponsor signing in on submission. was signed in on whichever domain
// that named instead.
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { IsString, MaxLength } from "class-validator";
import { AuthService } from "../auth.service";
import { UsersService } from "@/users/users.service";
import { resolveReturnOrigin } from "@/config/return-origin";
import { GoogleProvider } from "./google.provider";
import { OAuthService } from "./oauth.service";

const FLOW_COOKIE = "endeleo_oauth_flow";
const FLOW_TTL_MS = 10 * 60_000;

export class ExchangeDto {
  @IsString()
  @MaxLength(200)
  code!: string;
}

type Flow = { state: string; verifier: string; returnTo?: string };

/** The flow cookie, or null when it is missing or not ours. Never throws. */
function readFlow(raw: unknown): Flow | null {
  if (typeof raw !== "string") return null;
  try {
    const flow = JSON.parse(raw);
    return typeof flow?.state === "string" && typeof flow?.verifier === "string" ? flow : null;
  } catch {
    return null;
  }
}

/** PKCE: a random secret, and the SHA-256 of it that Google sees up front. */
function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

@Controller("auth")
export class OAuthController {
  constructor(
    private readonly google: GoogleProvider,
    private readonly oauth: OAuthService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get("google")
  start(@Query("return_to") returnTo: string | undefined, @Res() res: Response) {
    // Only an origin on the CORS allowlist is honoured — the same rule password-reset and
    // Paystack links use — so ?return_to= cannot bounce a sign-in to someone else's site.
    // Anything else falls back to FRONTEND_URL, which is also what an older frontend
    // that sends no return_to gets.
    const frontend = resolveReturnOrigin(this.config, returnTo);

    // Reached by a full-page navigation from the sign-in button, so a raw 503 JSON body
    // would replace the app with an error document. Send the user back to the sign-in
    // screen instead and let it show the message in context.
    if (!this.google.isConfigured) {
      return res.redirect(`${frontend}/auth?error=${encodeURIComponent("google_not_configured")}`);
    }

    const state = randomBytes(16).toString("base64url");
    const { verifier, challenge } = pkcePair();

    const flow: Flow = { state, verifier, returnTo: frontend };
    res.cookie(FLOW_COOKIE, JSON.stringify(flow), {
      httpOnly: true,
      sameSite: "lax", // must survive Google's cross-site redirect back to us
      secure: this.config.get<string>("NODE_ENV") === "production",
      maxAge: FLOW_TTL_MS,
      path: "/api/auth",
    });

    res.redirect(this.google.authorizationUrl({ state, codeChallenge: challenge }));
  }

  @Get("google/callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Read the flow first: it says which domain to send the browser back to, even when
    // the sign-in failed. Re-checked against the allowlist rather than trusted — the
    // cookie is ours, but nothing signs it.
    const raw = req.cookies?.[FLOW_COOKIE];
    res.clearCookie(FLOW_COOKIE, { path: "/api/auth" });
    const flow = readFlow(raw);
    const frontend = resolveReturnOrigin(this.config, flow?.returnTo);
    const fail = (reason: string) =>
      res.redirect(`${frontend}/auth?error=${encodeURIComponent(reason)}`);

    // The user pressed "cancel" on Google's consent screen.
    if (error) return fail(error);
    if (!code || !state) return fail("missing_code");
    if (!raw) return fail("expired_flow");
    if (!flow) return fail("bad_flow");

    // CSRF check: the state coming back must be the one we sent.
    if (flow.state !== state) return fail("state_mismatch");

    try {
      const profile = await this.google.exchangeCode({ code, codeVerifier: flow.verifier });
      const user = await this.oauth.resolveUser(this.google.name, profile);
      const exchangeCode = await this.oauth.issueExchangeCode(user.id);
      return res.redirect(`${frontend}/auth/callback?code=${encodeURIComponent(exchangeCode)}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "oauth_failed";
      return fail(message);
    }
  }

  /** Trade the one-time code for a real token pair. Tokens never travel in a URL. */
  @Post("oauth/exchange")
  @HttpCode(200)
  async exchange(@Body() dto: ExchangeDto, @Req() req: Request) {
    const userId = await this.oauth.redeemExchangeCode(dto.code);
    return this.auth.issueForUserId(userId, req.get("user-agent") ?? undefined);
  }
}
