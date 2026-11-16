import { describe, it, expect } from "vitest";
import { appForPath, appUrl, linkTo } from "./app-urls";

// Links point at the app that owns their path, and nothing changes until the per-app
// URLs are set.

const configWith = (env: Record<string, string>) =>
  ({
    get: (k: string) => env[k],
    getOrThrow: (k: string) => {
      if (!(k in env)) throw new Error(`missing ${k}`);
      return env[k];
    },
  }) as any;

const FRONTEND_URL = "https://application.endeleo.online";
const SPLIT = {
  FRONTEND_URL,
  INVESTOR_URL: "https://application.endeleo.online",
  SPONSOR_URL: "https://submission.endeleo.online",
  ARRANGEMENT_URL: "https://arrangement.endeleo.online",
  ADMIN_URL: "https://console.endeleo.online",
};

describe("appForPath", () => {
  it("matches the frontend's own routing table", () => {
    expect(appForPath("/dashboard/wallet")).toBe("investor");
    expect(appForPath("/sponsor")).toBe("sponsor");
    expect(appForPath("/sponsor/agreements")).toBe("sponsor");
    expect(appForPath("/admin/submissions/abc")).toBe("arrangement");
    expect(appForPath("/admin/bonds")).toBe("admin");
    expect(appForPath("/admin")).toBe("admin");
  });

  it("doesn't mistake a lookalike prefix for the real one", () => {
    expect(appForPath("/sponsor-signup")).toBe("investor");
    expect(appForPath("/admin/submissions-archive")).toBe("admin");
  });
});

describe("before the per-app URLs are set", () => {
  it("builds every link from FRONTEND_URL, exactly as before", () => {
    const config = configWith({ FRONTEND_URL });
    expect(linkTo(config, "/sponsor/agreements")).toBe(`${FRONTEND_URL}/sponsor/agreements`);
    expect(linkTo(config, "/admin/submissions/1")).toBe(`${FRONTEND_URL}/admin/submissions/1`);
    expect(appUrl(config, "sponsor")).toBe(FRONTEND_URL);
  });
});

describe("once they are set", () => {
  it("sends each link to the app that owns it", () => {
    const config = configWith(SPLIT);
    expect(linkTo(config, "/sponsor/funding")).toBe(
      "https://submission.endeleo.online/sponsor/funding",
    );
    expect(linkTo(config, "/admin/submissions/1")).toBe(
      "https://arrangement.endeleo.online/admin/submissions/1",
    );
    expect(linkTo(config, "/admin/bonds")).toBe("https://console.endeleo.online/admin/bonds");
    expect(linkTo(config, "/dashboard/portfolio")).toBe(
      "https://application.endeleo.online/dashboard/portfolio",
    );
  });
});
