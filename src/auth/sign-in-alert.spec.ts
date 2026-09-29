import { describe, it, expect } from "vitest";
import { deviceSignature, isUnrecognisedDevice, signInAlertEmail } from "./sign-in-alert";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
/** Same machine, four weeks later. Only the version moved. */
const CHROME_MAC_UPDATED =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.55 Safari/537.36";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("deviceSignature", () => {
  it("reads browser and OS families", () => {
    expect(deviceSignature(CHROME_MAC)).toBe("Chrome on macOS");
    expect(deviceSignature(SAFARI_IPHONE)).toBe("Safari on iPhone");
  });

  // Every Chromium browser carries "chrome" and "safari" in its UA, so naive matching
  // reports Edge as Chrome and Chrome as Safari.
  it("does not mistake Edge for Chrome", () => {
    expect(deviceSignature(EDGE_WINDOWS)).toBe("Edge on Windows");
  });

  it("survives a browser version bump", () => {
    expect(deviceSignature(CHROME_MAC_UPDATED)).toBe(deviceSignature(CHROME_MAC));
  });

  it("does not throw on a missing or junk agent", () => {
    expect(deviceSignature(undefined)).toBe("unknown");
    expect(deviceSignature(null)).toBe("unknown");
    expect(deviceSignature("curl/8.4.0")).toMatch(/browser on an unrecognised device/);
  });
});

describe("isUnrecognisedDevice", () => {
  it("stays quiet on a device already seen", () => {
    expect(isUnrecognisedDevice(CHROME_MAC, [CHROME_MAC])).toBe(false);
  });

  // The whole point of signature matching: a Chrome update must not look like a break-in.
  it("stays quiet when only the browser version changed", () => {
    expect(isUnrecognisedDevice(CHROME_MAC_UPDATED, [CHROME_MAC])).toBe(false);
  });

  it("fires on a genuinely different device", () => {
    expect(isUnrecognisedDevice(EDGE_WINDOWS, [CHROME_MAC, SAFARI_IPHONE])).toBe(true);
  });

  // First sign-in after registering. The welcome email already said the account exists;
  // a second email one second later saying so again is noise, not security.
  it("stays quiet when the account has no history at all", () => {
    expect(isUnrecognisedDevice(CHROME_MAC, [])).toBe(false);
  });

  it("treats an absent agent as its own signature rather than crashing", () => {
    expect(isUnrecognisedDevice(undefined, [CHROME_MAC])).toBe(true);
    expect(isUnrecognisedDevice(undefined, [null])).toBe(false);
  });
});

describe("signInAlertEmail", () => {
  const { subject, html } = signInAlertEmail({
    device: "Edge on Windows",
    when: new Date("2026-09-29T14:30:00Z"),
    frontendUrl: "https://application.endeleo.online",
  });

  it("names the device and tells the reader what to do if it was not them", () => {
    expect(subject).toMatch(/new sign-in/i);
    expect(html).toContain("Edge on Windows");
    expect(html).toMatch(/if this was not you/i);
    expect(html).toContain("https://application.endeleo.online/dashboard/security");
  });

  it("states the time in Lagos, so the reader can judge whether it was them", () => {
    expect(html).toContain("WAT");
    expect(html).toMatch(/2026/);
  });
});
