// ============================================================
// The Indian financial year, as an invoice number spells it: "26-27".
//
// Starts 1 April. A yyyy-mm-dd string is SPLIT, never passed through `Date`:
// Vercel runs in UTC, and parsing "2026-04-01" then reading it back in any
// timezone behind UTC gives 31 March — which would renumber the whole year.
// Same reasoning as `src/lib/proposals/ref.ts`.
// ============================================================

function yearMonth(date: string | Date): { year: number; month: number } {
  if (typeof date === "string") {
    const [y, m] = date.split("-");
    return { year: Number(y), month: Number(m) };
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** Two-digit year, so 2026 reads "26" and 2100 reads "00". */
function yy(year: number): string {
  return String(((year % 100) + 100) % 100).padStart(2, "0");
}

/** `financialYear('2026-04-01')` → `'26-27'`; `('2026-03-31')` → `'25-26'`. */
export function financialYear(date: string | Date): string {
  const { year, month } = yearMonth(date);
  const startYear = month >= 4 ? year : year - 1;
  return `${yy(startYear)}-${yy(startYear + 1)}`;
}
