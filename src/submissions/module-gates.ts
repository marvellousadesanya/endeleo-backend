// Which stages of the pipeline carry a sign-off, and in what order.
//
// The design this follows puts a "Human Review Gate" on five modules, each with an
// approve button and a send-back button. Every one of those buttons was decorative — no
// handler, nothing persisted. These are the rules behind the real ones.
//
// Only stages that produce something to stand behind are gated. M4 (memorandum drafting)
// and M7 (closing) have no implementation, so there is nothing to sign; M6's checklist
// lives on the bond once a deal is promoted. Gating a stage that computes nothing would
// be asking a reviewer to certify an empty screen.

export const GATED_MODULES = ["m1", "m2", "m3", "m5"] as const;
export type GatedModule = (typeof GATED_MODULES)[number];

export function isGatedModule(value: string): value is GatedModule {
  return (GATED_MODULES as readonly string[]).includes(value);
}

/** What each sign-off means, shown on the gate and recorded against the approval. */
export const GATE_LABELS: Record<GatedModule, { action: string; means: string }> = {
  m1: {
    action: "Accept intake",
    means: "The submitted figures and self-assessment are complete enough to screen.",
  },
  m2: {
    action: "Sign feasibility report",
    means: "The coverage table and bankability verdict have been reviewed and stand.",
  },
  m3: {
    action: "Approve structuring",
    means: "The recommended instrument, repayment profile and covenants are agreed.",
  },
  m5: {
    action: "Approve indicative pricing",
    means: "The benchmark and spread have been checked against the market by a person.",
  },
};

/**
 * The stage that must be signed before this one can be.
 *
 * Sequencing is the point of a gate. Approving a structure before anyone has signed off
 * the feasibility it was derived from certifies a conclusion whose premise is unread —
 * and the design says as much: "Structuring must be approved by the Lead Arranger before
 * the IM drafting engine is unlocked."
 */
export function prerequisiteOf(module: GatedModule): GatedModule | null {
  const i = GATED_MODULES.indexOf(module);
  return i <= 0 ? null : GATED_MODULES[i - 1];
}

/** Whether `module` can be signed given what is already signed. */
export function canApprove(module: GatedModule, approved: readonly string[]): boolean {
  if (approved.includes(module)) return false;
  const prerequisite = prerequisiteOf(module);
  return prerequisite === null || approved.includes(prerequisite);
}

/**
 * Revoking a sign-off revokes everything downstream of it.
 *
 * Otherwise sending feasibility back for a re-run would leave the structure and the price
 * still showing as signed — approvals of conclusions drawn from a premise that has just
 * been withdrawn.
 */
export function cascadeRevoke(module: GatedModule): GatedModule[] {
  const i = GATED_MODULES.indexOf(module);
  return GATED_MODULES.slice(i) as unknown as GatedModule[];
}
