// Google as an OpenID Connect provider.
//
// Kept deliberately provider-shaped: adding Apple later means another file like this
// one, not changes to the service or controller.
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

/** What we ask Google for. Identity only — no access to mail, contacts or drive. */
const SCOPES = ["openid", "email", "profile"];

export interface GoogleProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  fullName?: string;
}

@Injectable()
export class GoogleProvider {
  readonly name = "google";
  private readonly logger = new Logger(GoogleProvider.name);
  // Cached across calls: the library refetches Google's signing keys only when they rotate.
  private readonly jwks = createRemoteJWKSet(JWKS_URL);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(
      this.config.get<string>("GOOGLE_CLIENT_ID") &&
        this.config.get<string>("GOOGLE_CLIENT_SECRET"),
    );
  }

  private assertConfigured() {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        "Google sign-in is not configured on this server",
      );
    }
  }

  get redirectUri(): string {
    return `${this.config.getOrThrow<string>("PUBLIC_API_URL")}/api/auth/google/callback`;
  }

  /**
   * Where to send the browser.
   *
   * `state` defends against CSRF; `code_challenge` is PKCE, which stops an intercepted
   * authorization code being redeemed by anyone who did not start the flow.
   */
  authorizationUrl(args: { state: string; codeChallenge: string }): string {
    this.assertConfigured();
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", this.config.getOrThrow<string>("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", args.state);
    url.searchParams.set("code_challenge", args.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    // Ask for an account chooser rather than silently reusing a signed-in Google session.
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  /** Swap the authorization code for tokens, then verify the identity token. */
  async exchangeCode(args: { code: string; codeVerifier: string }): Promise<GoogleProfile> {
    this.assertConfigured();

    const body = new URLSearchParams({
      code: args.code,
      client_id: this.config.getOrThrow<string>("GOOGLE_CLIENT_ID"),
      client_secret: this.config.getOrThrow<string>("GOOGLE_CLIENT_SECRET"),
      redirect_uri: this.redirectUri,
      grant_type: "authorization_code",
      code_verifier: args.codeVerifier,
    });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      this.logger.warn(`Google token exchange failed: ${res.status} ${await res.text()}`);
      throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
    }

    const tokens = (await res.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error("GOOGLE_NO_ID_TOKEN");

    return this.verifyIdToken(tokens.id_token);
  }

  /**
   * Verify Google's signature and claims ourselves rather than trusting the payload.
   * `audience` matters: without it, an id_token minted for a different application
   * would be accepted here.
   */
  private async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: ISSUERS,
      audience: this.config.getOrThrow<string>("GOOGLE_CLIENT_ID"),
    });

    const email = typeof payload.email === "string" ? payload.email : undefined;
    if (!payload.sub || !email) throw new Error("GOOGLE_INCOMPLETE_PROFILE");

    return {
      subject: payload.sub,
      email,
      emailVerified: payload.email_verified === true,
      fullName: typeof payload.name === "string" ? payload.name : undefined,
    };
  }
}
