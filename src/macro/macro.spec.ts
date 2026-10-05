import { describe, it, expect } from "vitest";
import { realRatePct } from "./macro.service";

// The reason this is Fisher rather than subtraction: at Nigerian inflation the two
// diverge by enough to change how a coupon reads.
describe("realRatePct", () => {
  it("is negative when a coupon trails inflation", () => {
    expect(realRatePct(21, 23.01)).toBeLessThan(0);
  });

  it("differs from naive subtraction by enough to matter here", () => {
    const fisher = realRatePct(21, 23.01);
    const naive = 21 - 23.01;
    expect(Math.abs(fisher - naive)).toBeGreaterThan(0.3);
    // Naive says −2.01%; the real figure is about −1.63%.
    expect(fisher).toBeCloseTo(-1.63, 1);
  });

  it("is positive when a coupon beats inflation", () => {
    expect(realRatePct(21, 15.39)).toBeGreaterThan(4);
  });

  it("is zero when they match", () => {
    expect(realRatePct(18, 18)).toBeCloseTo(0, 10);
  });
});
