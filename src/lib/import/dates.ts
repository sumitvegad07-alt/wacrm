// Strict date reading for imports where a wrong guess would be silent data damage.
//
// Accepted:  dd-mm-yyyy   dd/mm/yyyy   yyyy-mm-dd      (day and month may be 1 or 2 digits in
//            the day-first forms; ISO is always zero-padded)
// Rejected:  a two-digit year ("01-02-26" could be 2026 or 1926: we do not pick), anything
//            month-first, slashed or dotted ISO, free text, and impossible calendar dates.
//
// MIRROR: public.import_parse_service_date() in supabase/migrations/20260929155000_fsm_import_customer_assets.sql
// applies the same rules on the server. The two must change together.

const DMY = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function build(year: number, month: number, day: number): string | null {
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  // Date.UTC rolls an overflowing day into the next month, so read the parts back to detect it.
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCFullYear(year); // years 0-99 are otherwise read as 1900-1999
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The date as `yyyy-mm-dd`, or null when the text is not an acceptable date. */
export function parseDmyDate(value: string): string | null {
  const v = value.trim();
  const iso = ISO.exec(v);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = DMY.exec(v);
  if (dmy) return build(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}
