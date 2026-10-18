/**
 * Day-by-day and month-grid rollups for the User Attendance screen.
 *
 * The screen already classifies one rep's one day (`computeAttendanceDay`). The Days tab and the
 * Monthly tab are two ways of slicing exactly that answer across a range and across people — so
 * nothing here re-decides what Present or Absent means. Every cell and every count comes back out
 * of the same engine the Punch in tab uses, which is the only way the four tabs can be guaranteed
 * never to disagree with one another.
 *
 * Pure functions, no data fetching, so the whole thing is unit-testable without rendering a page.
 *
 * TWO RULES THIS MODULE EXISTS TO HOLD:
 *
 * 1. The working week is never assumed. Weekly offs and holidays come from each employee's own
 *    assigned holiday list and are classified by `classifyDay` in ./working-days. A Monday–Friday
 *    week was hardcoded on this page once before and understated Total Days by about four a month
 *    for the six-day companies this product sells to. A weekly off or a holiday is never absence.
 *
 * 2. Days are bucketed in the ACCOUNT's timezone, never the browser's and never `toISOString()`.
 *    `zonedDayKey` is the JavaScript equivalent of SQL's `AT TIME ZONE`: it asks Intl what the
 *    calendar date was in that zone. `toISOString()` would push an Indian tenant's 23:30 punch-in
 *    into the next day and split one working day across two rows.
 *
 * Known limit, inherited from the rest of the page: the SHIFT window (`shiftBoundsFor`, used to
 * decide Late Start / Early Leaving / Short Present) is still evaluated against the browser's
 * clock, not the account's. Day bucketing — which is what decides Present vs Absent — is in the
 * account's zone here. For the Indian tenants this ships to the two are the same zone. Fixing the
 * shift window means changing `shiftBoundsFor` for every tab at once, not just this one.
 */

import {
  computeAttendanceDay,
  LEAVE_DAY_VALUE,
  type AttendanceDay,
  type AttendanceFlag,
  type AttendanceSession,
  type AttendanceStatus,
  type AttendanceTone,
  type LeaveWeightage,
} from "./attendance-status";
import type { TrackingSettings } from "./tracking-window";
import { classifyDay, eachDay, fromDateKey, toDateKey, type DayKind } from "./working-days";

/* ------------------------------------------------------------------ inputs */

/**
 * One person, with the calendar that applies to THEM.
 *
 * Both ids are carried because they are different columns and swapping them silently returns
 * nothing: `tracking_sessions.user_id` is the auth user id, while `leave_days.employee_id` and
 * the holiday-list assignment key on `profiles.id`.
 */
export interface RollupEmployee {
  /** `profiles.id` — keys leave and the holiday list. */
  profileId: string;
  /** Auth user id — keys tracking sessions. */
  userId: string;
  name: string;
  /** This employee's own working weekdays, 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  /** `YYYY-MM-DD` → holiday name, from the list assigned to this employee. */
  holidays: ReadonlyMap<string, string>;
}

/** A punch session, plus the user it belongs to. */
export interface RollupSession extends AttendanceSession {
  user_id: string;
}

/** One APPROVED leave day. Pending or rejected leave must never be passed in. */
export interface RollupLeaveDay {
  employee_id: string;
  /** `YYYY-MM-DD`, already a calendar date in the database. */
  leave_date: string;
  weightage: LeaveWeightage;
  leave_type_name?: string | null;
}

export interface RollupInput {
  employees: RollupEmployee[];
  sessions: RollupSession[];
  leave: RollupLeaveDay[];
  /** Company shift settings. Only the shift times and grace are read from here. */
  settings: TrackingSettings;
  /** IANA zone from `accounts.settings.timezone`, e.g. "Asia/Kolkata". */
  timezone: string;
  /** First and last calendar date of the range, inclusive, as `YYYY-MM-DD`. */
  fromKey: string;
  toKey: string;
  /** "Now" — injected so tests can pin a month boundary. */
  nowMs?: number;
}

/* ------------------------------------------------------------- day keying */

/**
 * The calendar date `when` falls on, as seen in `timezone`. `YYYY-MM-DD`.
 *
 * This is the whole point of the module's timezone handling: it is `AT TIME ZONE` done in
 * JavaScript. `en-CA` is used only because it is the locale that formats year-month-day in that
 * order. Never replace this with `toISOString().split("T")[0]` — for a tenant east of UTC that
 * moves every evening punch-in onto the following day.
 */
export function zonedDayKey(when: Date | string, timezone: string): string {
  const date = typeof when === "string" ? new Date(when) : when;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Every `YYYY-MM-DD` from `fromKey` to `toKey` inclusive. */
export function dayKeysBetween(fromKey: string, toKey: string): string[] {
  return eachDay(fromDateKey(fromKey), fromDateKey(toKey)).map(toDateKey);
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "2026-08-17" → "17 Aug 2026".
 *
 * Read straight off the key's own digits. Going through a Date to format it is what re-introduces
 * a timezone: `new Date("2026-08-17")` is midnight UTC, which prints as the 16th anywhere west
 * of London.
 */
export function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d} ${MONTH_SHORT[Number(m) - 1]} ${y}`;
}

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-08-17" → "August 2026", for the line that says which month is on screen. */
export function formatMonthKey(dateKey: string): string {
  const [y, m] = dateKey.split("-");
  return `${MONTH_LONG[Number(m) - 1]} ${y}`;
}

/**
 * How a date reads as a column heading in the month grid: "17" over "Mon".
 *
 * Lives here, with the rest of the calendar arithmetic, so the page never has to build a Date of
 * its own — which is how a timezone gets back into a screen that has just had one taken out.
 */
export function dayHeading(dateKey: string): {
  dayOfMonth: number;
  weekdayShort: string;
  weekdayLabel: string;
} {
  const dow = fromDateKey(dateKey).getDay();
  return {
    dayOfMonth: Number(dateKey.slice(8, 10)),
    weekdayShort: WEEKDAY_SHORT[dow],
    weekdayLabel: WEEKDAY_LONG[dow],
  };
}

/* ------------------------------------------------------------- the matrix */

/** What a day was for one person, plus the kind of day it was for them. */
export interface MatrixDay {
  kind: DayKind;
  day: AttendanceDay;
}

/**
 * Everyone's every day in the range, classified once.
 *
 * Both tabs read this rather than each classifying the range again: the Days tab sums it down the
 * columns, the Monthly tab lays it out across the rows.
 */
export interface AttendanceMatrix {
  /** Every calendar date in the range, in order. */
  dayKeys: string[];
  employees: RollupEmployee[];
  /** profileId → dayKey → classification. Future dates are deliberately absent. */
  byEmployee: Map<string, Map<string, MatrixDay>>;
  /**
   * Dates that have not happened yet in the account's timezone.
   *
   * They are left unclassified rather than counted: a month is not worked in advance, and judging
   * its remaining days would show the whole team as absent for the rest of it.
   */
  futureKeys: Set<string>;
  timezone: string;
  /** Shift settings, kept so the row builders can label the range without being passed them again. */
  settings: TrackingSettings;
}

export function buildAttendanceMatrix(input: RollupInput): AttendanceMatrix {
  const { employees, sessions, leave, settings, timezone, fromKey, toKey } = input;
  const nowMs = input.nowMs ?? Date.now();

  const dayKeys = dayKeysBetween(fromKey, toKey);
  const todayKey = zonedDayKey(new Date(nowMs), timezone);
  // String comparison is safe and exact on zero-padded YYYY-MM-DD, and keeps every Date out of it.
  const futureKeys = new Set(dayKeys.filter((k) => k > todayKey));

  // Sessions grouped by the user and the ACCOUNT-LOCAL day they started on. A night shift belongs
  // to the day it began, which is what keeps it on one row instead of two half-rows.
  const sessionsByUserDay = new Map<string, RollupSession[]>();
  for (const s of sessions) {
    const key = `${s.user_id}|${zonedDayKey(s.started_at, timezone)}`;
    const bucket = sessionsByUserDay.get(key);
    if (bucket) bucket.push(s);
    else sessionsByUserDay.set(key, [s]);
  }

  const leaveByKey = new Map<string, { weightage: LeaveWeightage; typeName: string | null }>();
  for (const l of leave) {
    leaveByKey.set(`${l.employee_id}|${l.leave_date}`, {
      weightage: l.weightage,
      typeName: l.leave_type_name ?? null,
    });
  }

  const byEmployee = new Map<string, Map<string, MatrixDay>>();
  for (const emp of employees) {
    const holidayKeys = new Set(emp.holidays.keys());
    const week = { working_days: emp.workingDays };
    const employeeSettings: TrackingSettings = { ...settings, working_days: emp.workingDays };
    const days = new Map<string, MatrixDay>();

    for (const dayKey of dayKeys) {
      if (futureKeys.has(dayKey)) continue;
      const date = fromDateKey(dayKey);
      const kind = classifyDay(date, week, holidayKeys);
      days.set(dayKey, {
        kind,
        day: computeAttendanceDay({
          sessions: sessionsByUserDay.get(`${emp.userId}|${dayKey}`) ?? [],
          day: date,
          settings: employeeSettings,
          workingDays: emp.workingDays,
          leave: leaveByKey.get(`${emp.profileId}|${dayKey}`) ?? null,
          holidayName: emp.holidays.get(dayKey) ?? null,
          nowMs,
        }),
      });
    }
    byEmployee.set(emp.profileId, days);
  }

  return { dayKeys, employees, byEmployee, futureKeys, timezone, settings };
}

/* ----------------------------------------------------------- the Days tab */

export interface DayRollupRow {
  /** `YYYY-MM-DD`, and the row key. */
  dateKey: string;
  /** "Mon" */
  weekdayShort: string;
  /** "Monday" */
  weekdayLabel: string;
  /** How the date reads for the team as a whole — see `teamDayKind`. */
  dayType: DayKind;
  /** "Working Day" / "Weekly Off" / "Holiday" — the plain-English version. */
  dayTypeLabel: string;
  /** Names of any holidays falling on this date, across the filtered employees. */
  holidayNames: string[];
  /** The same names as one string, so the column can be filtered, sorted and exported. */
  holidayLabel: string;
  /** The date has not happened yet in the account's timezone; nothing is counted. */
  isFuture: boolean;
  /** People who were expected in — the date is a working day for them. The presence denominator. */
  expected: number;
  /** People who punched in at all, including anyone who came in on their own day off. */
  present: number;
  /** Of those present, how many started late, left early, or worked well under their hours. */
  lateStart: number;
  earlyLeaving: number;
  shortPresent: number;
  /** People expected in who never punched in and had no full-day leave. Never an off day. */
  absent: number;
  /** People whose whole day was approved leave. */
  onLeave: number;
  /** People who punched in and never punched out — the system closed the day at midnight. */
  missingPunchOut: number;
  /** People for whom the date was a weekly off, and for whom it was a holiday. */
  weeklyOff: number;
  holiday: number;
  /** `present` as a percentage of `expected`. 0 when nobody was expected. */
  presencePct: number;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DAY_KIND_LABEL: Record<DayKind, string> = {
  working: "Working Day",
  weekly_off: "Weekly Off",
  holiday: "Holiday",
};

/** The Days tab's filter choices, so the select can never offer a value no row can hold. */
export const DAY_TYPE_OPTIONS = [
  { label: "Working Day", value: "Working Day" },
  { label: "Weekly Off", value: "Weekly Off" },
  { label: "Holiday", value: "Holiday" },
];

/**
 * What kind of day a date was for the team.
 *
 * Weekly offs and holidays are per employee, so a date can be a working day for the warehouse and
 * a weekly off for the showroom. The row shows one word, and that word is only allowed to say
 * "off" when it was off for EVERYONE — anyone still expected in means it was a working day, which
 * is what an admin scanning the column needs to see.
 */
function teamDayKind(expected: number, holiday: number, fallback: DayKind): DayKind {
  if (expected > 0) return "working";
  if (holiday > 0) return "holiday";
  return fallback;
}

/** One row per calendar date, summed across everyone in the matrix. */
export function buildDayRollup(matrix: AttendanceMatrix): DayRollupRow[] {
  return matrix.dayKeys.map((dateKey) => {
    const date = fromDateKey(dateKey);
    const dow = date.getDay();
    const isFuture = matrix.futureKeys.has(dateKey);

    const row: DayRollupRow = {
      dateKey,
      weekdayShort: WEEKDAY_SHORT[dow],
      weekdayLabel: WEEKDAY_LONG[dow],
      dayType: "working",
      dayTypeLabel: DAY_KIND_LABEL.working,
      holidayNames: [],
      holidayLabel: "",
      isFuture,
      expected: 0,
      present: 0,
      lateStart: 0,
      earlyLeaving: 0,
      shortPresent: 0,
      absent: 0,
      onLeave: 0,
      missingPunchOut: 0,
      weeklyOff: 0,
      holiday: 0,
      presencePct: 0,
    };

    const holidayNames = new Set<string>();
    for (const emp of matrix.employees) {
      const entry = matrix.byEmployee.get(emp.profileId)?.get(dateKey);
      if (!entry) continue;
      const { kind, day } = entry;

      if (kind === "working") row.expected++;
      else if (kind === "weekly_off") row.weeklyOff++;
      else row.holiday++;
      if (day.holidayName) holidayNames.add(day.holidayName);

      // A weekly off or a holiday is never absence — `computeAttendanceDay` already refuses to
      // return "absent" on one, so simply tallying its answer is enough to hold that rule.
      if (day.status === "present" || day.status === "short_present") row.present++;
      if (day.status === "short_present") row.shortPresent++;
      if (day.status === "absent") row.absent++;
      if (day.status === "on_leave") row.onLeave++;
      if (day.flags.includes("late_start")) row.lateStart++;
      if (day.flags.includes("early_leaving")) row.earlyLeaving++;
      if (day.flags.includes("missing_punch_out")) row.missingPunchOut++;
    }

    row.holidayNames = [...holidayNames].sort();
    row.holidayLabel = row.holidayNames.join(", ");
    // With nobody in the filtered set there is no employee calendar to read, so the date falls
    // back to the account's own working week rather than silently reading as a weekly off.
    const fallback = classifyDay(date, matrix.settings, new Set<string>());
    row.dayType = isFuture
      ? fallback
      : teamDayKind(row.expected, row.holiday, matrix.employees.length > 0 ? "weekly_off" : fallback);
    row.dayTypeLabel = DAY_KIND_LABEL[row.dayType];
    row.presencePct = row.expected > 0 ? Math.round((row.present / row.expected) * 100) : 0;
    return row;
  });
}

/* -------------------------------------------------------- the Monthly tab */

/** A grid cell's state. "future" is a date that has not happened yet. */
export type MonthlyCellStatus = AttendanceStatus | "future";

export interface MonthlyCell {
  dateKey: string;
  /** Day of the month, 1–31 — the column heading. */
  dayOfMonth: number;
  status: MonthlyCellStatus;
  flags: AttendanceFlag[];
  /** One letter for the grid, because 31 columns have no room for a word. */
  code: string;
  /** The full reading, for the cell's tooltip and for screen readers. */
  label: string;
  tone: AttendanceTone;
}

export interface MonthlyRow {
  /** `profiles.id` — the row key. */
  profileId: string;
  userId: string;
  name: string;
  cells: MonthlyCell[];
  /** Days this person was expected in over the range. */
  workingDays: number;
  /** Days they punched in, including any day off they chose to work. */
  present: number;
  /** Working days with no punch-in and no full-day leave. */
  absent: number;
  /** Approved leave, as a day value — a half day counts 0.5. */
  leave: number;
  holidays: number;
  weeklyOffs: number;
}

/**
 * Letter, words and colour for each state.
 *
 * One letter per cell is what makes 31 columns fit on a phone. The words are not dropped — they
 * are the cell's `title` and its aria-label — and the page prints the key above the grid, so the
 * letters are never something the reader has to guess at.
 */
const CELL_LOOK: Record<MonthlyCellStatus, { code: string; label: string; tone: AttendanceTone }> = {
  present: { code: "P", label: "Present", tone: "success" },
  short_present: { code: "S", label: "Short Present", tone: "warning" },
  absent: { code: "A", label: "Absent", tone: "destructive" },
  on_leave: { code: "L", label: "On Leave", tone: "info" },
  holiday: { code: "H", label: "Holiday", tone: "neutral" },
  weekly_off: { code: "O", label: "Weekly Off", tone: "neutral" },
  future: { code: "·", label: "Not yet", tone: "neutral" },
};

const FLAG_WORDS: Record<AttendanceFlag, string> = {
  late_start: "Late Start",
  early_leaving: "Early Leaving",
  missing_punch_out: "No Punch Out",
  worked_on_leave: "Worked on Leave",
};

/** The grid's legend, so the page never has to repeat these letters by hand. */
export const MONTHLY_LEGEND: { code: string; label: string; tone: AttendanceTone }[] = [
  CELL_LOOK.present,
  CELL_LOOK.short_present,
  CELL_LOOK.absent,
  CELL_LOOK.on_leave,
  CELL_LOOK.holiday,
  CELL_LOOK.weekly_off,
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One row per person, one cell per date, plus that person's totals for the range. */
export function buildMonthlyGrid(matrix: AttendanceMatrix): MonthlyRow[] {
  return matrix.employees.map((emp) => {
    const days = matrix.byEmployee.get(emp.profileId);
    const row: MonthlyRow = {
      profileId: emp.profileId,
      userId: emp.userId,
      name: emp.name,
      cells: [],
      workingDays: 0,
      present: 0,
      absent: 0,
      leave: 0,
      holidays: 0,
      weeklyOffs: 0,
    };

    for (const dateKey of matrix.dayKeys) {
      const dayOfMonth = Number(dateKey.slice(8, 10));
      const entry = days?.get(dateKey);

      if (!entry) {
        const look = CELL_LOOK.future;
        row.cells.push({ dateKey, dayOfMonth, status: "future", flags: [], ...look });
        continue;
      }

      const { kind, day } = entry;
      const look = CELL_LOOK[day.status];
      const words = [look.label, ...day.flags.map((f) => FLAG_WORDS[f])];
      row.cells.push({
        dateKey,
        dayOfMonth,
        status: day.status,
        flags: day.flags,
        code: look.code,
        label: words.join(" · "),
        tone: look.tone,
      });

      if (kind === "working") row.workingDays++;
      else if (kind === "weekly_off") row.weeklyOffs++;
      else row.holidays++;

      if (day.status === "present" || day.status === "short_present") row.present++;
      if (day.status === "absent") row.absent++;
      // Summed from the leave itself, not from the status, so a half day counts as half rather
      // than as a whole day off — the day it half-covers is still Absent if nobody turned up.
      if (day.leave) row.leave += LEAVE_DAY_VALUE[day.leave.weightage] ?? 0;
    }

    // Half days sum in 0.5 steps, and raw float arithmetic would otherwise print 2.4499999999 in
    // an attendance record.
    row.leave = round2(row.leave);
    return row;
  });
}
