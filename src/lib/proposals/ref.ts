// ============================================================
// Proposal reference numbers, in the shape the first proposal used:
//   OZZO/2026/09/SNM-01
// Generated on create, then freely editable — the founder's numbering is his.
// ============================================================

/** Words that say "this is a company" rather than which company. */
const NOISE = new Set([
  "pvt", "private", "ltd", "limited", "llp", "inc", "incorporated",
  "corp", "corporation", "co", "company", "and", "the", "of",
]);

/**
 * A short alphabetic code for a company: word initials, or the first three
 * letters when only one meaningful word survives.
 */
export function companyCode(name: string): string {
  const words = (name ?? "")
    // An "M/s." prefix is a form of address, not part of the name. Dropped
    // before punctuation is stripped, or it would contribute M and S.
    .replace(/^\s*m\/?s[.\s]+/i, "")
    // Digits and punctuation never belong in the code ("3M" → "M").
    .replace(/[^A-Za-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NOISE.has(w.toLowerCase()));

  if (words.length === 0) return "OZ";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();

  return words
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/**
 * Year and month come from the proposal's own date, read in local terms — an
 * ISO string is split rather than passed through `Date`, so a proposal dated
 * the 1st never slips to the previous month in IST.
 */
function yearMonth(date: string | Date): { year: number; month: number } {
  if (typeof date === "string") {
    const [y, m] = date.split("-");
    return { year: Number(y), month: Number(m) };
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function buildRef(companyName: string, date: string | Date, sequence: number): string {
  const { year, month } = yearMonth(date);
  const mm = String(month).padStart(2, "0");
  const nn = String(sequence).padStart(2, "0");
  return `OZZO/${year}/${mm}/${companyCode(companyName)}-${nn}`;
}
