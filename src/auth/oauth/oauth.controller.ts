// Social sign-in endpoints.
//
//   GET  /api/auth/google           → redirect the browser to Google
//   GET  /api/auth/google/callback  → Google sends the user back here
//   POST /api/auth/oauth/exchange   → frontend trades the one-time code for tokens
//
// The state and PKCE verifier live in a short-lived httpOnly cookie rather than in the
// database: the browser carries them between the two requests, so the flow works
// unchanged across multiple server instances with no shared state.
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { IsString, MaxLength } from "class-validator";
import { AuthService } from "../auth.service";
import { UsersService } from "@/users/users.service";
import { GoogleProvider } from "./google.provider";
import { OAuthService } from "./oauth.service";

const FLOW_COOKIE = "endeleo_oauth_flow";
const FLOW_TTL_MS = 10 * 60_000;

export class ExchangeDto {
  @IsString()
  @MaxLength(200)
  code!: string;
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
  start(@Res() res: Response) {
    const state = randomBytes(16).toString("base64url");
    const { verifier, challenge } = pkcePair();

    res.cookie(FLOW_COOKIE, JSON.stringify({ state, verifier }), {
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
    const frontend = this.config.getOrThrow<string>("FRONTEND_URL");
    const fail = (reason: string) =>
      res.redirect(`${frontend}/auth?error=${encodeURIComponent(reason)}`);

    // The user pressed "cancel" on Google's consent screen.
    if (error) return fail(error);
    if (!code || !state) return fail("missing_code");

    const raw = req.cookies?.[FLOW_COOKIE];
    res.clearCookie(FLOW_COOKIE, { path: "/api/auth" });
    if (!raw) return fail("expired_flow");

    let flow: { state: string; verifier: string };
    try {
      flow = JSON.parse(raw);
    } catch {
      return fail("bad_flow");
    }

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
