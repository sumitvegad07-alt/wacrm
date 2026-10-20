// ============================================================
// Every figure that prints on an invoice, from its lines and four options.
//
// The ONE place the discount is applied. `quote()` in lib/plans/pricing.ts can
// discount too, so the invoice calls it with discountPct 0 and gstRate 0 and
// uses it only for the rate and the gross plan-line amount. Otherwise a
// discount would come off the plan line inside quote() and off the subtotal
// again here, and the extra charge lines would escape it entirely.
//
// Deliberately whole-rupee throughout: an invoice printing ₹26,082.40 invites a
// conversation about forty paise. Tax is computed ONCE, over the discounted
// taxable value, never per line, so the printed rows always add up to the
// printed total.
// ============================================================

import type { GstType } from "@/lib/gst/states";
import { splitTax } from "./tax";
import type { InvoiceLine } from "./types";

export interface TotalsOptions {
  gstEnabled: boolean;
  /** Percent. Ignored entirely when `gstEnabled` is false. */
  gstRate: number;
  gstType: GstType | null;
  /** Percent, 0–100. Takes precedence over `discountAmount`. */
  discountPct?: number;
  /** Rupees. Used only when `discountPct` is absent or zero. */
  discountAmount?: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  total: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Users × months × rate. A one-off charge is 1 × 1 × the whole amount. */
export function lineAmount(line: InvoiceLine): number {
  return Math.round(num(line?.users) * num(line?.months) * num(line?.rate));
}

export function invoiceTotals(lines: InvoiceLine[], opts: TotalsOptions): InvoiceTotals {
  const subtotal = (lines ?? []).reduce((sum, l) => sum + lineAmount(l), 0);

  const pct = Math.min(100, Math.max(0, num(opts?.discountPct)));
  const flat = Math.max(0, num(opts?.discountAmount));
  const rawDiscount = pct > 0 ? Math.round((subtotal * pct) / 100) : flat;

  // A discount larger than the invoice is a typo, not a credit note.
  const discountAmount = Math.min(subtotal, Math.round(rawDiscount));
  const taxableValue = subtotal - discountAmount;

  const tax = opts?.gstEnabled
    ? splitTax(taxableValue, num(opts.gstRate), opts.gstType)
    : { cgst: 0, sgst: 0, igst: 0, total: 0 };

  return {
    subtotal,
    discountAmount,
    taxableValue,
    cgst: tax.cgst,
    sgst: tax.sgst,
    igst: tax.igst,
    taxTotal: tax.total,
    total: taxableValue + tax.total,
  };
}

// ------------------------------------------------------------
// Amount in words — required on a tax invoice, and in the Indian scale
// (thousand, lakh, crore), not the Western one.
// ------------------------------------------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/** Recursive on the Indian scale, so a crore figure needs no special case. */
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rest = n % 10;
    return TENS[Math.floor(n / 10)] + (rest ? ` ${ONES[rest]}` : "");
  }
  if (n < 1_000) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)]} Hundred` + (rest ? ` ${words(rest)}` : "");
  }
  if (n < 100_000) {
    const rest = n % 1_000;
    return `${words(Math.floor(n / 1_000))} Thousand` + (rest ? ` ${words(rest)}` : "");
  }
  if (n < 10_000_000) {
    const rest = n % 100_000;
    return `${words(Math.floor(n / 100_000))} Lakh` + (rest ? ` ${words(rest)}` : "");
  }
  const rest = n % 10_000_000;
  return `${words(Math.floor(n / 10_000_000))} Crore` + (rest ? ` ${words(rest)}` : "");
}

/** "Rupees One Lakh Twenty Three Thousand Four Hundred Only". */
export function amountInWords(amount: number): string {
  const n = Math.round(Math.max(0, num(amount)));
  return `Rupees ${n === 0 ? "Zero" : words(n)} Only`;
}
