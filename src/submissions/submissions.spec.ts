import { describe, it, expect } from "vitest";
import { parseCashflows } from "./submissions.service";

describe("parseCashflows", () => {
  it("returns an empty array when nothing was sent", () => {
    expect(parseCashflows(undefined)).toEqual([]);
  });

  it("parses a well-formed multi-year projection", () => {
    const rows = parseCashflows(
      JSON.stringify([
        { year: 2027, revenueMinor: "4500000000", opexMinor: "2800000000" },
        { year: 2028, revenueMinor: "5000000000", opexMinor: "3000000000" },
      ]),
    );
    expect(rows).toEqual([
      { year: 2027, revenueMinor: 4_500_000_000n, opexMinor: 2_800_000_000n },
      { year: 2028, revenueMinor: 5_000_000_000n, opexMinor: 3_000_000_000n },
    ]);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseCashflows("not json")).toThrow(/JSON array/);
  });

  it("rejects a non-array payload", () => {
    expect(() => parseCashflows(JSON.stringify({ year: 2027 }))).toThrow(/JSON array/);
  });

  it("rejects a year outside the sane range", () => {
    expect(() =>
      parseCashflows(JSON.stringify([{ year: 1999, revenueMinor: "1", opexMinor: "1" }])),
    ).toThrow(/year/);
  });

  it("rejects a duplicate year", () => {
    expect(() =>
      parseCashflows(
        JSON.stringify([
          { year: 2027, revenueMinor: "1", opexMinor: "1" },
          { year: 2027, revenueMinor: "2", opexMinor: "2" },
        ]),
      ),
    ).toThrow(/more than one entry for year 2027/);
  });

  it("rejects a non-numeric-string money field", () => {
    expect(() =>
      parseCashflows(JSON.stringify([{ year: 2027, revenueMinor: "4.5m", opexMinor: "1" }])),
    ).toThrow(/revenueMinor must be minor units/);
  });

  it("survives amounts beyond Number.MAX_SAFE_INTEGER", () => {
    const rows = parseCashflows(
      JSON.stringify([{ year: 2027, revenueMinor: "9007199254740993000", opexMinor: "0" }]),
    );
    expect(rows[0].revenueMinor).toBe(9_007_199_254_740_993_000n);
  });
});
