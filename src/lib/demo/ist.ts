// ============================================================
// India-local time, built explicitly rather than via the host timezone.
//
// Two different things read this data and they must agree about what day an
// event happened on:
//   - the dashboard tiles, which filter timestamps (`created_at`,
//     `check_in_at`) from local midnight;
//   - the report engine, which groups `date` columns (`orders.date`,
//     `payments.payment_date`, `expenses.expense_date`).
//
// If an order's timestamp lands on one local day and its `date` column on
// another, the dashboard and the reports disagree about today — which is how the
// trend charts rendered empty once before. So every timestamp here is built from
// an intended IST wall-clock reading, and every date string is that same IST
// calendar day. Never `new Date().toISOString().slice(0,10)`: at 02:00 IST that
// returns yesterday.
//
// IST is UTC+5:30 with no daylight saving, so a fixed offset is correct.
// ============================================================

/** Minutes IST runs ahead of UTC. */
const IST_OFFSET_MIN = 330;

/** A calendar day in the Indian timezone. Month is 1-based, as written. */
export interface IstDay {
  y: number;
  m: number;
  d: number;
}

/**
 * The instant at which IST wall-clock reads y-m-d h:min.
 * `istInstant({y:2026,m:10,d:12}, 9, 30)` is 04:00Z on 2026-10-12.
 */
export function istInstant(day: IstDay, hour: number, minute = 0, second = 0): Date {
  return new Date(
    Date.UTC(day.y, day.m - 1, day.d, hour, minute, second) - IST_OFFSET_MIN * 60_000,
  );
}

/** The IST calendar day an instant falls on. */
export function istDayOf(at: Date): IstDay {
  const shifted = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

/** `YYYY-MM-DD` for a `date` column. */
export function ymd(day: IstDay): string {
  return `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}

/** Day of week in IST: 0 = Sunday … 6 = Saturday, matching `holiday_lists.weekly_offs`. */
export function istDow(day: IstDay): number {
  return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
}

/** Shift a day by whole days, rolling months and years correctly. */
export function addDays(day: IstDay, delta: number): IstDay {
  const t = Date.UTC(day.y, day.m - 1, day.d) + delta * 86_400_000;
  const d = new Date(t);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** Every IST day from `from` to `to`, both inclusive. */
export function daysBetween(from: IstDay, to: IstDay): IstDay[] {
  const out: IstDay[] = [];
  const end = Date.UTC(to.y, to.m - 1, to.d);
  let cur = Date.UTC(from.y, from.m - 1, from.d);
  while (cur <= end) {
    const d = new Date(cur);
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
    cur += 86_400_000;
  }
  return out;
}

/** Today, in IST, regardless of where this process is running. */
export function istToday(now: Date = new Date()): IstDay {
  return istDayOf(now);
}

/** Minutes since IST midnight for an instant — used to cut "today" off at the clock. */
export function istMinutesOfDay(at: Date): number {
  const shifted = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** `2026-09` — the monthly bucket key the analytics charts group by. */
export function monthKey(day: IstDay): string {
  return `${day.y}-${String(day.m).padStart(2, "0")}`;
}

/** Whole months from `from` to `to` inclusive, as a count. Used for the growth curve. */
export function monthIndex(from: IstDay, day: IstDay): number {
  return (day.y - from.y) * 12 + (day.m - from.m);
}
