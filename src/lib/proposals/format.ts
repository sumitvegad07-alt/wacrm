// ============================================================
// How the proposal prints dates and money.
// ============================================================

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "2026-09-22" → "22 September 2026", the wording on the reference proposal.
 *
 * Built from the string's own parts rather than a `Date`, so the printed date
 * is always the date that was entered — no server-timezone shift, which is the
 * bug class that put the wrong day on reports before.
 */
export function formatLongDate(iso: string): string {
  const [y, m, d] = (iso ?? "").split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return "";
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Indian digit grouping, no symbol — the markup supplies ₹ separately. */
export function inr(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}
