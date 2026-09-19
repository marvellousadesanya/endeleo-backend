// M3 — bond structuring: fixed rules and a static covenant template, not the pitch
// deck's SciPy multi-objective optimiser. That optimiser needs a corpus of
// comparable structures to optimise against; this needs a reviewer who can read a
// DSCR table. Good enough to unblock the pipeline; replace with the real thing once
// there's deal history and a covenant corpus to draw from.
import { DSCR_MINIMUM, type DscrYear } from "./feasibility";

export type Repayment = "bullet" | "amortising";

export interface StructureRecommendation {
  instrumentType: "senior_secured";
  couponType: "fixed";
  couponFrequency: "semiannual";
  tenorMonths: number;
  repayment: Repayment;
  covenants: string[];
  notes: string[];
}

/** Semi-annual fixed-coupon senior secured is the deck's own default for NGN retail/diaspora bonds. */
const STANDARD_COVENANTS = [
  `Maintain minimum DSCR of ${DSCR_MINIMUM}x, tested semi-annually`,
  "Restricted payments to sponsor while DSCR is below 1.5x",
  "Change-of-control notice to trustee within 30 days",
  "Quarterly management accounts and annual audited financials to trustee",
];

/** Below this base-case DSCR headroom, bullet repayment concentrates too much risk in the maturity year. */
const BULLET_HEADROOM_THRESHOLD = 1.5;

export function recommendStructure(requestedTenorMonths: number, dscrTable: DscrYear[]): StructureRecommendation {
  const notes: string[] = [];

  // With no projection there is no headroom to assess, so fall back to the safer of
  // the two structures and say why — rather than reporting a "thin 0x headroom",
  // which reads as a measurement when nothing was actually measured.
  if (dscrTable.length === 0) {
    notes.push(
      "No cashflow projection submitted — there is nothing to size repayment against. Amortising is the provisional default; revisit once projections are in.",
    );
    return {
      instrumentType: "senior_secured",
      couponType: "fixed",
      couponFrequency: "semiannual",
      tenorMonths: requestedTenorMonths,
      repayment: "amortising",
      covenants: STANDARD_COVENANTS,
      notes,
    };
  }

  const minBaseDscr = Math.min(...dscrTable.map((d) => d.dscr.base));
  const repayment: Repayment = minBaseDscr >= BULLET_HEADROOM_THRESHOLD ? "bullet" : "amortising";
  if (repayment === "amortising") {
    notes.push(
      `Base-case DSCR headroom is thin (min ${minBaseDscr}x, below the ${BULLET_HEADROOM_THRESHOLD}x bar for bullet) — amortising repayment recommended to spread the burden instead of concentrating it at maturity.`,
    );
  }

  // A projection shorter than the tenor cannot show whether the bond is serviceable
  // in the years it is actually outstanding, so the DSCR table below is not evidence
  // about those later years either way.
  const projectedYears = dscrTable.length;
  const requestedYears = Math.ceil(requestedTenorMonths / 12);
  if (projectedYears < requestedYears) {
    notes.push(
      `Projection covers ${projectedYears} year${projectedYears === 1 ? "" : "s"} but the requested tenor runs ${requestedYears} — the remaining ${requestedYears - projectedYears} year${requestedYears - projectedYears === 1 ? "" : "s"} of debt service are unevidenced. Request a projection spanning the full tenor.`,
    );
  }

  const finalYear = dscrTable[dscrTable.length - 1];
  if (finalYear.dscr.base < DSCR_MINIMUM) {
    notes.push(
      `The last projected year (${finalYear.year}) does not clear the ${DSCR_MINIMUM}x DSCR floor — consider a longer tenor or a smaller raise.`,
    );
  }

  return {
    instrumentType: "senior_secured",
    couponType: "fixed",
    couponFrequency: "semiannual",
    tenorMonths: requestedTenorMonths,
    repayment,
    covenants: STANDARD_COVENANTS,
    notes,
  };
}
