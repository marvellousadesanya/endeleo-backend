import { describe, it, expect } from "vitest";
import { parseOpinion } from "./arrangement-ai.service";

// The model is told to reply with JSON and nothing else. It will sometimes not. Every
// failure here has to end as null, because the caller falls back to the deterministic
// figures — a thrown parse error would take down a screen that has a perfectly good
// answer already computed.

const good = {
  verdict: "Bankable, with tariff collection risk",
  rationale: "Coverage clears the floor in every modelled year.",
  value: 78,
  confidence: 0.7,
  flags: ["Tariff is regulated but collection history is unproven"],
};

describe("parseOpinion", () => {
  it("reads a clean JSON reply", () => {
    expect(parseOpinion(JSON.stringify(good))).toEqual(good);
  });

  it("reads JSON wrapped in prose or a code fence", () => {
    expect(
      parseOpinion("Here is my assessment:\n```json\n" + JSON.stringify(good) + "\n```")?.verdict,
    ).toBe(good.verdict);
    expect(parseOpinion("```json\n" + JSON.stringify(good) + "\n```")?.value).toBe(78);
    expect(parseOpinion("Sure thing. " + JSON.stringify(good))?.confidence).toBe(0.7);
  });

  it("returns null rather than throwing on anything unparseable", () => {
    for (const junk of ["", "I cannot help with that.", "{", "{ not json }", "null", "[]"]) {
      expect(parseOpinion(junk)).toBeNull();
    }
  });

  // A verdict or rationale is the whole point — an opinion without one is not an opinion.
  it("rejects a reply missing the fields that carry meaning", () => {
    expect(parseOpinion(JSON.stringify({ ...good, verdict: "" }))).toBeNull();
    expect(parseOpinion(JSON.stringify({ ...good, rationale: "   " }))).toBeNull();
    expect(parseOpinion(JSON.stringify({ value: 80, confidence: 1 }))).toBeNull();
  });

  it("clamps confidence into range instead of trusting it", () => {
    expect(parseOpinion(JSON.stringify({ ...good, confidence: 4 }))?.confidence).toBe(1);
    expect(parseOpinion(JSON.stringify({ ...good, confidence: -2 }))?.confidence).toBe(0);
    expect(parseOpinion(JSON.stringify({ ...good, confidence: "high" }))?.confidence).toBe(0.5);
  });

  it("drops a value that is not a usable number", () => {
    for (const bad of ["78", null, NaN, Infinity]) {
      expect(parseOpinion(JSON.stringify({ ...good, value: bad }))?.value).toBeNull();
    }
  });

  it("keeps flags to strings, and caps how many it will take", () => {
    const messy = { ...good, flags: ["ok", 5, null, "also ok"] };
    expect(parseOpinion(JSON.stringify(messy))?.flags).toEqual(["ok", "also ok"]);
    const many = { ...good, flags: Array.from({ length: 40 }, (_, i) => `flag ${i}`) };
    expect(parseOpinion(JSON.stringify(many))?.flags).toHaveLength(10);
  });
});
