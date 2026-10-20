// ============================================================
// Where the next period starts and ends.
//
// A period ENDS THE DAY BEFORE the next one begins: a yearly term from 1 Nov
// 2026 ends 31 Oct 2027, not 1 Nov. Off by a day in one direction double-bills
// a day; in the other it leaves a gap, and the gap is what makes a paid-up
// customer show as overdue.
//
// Month arithmetic is done in UTC with an explicit clamp, so a 31 January start
// plus three months lands on 30 April rather than overflowing into May — which
// is what `setMonth` does on its own. The period then ends 29 April: one day
// short, because February is. Clamping down is the only option that keeps a
// quarterly term three months long, and the no-gap invariant still holds, which
// is what the register actually depends on.
// ============================================================

import { asTerm, TERM_MONTHS, type BillingTerm } from "@/lib/plans/pricing";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parts(date: string): [number, number, number] | null {
  if (!DATE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function iso(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Days in a given month, 1-indexed: day 0 of the NEXT month is this one's last. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(date: string, months: number): string | null {
  const p = parts(date);
  if (!p) return null;
  const [y, m, d] = p;

  const zero = m - 1 + months;
  const year = y + Math.floor(zero / 12);
  const month = (((zero % 12) + 12) % 12) + 1;

  // Clamp rather than overflow: 31 Jan + 1 month is 28 Feb, not 3 March.
  const day = Math.min(d, daysInMonth(year, month));
  return iso(year, month, day);
}

function addDays(date: string, days: number): string | null {
  const p = parts(date);
  if (!p) return null;
  const [y, m, d] = p;

  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return iso(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** The last day of a period that starts on `start` and runs one whole term. */
export function periodEnd(start: string, term: BillingTerm | null): string {
  const months = TERM_MONTHS[asTerm(term)];
  const sameDayNextTerm = addMonths(start, months);
  if (!sameDayNextTerm) return "";

  return addDays(sameDayNextTerm, -1) ?? "";
}

/** The period that follows one ending on `currentEnd`. */
export function nextPeriod(
  currentEnd: string,
  term: BillingTerm | null,
): { start: string; end: string } {
  const start = addDays(currentEnd, 1);
  if (!start) return { start: "", end: "" };

  return { start, end: periodEnd(start, term) };
}
