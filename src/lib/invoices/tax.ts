// ============================================================
// Splitting an invoice's taxable value into CGST + SGST or IGST.
//
// The intra/inter-state RULE is not reimplemented here: `determineGstType()` in
// lib/gst/states.ts already owns it, and is the TS mirror of the SQL
// `gst_state_code()` the tenant Orders module persists with. This file only
// does the arithmetic.
//
// CGST and SGST are each computed at HALF the rate, not as a split of the whole
// tax. They are separate levies at their own rate, so they must print as equal
// figures; halving a single rounded total would make them differ by a rupee on
// an odd amount. The side-effect is that an intra-state invoice can total one
// rupee away from an inter-state one at the same rate. That is correct, and it
// is why the rows always add up to the printed total.
// ============================================================

import { gstStateCode, gstStateCodeFromGstin } from "@/lib/gst/states";
import type { GstType } from "@/lib/gst/states";

export interface TaxSplit {
  cgst: number;
  sgst: number;
  igst: number;
  /** cgst + sgst + igst. Always one or the other pair, never both. */
  total: number;
}

const ZERO: TaxSplit = { cgst: 0, sgst: 0, igst: 0, total: 0 };

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function splitTax(
  taxableValue: number,
  ratePct: number,
  gstType: GstType | null,
): TaxSplit {
  const base = num(taxableValue);
  const rate = num(ratePct);

  // 'unknown' means the place of supply could not be determined. Charging
  // nothing is the only honest answer; the API refuses to issue in that state.
  if (base <= 0 || rate <= 0 || !gstType || gstType === "unknown") return { ...ZERO };

  if (gstType === "interstate") {
    const igst = Math.round((base * rate) / 100);
    return { cgst: 0, sgst: 0, igst, total: igst };
  }

  const half = Math.round((base * rate) / 200);
  return { cgst: half, sgst: half, igst: 0, total: half * 2 };
}

/**
 * The 2-digit place-of-supply code.
 *
 * A registered buyer's GSTIN carries it in its first two characters, which is
 * authoritative. An unregistered (B2C) buyer is placed by the state picked on
 * the invoice — `gstStateCode()` already returns null for a name that is not a
 * real state, so no further validation is needed here.
 *
 * Null when neither is usable. The caller must then refuse to issue a GST
 * invoice rather than print a silently wrong tax split.
 */
export function placeOfSupply(buyerGstin: string, buyerStateName: string): string | null {
  return gstStateCodeFromGstin(buyerGstin) ?? gstStateCode(buyerStateName) ?? null;
}
