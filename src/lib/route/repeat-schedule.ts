/**
 * Which dates an "Apply Repeat Schedule" click should create, for one month.
 *
 * Pulled out of the Route tab so the arithmetic can be tested without rendering a
 * calendar — every bug this has ever had was arithmetic, not markup.
 *
 * Two founder decisions (2026-11-02) shape it:
 *
 *   * "Every 15 Days" became "Every 14 Days". Fifteen days is not a beat interval —
 *     it drifts against the week, so the same customer gets a Monday one round and a
 *     Tuesday the next. Fourteen is two whole weeks and lands on the same weekday
 *     every time, which is how a fortnightly beat is actually run.
 *
 *   * A Custom option, in all three shapes he asked for: pick weekdays, every N days,
 *     or pick dates in the month.
 */

export type RepeatFrequency =
  | 'daily'
  | 'weekly'
  | '10_days'
  | '14_days'
  | 'monthly'
  | 'custom';

export type CustomRepeatMode = 'weekdays' | 'interval' | 'month_dates';

export interface CustomRepeat {
  mode: CustomRepeatMode;
  /** ISO weekday numbers, Monday = 1 … Sunday = 7. Used by mode 'weekdays'. */
  weekdays: number[];
  /** Days between visits, used by mode 'interval'. Clamped to 1…60. */
  intervalDays: number;
  /** Days of the month, 1…31. Used by mode 'month_dates'. */
  monthDates: number[];
}

export const DEFAULT_CUSTOM_REPEAT: CustomRepeat = {
  mode: 'weekdays',
  weekdays: [],
  intervalDays: 21,
  monthDates: [],
};

/** Monday = 1 … Sunday = 7, which is what route_plan_assignments.day_of_week stores. */
export function isoDayOfWeek(year: number, month: number, day: number): number {
  const dow = new Date(year, month, day).getDay();
  return dow === 0 ? 7 : dow;
}

export function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const FIXED_STEPS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  '10_days': 10,
  '14_days': 14,
};

/**
 * The dates to schedule, in order, for the month `year`/`month` (month is 0-based,
 * matching `Date`).
 *
 * Never looks before `startDateStr`: scheduling a route into a day that has already
 * passed creates an assignment nobody can run. That applies to picked dates too — tick
 * the 1st on the 20th and the 1st is simply not created, which the caller shows as a
 * count so it is visible rather than silent.
 */
export function generateRepeatDates(
  startDateStr: string,
  freq: RepeatFrequency,
  year: number,
  month: number,
  custom: CustomRepeat = DEFAULT_CUSTOM_REPEAT,
): string[] {
  const start = new Date(startDateStr);
  if (Number.isNaN(start.getTime())) return [];

  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  // The start date may sit in another month than the one on screen. Scheduling runs
  // from the 1st in that case, not from a day number borrowed from a different month.
  const startsThisMonth = start.getFullYear() === year && start.getMonth() === month;
  const startsBeforeThisMonth =
    start.getFullYear() < year || (start.getFullYear() === year && start.getMonth() < month);
  if (!startsThisMonth && !startsBeforeThisMonth) return [];
  const firstDay = startsThisMonth ? start.getDate() : 1;

  if (freq === 'monthly') return startsThisMonth ? [startDateStr] : [];

  const fixedStep = FIXED_STEPS[freq];
  if (fixedStep) {
    const out: string[] = [];
    for (let day = firstDay; day <= lastDayOfMonth; day += fixedStep) {
      out.push(formatDateStr(year, month, day));
    }
    return out;
  }

  // ── custom ──
  if (custom.mode === 'interval') {
    const step = Math.min(60, Math.max(1, Math.floor(custom.intervalDays) || 1));
    const out: string[] = [];
    for (let day = firstDay; day <= lastDayOfMonth; day += step) {
      out.push(formatDateStr(year, month, day));
    }
    return out;
  }

  if (custom.mode === 'weekdays') {
    const want = new Set(custom.weekdays);
    if (want.size === 0) return [];
    const out: string[] = [];
    for (let day = firstDay; day <= lastDayOfMonth; day++) {
      if (want.has(isoDayOfWeek(year, month, day))) out.push(formatDateStr(year, month, day));
    }
    return out;
  }

  // 'month_dates'
  const picked = [...new Set(custom.monthDates)]
    .filter((d) => Number.isInteger(d) && d >= firstDay && d <= lastDayOfMonth)
    .sort((a, b) => a - b);
  return picked.map((d) => formatDateStr(year, month, d));
}

/** What the button should say it is about to do, e.g. "3 dates in November 2026". */
export function describeRepeat(dates: string[], year: number, month: number): string {
  const monthLabel = new Date(year, month, 1).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
  if (dates.length === 0) return `Nothing to schedule in ${monthLabel}`;
  return `${dates.length} date${dates.length === 1 ? '' : 's'} in ${monthLabel}`;
}
