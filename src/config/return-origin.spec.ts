import { describe, it, expect } from "vitest";
import { resolveReturnOrigin } from "./return-origin";

const config = (cors: string[], frontend = "https://app.endeleo.online") =>
  ({
    get: (k: string) => (k === "CORS_ORIGINS" ? cors : undefined),
    getOrThrow: (k: string) => {
      if (k === "FRONTEND_URL") return frontend;
      throw new Error(`missing ${k}`);
    },
  }) as any;

const ALLOWED = [
  "https://application.endeleo.online",
  "https://submission.endeleo.online",
  "https://arrangement.endeleo.online",
];

describe("resolveReturnOrigin", () => {
  // The bug this exists for: FRONTEND_URL pointed at app.endeleo.online, which serves a
  // different deployment with no /reset-password route, so every reset link 404'd.
  it("prefers the surface the request actually came from", () => {
    expect(
      resolveReturnOrigin(config(ALLOWED), "https://application.endeleo.online"),
    ).toBe("https://application.endeleo.online");
  });

  it("keeps each surface on its own domain", () => {
    for (const origin of ALLOWED) {
      expect(resolveReturnOrigin(config(ALLOWED), origin)).toBe(origin);
    }
  });

  // Origin is a request header the caller controls. Without the allowlist check this
  // would mint password reset links pointing at an attacker's domain.
  it("refuses an origin that is not on the allowlist", () => {
    expect(resolveReturnOrigin(config(ALLOWED), "https://evil.example.com")).toBe(
      "https://app.endeleo.online",
    );
    expect(resolveReturnOrigin(config(ALLOWED), "https://application.endeleo.online.evil.com")).toBe(
      "https://app.endeleo.online",
    );
  });

  it("falls back to FRONTEND_URL when there is no Origin at all", () => {
    expect(resolveReturnOrigin(config(ALLOWED), undefined)).toBe("https://app.endeleo.online");
    expect(resolveReturnOrigin(config(ALLOWED), "")).toBe("https://app.endeleo.online");
  });

  it("does not fall over when CORS_ORIGINS is unset", () => {
    expect(resolveReturnOrigin(config([]), "https://application.endeleo.online")).toBe(
      "https://app.endeleo.online",
    );
  });
});
