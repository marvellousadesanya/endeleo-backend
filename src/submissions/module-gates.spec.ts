import { describe, it, expect } from "vitest";
import {
  GATED_MODULES,
  canApprove,
  cascadeRevoke,
  isGatedModule,
  prerequisiteOf,
} from "./module-gates";

describe("which stages carry a sign-off", () => {
  // M4 and M7 have no implementation and M6's checklist lives on the bond. Gating a
  // stage that computes nothing asks a reviewer to certify an empty screen.
  it("gates only the stages that produce something", () => {
    expect([...GATED_MODULES]).toEqual(["m1", "m2", "m3", "m5"]);
    for (const ungated of ["m4", "m6", "m7"]) {
      expect(isGatedModule(ungated)).toBe(false);
    }
  });

  it("rejects anything that is not a stage at all", () => {
    for (const junk of ["", "m8", "M2", "feasibility", "../m2"]) {
      expect(isGatedModule(junk)).toBe(false);
    }
  });
});

describe("sequencing", () => {
  it("opens the first gate with nothing signed", () => {
    expect(canApprove("m1", [])).toBe(true);
  });

  // Approving a structure before the feasibility it was derived from is signed certifies
  // a conclusion whose premise is unread.
  it("keeps a later gate shut until its prerequisite is signed", () => {
    expect(canApprove("m3", ["m1"])).toBe(false);
    expect(canApprove("m3", ["m1", "m2"])).toBe(true);
  });

  it("names the stage that must come first", () => {
    expect(prerequisiteOf("m1")).toBeNull();
    expect(prerequisiteOf("m2")).toBe("m1");
    expect(prerequisiteOf("m5")).toBe("m3");
  });

  it("will not sign the same stage twice", () => {
    expect(canApprove("m2", ["m1", "m2"])).toBe(false);
  });
});

describe("revoking", () => {
  // Sending feasibility back for a re-run must not leave the structure and the price
  // still reading as signed.
  it("takes everything downstream with it", () => {
    expect(cascadeRevoke("m2")).toEqual(["m2", "m3", "m5"]);
    expect(cascadeRevoke("m5")).toEqual(["m5"]);
    expect(cascadeRevoke("m1")).toEqual(["m1", "m2", "m3", "m5"]);
  });

  it("leaves the pipeline re-approvable from the revoked stage", () => {
    const approved = ["m1", "m2", "m3"].filter((m) => !cascadeRevoke("m2").includes(m as never));
    expect(approved).toEqual(["m1"]);
    expect(canApprove("m2", approved)).toBe(true);
    expect(canApprove("m3", approved)).toBe(false);
  });
});
