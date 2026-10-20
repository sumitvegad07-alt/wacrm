// ============================================================
// Invoice numbers: OZZO/26-27/001 for GST, OZZO/26-27/B001 for non-GST.
//
// Two series, each consecutive within its financial year, each restarting at 1
// on 1 April. GST rule 46(b) caps the number at 16 characters and allows only
// alphanumerics, "-" and "/" — which this shape satisfies up to four digits.
//
// The letter B is the whole difference between the two books, so that a number
// read aloud on a phone call says which one it came from.
// ============================================================

import type { InvoiceSeries } from "./types";

const PREFIX: Record<InvoiceSeries, string> = { gst: "", non_gst: "B" };

const PATTERN = /^OZZO\/(\d{2}-\d{2})\/(B?)(\d+)$/;

export function buildInvoiceNo(series: InvoiceSeries, fy: string, seq: number): string {
  const n = Math.max(1, Math.floor(Number(seq) || 1));
  return `OZZO/${fy}/${PREFIX[series]}${String(n).padStart(3, "0")}`;
}

/** The reverse, for reading a number the founder typed. Null when it is not ours. */
export function parseInvoiceNo(
  no: string,
): { series: InvoiceSeries; fy: string; seq: number } | null {
  const match = PATTERN.exec((no ?? "").trim());
  if (!match) return null;

  const [, fy, letter, digits] = match;
  return {
    series: letter === "B" ? "non_gst" : "gst",
    fy,
    seq: Number(digits),
  };
}

/**
 * The next sequence in a series.
 *
 * `override` is the founder's "start this year's book at 51", for a financial
 * year in which he had already issued invoices outside the app. It is honoured
 * only while it is still ahead: once the series has passed it, following the
 * last number is the only safe answer, because going backwards would collide
 * with a number already issued.
 */
export function nextSeq(lastSeq: number | null, override: number | null): number {
  const last = Number.isFinite(Number(lastSeq)) ? Math.max(0, Math.floor(Number(lastSeq))) : 0;
  const start = Number.isFinite(Number(override)) ? Math.floor(Number(override)) : 0;

  if (start > last) return Math.max(1, start);
  return last + 1;
}
