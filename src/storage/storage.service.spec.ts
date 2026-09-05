// LocalDiskStorage's tests lived here before it was removed (R2 is now the only
// driver — see storage.service.ts). R2Storage's own methods all call out to AWS's S3
// SDK, so they need a mocked client to test meaningfully; that isn't set up yet. This
// covers the one piece of R2Storage that is pure logic and needs no network.
import { describe, it, expect } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { R2Storage } from "./r2.storage";

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const v = values[key];
      if (v === undefined) throw new Error(`missing ${key}`);
      return v;
    },
  } as unknown as ConfigService;
}

describe("R2Storage.getPublicUrl", () => {
  const base = {
    R2_ACCOUNT_ID: "acc",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "bucket",
  };

  it("builds a URL under the configured public base", () => {
    const storage = new R2Storage(fakeConfig({ ...base, R2_PUBLIC_URL: "https://cdn.example.com/" }));
    expect(storage.getPublicUrl("bond-covers/abc.png")).toBe(
      "https://cdn.example.com/bond-covers/abc.png",
    );
  });

  it("throws when R2_PUBLIC_URL is not set — a presigned URL is the wrong tool for a cached asset", () => {
    const storage = new R2Storage(fakeConfig(base));
    expect(() => storage.getPublicUrl("bond-covers/abc.png")).toThrow(/R2_PUBLIC_URL/);
  });
});
