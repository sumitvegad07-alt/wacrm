/**
 * Working days, weekly offs and company holidays.
 *
 * This replaces a Monday–Friday week that was hardcoded inside the attendance page
 * (`getWorkingDays`, which skipped `getDay() === 0 || === 6`). For the six-day companies this
 * product sells to, that understated Total Days by roughly four a month and correspondingly
 * overstated everyone's presence percentage.
 *
 * Pure functions, no data fetching — the same rules are used by the daily view, the monthly
 * summary and the leave form, and they need to be unit-testable.
 *
 * These mirror `account_working_days()` and `leave_eligible_dates()` in
 * `20260817170000_leave_management.sql`. If you change a rule here, change it there too —
 * the database is what actually enforces which dates a leave request may cover.
 */

import type { TrackingSettings } from "./tracking-window";

/**
 * Local `YYYY-MM-DD`.
 *
 * Deliberately NOT `toISOString()`: for anyone east of UTC that shifts a late-evening date into
 * the next day, which would silently mis-key a whole month of leave against attendance. The same
 * trap is already called out on `localDayKey` in the attendance page.
 */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a `YYYY-MM-DD` into a local Date at midnight (no timezone shift). */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Every calendar date from `from` to `to` inclusive. */
export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor.getTime() <= last.getTime()) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export type DayKind = "working" | "weekly_off" | "holiday";

/**
 * What kind of day this is for the company. Holiday wins over weekly off, so a holiday that falls
 * on a Sunday still reads as the weekly off it actually is — checked in that order deliberately:
 * a company that marks Sunday as a holiday should not suddenly show "Holiday" on every Sunday.
 */
export function classifyDay(
  date: Date,
  settings: TrackingSettings,
  holidayKeys: ReadonlySet<string>,
): DayKind {
  if (!settings.working_days.includes(date.getDay())) return "weekly_off";
  if (holidayKeys.has(toDateKey(date))) return "holiday";
  return "working";
}

/** The dates in a range an employee could actually take as leave. Mirrors `leave_eligible_dates`. */
export function eligibleLeaveDates(
  from: Date,
  to: Date,
  settings: TrackingSettings,
  holidayKeys: ReadonlySet<string>,
): Date[] {
  return eachDay(from, to).filter((d) => classifyDay(d, settings, holidayKeys) === "working");
}

export interface MonthWorkingDays {
  /** Working days counted so far — the denominator for presence. */
  workingDays: number;
  /** Company holidays that fell on a day the company would otherwise have worked. */
  holidays: number;
  /** Days that are a weekly off. Shown for context; never counted as absence. */
  weeklyOffs: number;
}

/**
 * Working days in the month containing `month`.
 *
 * For the CURRENT month this counts only up to today — a month is not yet fully worked, and
 * counting its remaining days would make everybody look absent for the rest of it. For a future
 * month the answer is zero, matching the previous behaviour.
 */
export function monthWorkingDays(
  month: Date,
  settings: TrackingSettings,
  holidayKeys: ReadonlySet<string>,
  now: Date = new Date(),
): MonthWorkingDays {
  const empty = { workingDays: 0, holidays: 0, weeklyOffs: 0 };

  const isFuture =
    month.getFullYear() > now.getFullYear() ||
    (month.getFullYear() === now.getFullYear() && month.getMonth() > now.getMonth());
  if (isFuture) return empty;

  const isCurrentMonth =
    month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const lastDay = isCurrentMonth
    ? now.getDate()
    : new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const result = { ...empty };
  for (let i = 1; i <= lastDay; i++) {
    const day = new Date(month.getFullYear(), month.getMonth(), i);
    switch (classifyDay(day, settings, holidayKeys)) {
      case "working":
        result.workingDays++;
        break;
      case "holiday":
        result.holidays++;
        break;
      case "weekly_off":
        result.weeklyOffs++;
        break;
    }
  }
  return result;
}

/** "Mon–Sat" / "Mon, Wed, Fri" / "Every day" — a one-line summary for Settings. */
export function describeWorkingDays(days: readonly number[]): string {
  const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) return "No working days";
  if (sorted.length === 7) return "Every day";

  // Contiguous runs read far better than a list: "Mon–Sat" beats six comma-separated names.
  const runs: number[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((run) =>
      run.length >= 3 ? `${SHORT[run[0]]}–${SHORT[run[run.length - 1]]}` : run.map((d) => SHORT[d]).join(", "),
    )
    .join(", ");
}
