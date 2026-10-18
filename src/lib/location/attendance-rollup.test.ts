import { describe, it, expect } from "vitest";
import {
  buildAttendanceMatrix,
  buildDayRollup,
  buildMonthlyGrid,
  dayHeading,
  dayKeysBetween,
  formatDateKey,
  formatMonthKey,
  zonedDayKey,
  type RollupEmployee,
  type RollupInput,
  type RollupLeaveDay,
  type RollupSession,
} from "./attendance-rollup";
import { DEFAULT_TRACKING, type TrackingSettings } from "./tracking-window";

/**
 * August 2026. The 1st is a Saturday and the 2nd a Sunday; there are five Sundays (2, 9, 16, 23,
 * 30). The default week is Mon–Sat, so every Sunday is a weekly off.
 */
const IST = "Asia/Kolkata";

/**
 * An instant written as IST wall-clock time.
 *
 * Built as an explicit UTC offset rather than from a local Date, so these fixtures mean the same
 * thing on a developer's machine in Mumbai and on a CI runner in UTC. India has never observed
 * daylight saving, so the +05:30 offset is a constant.
 */
const ist = (day: number, hour: number, minute = 0, month = 8): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `2026-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+05:30`;
};

/**
 * The machine's own zone.
 *
 * Used by the few tests that assert on Late Start / Short Present, because those compare against
 * the shift window, which `shiftBoundsFor` still reads off the local clock (see the module
 * header). Passing the machine's zone makes day bucketing and the shift window agree, which is
 * the real situation for an Indian tenant on an Indian machine — and keeps the test honest on a
 * UTC CI box instead of accidentally asserting a 5½-hour shift error.
 */
const MACHINE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** A local wall-clock instant, for use with MACHINE_TZ. */
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 7, day, hour, minute, 0).toISOString();

const settings = (over: Partial<TrackingSettings> = {}): TrackingSettings => ({
  ...DEFAULT_TRACKING,
  start_time: "10:00",
  end_time: "19:00",
  grace_minutes: 15,
  ...over,
});

const employee = (over: Partial<RollupEmployee> = {}): RollupEmployee => ({
  profileId: "p1",
  userId: "u1",
  name: "Ravi",
  workingDays: [1, 2, 3, 4, 5, 6], // Mon–Sat
  holidays: new Map(),
  ...over,
});

/** Mid-September 2026, so the whole of August is in the past and nothing is a "future" day. */
const AFTER_AUGUST = new Date("2026-09-15T12:00:00+05:30").getTime();

const input = (over: Partial<RollupInput> = {}): RollupInput => ({
  employees: [employee()],
  sessions: [],
  leave: [],
  settings: settings(),
  timezone: IST,
  fromKey: "2026-08-01",
  toKey: "2026-08-31",
  nowMs: AFTER_AUGUST,
  ...over,
});

const matrix = (over: Partial<RollupInput> = {}) => buildAttendanceMatrix(input(over));
const days = (over: Partial<RollupInput> = {}) => buildDayRollup(matrix(over));
const grid = (over: Partial<RollupInput> = {}) => buildMonthlyGrid(matrix(over));
const dayRow = (rows: ReturnType<typeof days>, key: string) => rows.find((r) => r.dateKey === key)!;
const cell = (row: ReturnType<typeof grid>[number], key: string) =>
  row.cells.find((c) => c.dateKey === key)!;

/* ------------------------------------------------------------------------ */

describe("zonedDayKey", () => {
  it("buckets by the account's zone, not by UTC", () => {
    // 2026-08-31 18:30 UTC is already 1 September in India. toISOString() would file it under
    // 31 August and put an Indian tenant's day on the wrong row.
    const instant = "2026-08-31T18:30:00.000Z";
    expect(instant.slice(0, 10)).toBe("2026-08-31");
    expect(zonedDayKey(instant, IST)).toBe("2026-09-01");
    expect(zonedDayKey(instant, "UTC")).toBe("2026-08-31");
  });

  it("keeps a late-evening IST punch-in on its own day", () => {
    expect(zonedDayKey(ist(17, 23, 30), IST)).toBe("2026-08-17");
  });
});

describe("labels read off the key's own digits", () => {
  it("formats a date without going through a Date", () => {
    // `new Date("2026-08-17")` is midnight UTC, which prints as the 16th anywhere west of
    // London. Reading the digits cannot drift.
    expect(formatDateKey("2026-08-17")).toBe("17 Aug 2026");
    expect(formatDateKey("2026-01-01")).toBe("01 Jan 2026");
    expect(formatDateKey("2026-12-31")).toBe("31 Dec 2026");
  });

  it("names the month", () => {
    expect(formatMonthKey("2026-08-01")).toBe("August 2026");
    expect(formatMonthKey("2027-02-28")).toBe("February 2027");
  });

  it("heads a grid column with the date and its weekday", () => {
    expect(dayHeading("2026-08-02")).toEqual({
      dayOfMonth: 2,
      weekdayShort: "Sun",
      weekdayLabel: "Sunday",
    });
    expect(dayHeading("2026-08-31").dayOfMonth).toBe(31);
    expect(dayHeading("2026-08-31").weekdayShort).toBe("Mon");
  });
});

describe("dayKeysBetween", () => {
  it("covers the range inclusively", () => {
    expect(dayKeysBetween("2026-08-01", "2026-08-31")).toHaveLength(31);
    expect(dayKeysBetween("2026-08-30", "2026-09-02")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });
});

/* ------------------------------------------------------------------------ */

describe("a weekly off is never absence", () => {
  it("counts Sunday as a weekly off for everyone and marks the date Weekly Off", () => {
    const row = dayRow(days(), "2026-08-02"); // Sunday
    expect(row.weekdayLabel).toBe("Sunday");
    expect(row.dayType).toBe("weekly_off");
    expect(row.dayTypeLabel).toBe("Weekly Off");
    expect(row.expected).toBe(0);
    expect(row.weeklyOff).toBe(1);
    expect(row.absent).toBe(0);
    expect(row.presencePct).toBe(0);
    expect(row.holidayLabel).toBe("");
  });

  it("shows it as O in the month grid and keeps it out of the working-day total", () => {
    const row = grid()[0];
    expect(cell(row, "2026-08-02").status).toBe("weekly_off");
    expect(cell(row, "2026-08-02").code).toBe("O");
    // 31 days in August, five of them Sundays.
    expect(row.weeklyOffs).toBe(5);
    expect(row.workingDays).toBe(26);
    expect(row.absent).toBe(26); // nobody punched in all month
  });

  it("still reads the date as a working day when it is off for only part of the team", () => {
    // A Sunday-working warehouse hand alongside a Mon–Sat rep: the date is a working day for the
    // team, because somebody was expected in.
    const rows = days({
      employees: [
        employee(),
        employee({ profileId: "p2", userId: "u2", name: "Asha", workingDays: [0, 1, 2, 3, 4, 5] }),
      ],
    });
    const sunday = dayRow(rows, "2026-08-02");
    expect(sunday.dayType).toBe("working");
    expect(sunday.expected).toBe(1);
    expect(sunday.weeklyOff).toBe(1);
    expect(sunday.absent).toBe(1); // only the person who was expected in
  });

  it("does not assume a Monday–Friday week", () => {
    // Saturday 8 August. Under the Mon–Sat default this is a working day; a hardcoded Mon–Fri
    // week would call it a weekly off and quietly drop four working days a month.
    expect(dayRow(days(), "2026-08-08").dayType).toBe("working");
    expect(dayRow(days(), "2026-08-08").expected).toBe(1);
    // And a company that really does work Mon–Fri gets its Saturdays back as weekly offs.
    const monFri = days({ employees: [employee({ workingDays: [1, 2, 3, 4, 5] })] });
    expect(dayRow(monFri, "2026-08-08").dayType).toBe("weekly_off");
  });
});

describe("a holiday is never absence", () => {
  const withHoliday = {
    employees: [
      employee({ holidays: new Map([["2026-08-15", "Independence Day"]]) }),
    ],
  };

  it("counts the holiday and names it on the day row", () => {
    const row = dayRow(days(withHoliday), "2026-08-15"); // a Saturday, otherwise a working day
    expect(row.dayType).toBe("holiday");
    expect(row.dayTypeLabel).toBe("Holiday");
    expect(row.holidayNames).toEqual(["Independence Day"]);
    expect(row.holidayLabel).toBe("Independence Day");
    expect(row.holiday).toBe(1);
    expect(row.expected).toBe(0);
    expect(row.absent).toBe(0);
  });

  it("shows it as H in the month grid and takes it out of the working days", () => {
    const row = grid(withHoliday)[0];
    expect(cell(row, "2026-08-15").status).toBe("holiday");
    expect(cell(row, "2026-08-15").code).toBe("H");
    expect(row.holidays).toBe(1);
    expect(row.workingDays).toBe(25); // 26 working days, less the holiday
    expect(row.absent).toBe(25);
  });

  it("applies each employee's own holiday list, not one list for the company", () => {
    const rows = days({
      employees: [
        employee({ holidays: new Map([["2026-08-15", "Independence Day"]]) }),
        employee({ profileId: "p2", userId: "u2", name: "Asha" }),
      ],
    });
    const row = dayRow(rows, "2026-08-15");
    expect(row.holiday).toBe(1);
    expect(row.expected).toBe(1);
    expect(row.dayType).toBe("working");
    expect(row.absent).toBe(1); // only the person without the holiday
  });
});

describe("approved leave", () => {
  const leave = (over: Partial<RollupLeaveDay> = {}): RollupLeaveDay => ({
    employee_id: "p1",
    leave_date: "2026-08-10", // a Monday
    weightage: "full",
    leave_type_name: "Casual Leave",
    ...over,
  });

  it("reads a full day off as On Leave, not Absent", () => {
    const row = dayRow(days({ leave: [leave()] }), "2026-08-10");
    expect(row.onLeave).toBe(1);
    expect(row.absent).toBe(0);
    expect(row.expected).toBe(1); // it is still a day they owed; it was just granted
  });

  it("counts a half day as half a day of leave, and still shows the no-show as Absent", () => {
    // Approved first-half leave, and the employee never came in for the second half either. The
    // half they still owed is a real no-show, so the day stays Absent with the leave alongside it.
    const m = matrix({ leave: [leave({ weightage: "first_half" })] });
    const row = dayRow(buildDayRollup(m), "2026-08-10");
    expect(row.absent).toBe(1);
    expect(row.onLeave).toBe(0);

    const gridRow = buildMonthlyGrid(m)[0];
    expect(cell(gridRow, "2026-08-10").status).toBe("absent");
    expect(gridRow.leave).toBe(0.5);
  });

  it("sums half days without floating-point noise", () => {
    const row = grid({
      leave: [
        leave({ leave_date: "2026-08-10", weightage: "first_half" }),
        leave({ leave_date: "2026-08-11", weightage: "second_half" }),
        leave({ leave_date: "2026-08-12", weightage: "quarter" }),
        leave({ leave_date: "2026-08-13", weightage: "full" }),
      ],
    })[0];
    expect(row.leave).toBe(2.25);
  });

  it("keys leave on profiles.id, which is not the session's user id", () => {
    // Passing the auth user id by mistake must find nothing rather than silently excusing a day.
    const row = dayRow(days({ leave: [leave({ employee_id: "u1" })] }), "2026-08-10");
    expect(row.onLeave).toBe(0);
    expect(row.absent).toBe(1);
  });
});

describe("an absent day", () => {
  it("is a working day with no punch-in and no leave", () => {
    const row = dayRow(days(), "2026-08-10"); // Monday
    expect(row.dayType).toBe("working");
    expect(row.expected).toBe(1);
    expect(row.present).toBe(0);
    expect(row.absent).toBe(1);
    expect(row.presencePct).toBe(0);
  });

  it("turns into Present once there is a session, and the percentage follows", () => {
    const rows = days({
      employees: [employee(), employee({ profileId: "p2", userId: "u2", name: "Asha" })],
      sessions: [{ user_id: "u1", started_at: ist(10, 10), ended_at: ist(10, 19) }],
    });
    const row = dayRow(rows, "2026-08-10");
    expect(row.expected).toBe(2);
    expect(row.present).toBe(1);
    expect(row.absent).toBe(1);
    expect(row.presencePct).toBe(50);
  });

  it("marks the grid cell A and counts it in the row total", () => {
    const row = grid({
      sessions: [{ user_id: "u1", started_at: ist(10, 10), ended_at: ist(10, 19) }],
    })[0];
    expect(cell(row, "2026-08-10").status).not.toBe("absent");
    expect(cell(row, "2026-08-11").code).toBe("A");
    expect(row.present).toBe(1);
    expect(row.absent).toBe(25);
    expect(row.present + row.absent).toBe(row.workingDays);
  });
});

describe("a month boundary in IST", () => {
  // 1 September 00:00 IST is 31 August 18:30 UTC. Both of these punch-ins are on 1 September for
  // an Indian tenant, and both would be filed under 31 August by toISOString().
  const sessions: RollupSession[] = [
    { user_id: "u1", started_at: "2026-08-31T18:30:00.000Z", ended_at: "2026-08-31T20:00:00.000Z" },
    { user_id: "u1", started_at: ist(1, 10, 0, 9), ended_at: ist(1, 19, 0, 9) },
  ];

  it("keeps September out of the August range", () => {
    const rows = days({ sessions });
    expect(rows).toHaveLength(31);
    expect(rows[rows.length - 1].dateKey).toBe("2026-08-31");
    // 31 August is a Monday — a working day the rep never actually worked.
    expect(dayRow(rows, "2026-08-31").present).toBe(0);
    expect(dayRow(rows, "2026-08-31").absent).toBe(1);
  });

  it("puts both of them on 1 September when September is the range", () => {
    const rows = days({ sessions, fromKey: "2026-09-01", toKey: "2026-09-30" });
    expect(dayRow(rows, "2026-09-01").present).toBe(1);
    expect(dayRow(rows, "2026-09-01").absent).toBe(0);
  });

  it("keeps a 23:30 IST punch-in on the day it started", () => {
    const rows = days({
      sessions: [{ user_id: "u1", started_at: ist(31, 23, 30), ended_at: ist(1, 2, 0, 9) }],
    });
    expect(dayRow(rows, "2026-08-31").present).toBe(1);
  });

  it("files the same instants differently for a UTC tenant", () => {
    const rows = days({ sessions, timezone: "UTC" });
    // Read in UTC, the first punch-in is still 31 August.
    expect(dayRow(rows, "2026-08-31").present).toBe(1);
  });
});

describe("days that have not happened yet", () => {
  // "Now" is 10 August 2026. The rest of the month is not worked in advance.
  const NOW = new Date("2026-08-10T12:00:00+05:30").getTime();

  it("is left unjudged rather than counted as absence", () => {
    const rows = days({ nowMs: NOW });
    const future = dayRow(rows, "2026-08-11");
    expect(future.isFuture).toBe(true);
    expect(future.absent).toBe(0);
    expect(future.expected).toBe(0);
    // Today itself is still judged — the admin opens this page to see who is missing today.
    expect(dayRow(rows, "2026-08-10").isFuture).toBe(false);
    expect(dayRow(rows, "2026-08-10").absent).toBe(1);
  });

  it("still labels a future date so the calendar reads straight through", () => {
    const rows = days({ nowMs: NOW });
    expect(dayRow(rows, "2026-08-11").dayType).toBe("working");
    expect(dayRow(rows, "2026-08-16").dayType).toBe("weekly_off"); // a Sunday
  });

  it("shows a dot in the grid and leaves it out of every total", () => {
    const row = grid({ nowMs: NOW })[0];
    expect(cell(row, "2026-08-11").status).toBe("future");
    expect(cell(row, "2026-08-11").code).toBe("·");
    expect(row.cells).toHaveLength(31);
    // 1–10 August: eight working days (Mon–Sat), two Sundays.
    expect(row.workingDays).toBe(8);
    expect(row.weeklyOffs).toBe(2);
    expect(row.absent).toBe(8);
  });

  it("decides what is future in the account's zone", () => {
    // 31 August 20:00 UTC is already 1 September in India, so September 1st is "today" there and
    // gets judged, while a UTC tenant still has it in the future.
    const at = new Date("2026-08-31T20:00:00.000Z").getTime();
    const opts = { fromKey: "2026-09-01", toKey: "2026-09-02", nowMs: at };
    expect(dayRow(days({ ...opts }), "2026-09-01").isFuture).toBe(false);
    expect(dayRow(days({ ...opts, timezone: "UTC" }), "2026-09-01").isFuture).toBe(true);
  });
});

describe("flags roll up alongside the verdicts", () => {
  // These compare against the shift window, which is read off the local clock — so the fixtures
  // are local instants and the account's zone is the machine's own. See the module header.
  const run = (sessions: RollupSession[]) =>
    days({
      timezone: MACHINE_TZ,
      sessions,
      fromKey: "2026-08-10",
      toKey: "2026-08-10",
      employees: [employee(), employee({ profileId: "p2", userId: "u2", name: "Asha" })],
    });

  it("counts Late Start and Early Leaving without hiding the Present", () => {
    const row = run([
      { user_id: "u1", started_at: local(10, 11, 0), ended_at: local(10, 19, 0) }, // an hour late
      { user_id: "u2", started_at: local(10, 10, 0), ended_at: local(10, 16, 0) }, // three early
    ])[0];
    expect(row.present).toBe(2);
    expect(row.lateStart).toBe(1);
    expect(row.earlyLeaving).toBe(1);
    expect(row.absent).toBe(0);
    expect(row.presencePct).toBe(100);
  });

  it("counts Short Present as present and as short", () => {
    // Two hours of a nine-hour shift is well under the 75% threshold.
    const row = run([
      { user_id: "u1", started_at: local(10, 10, 0), ended_at: local(10, 12, 0) },
    ])[0];
    expect(row.present).toBe(1);
    expect(row.shortPresent).toBe(1);
    expect(row.absent).toBe(1); // Asha, who never came in
  });

  it("counts a day the system closed at midnight as No Punch Out", () => {
    const row = run([
      {
        user_id: "u1",
        started_at: local(10, 10, 0),
        ended_at: local(11, 0, 0),
        end_reason: "auto_midnight",
      },
    ])[0];
    expect(row.missingPunchOut).toBe(1);
    expect(row.present).toBe(1);
  });

  it("sums several sessions in a day as one present day", () => {
    const row = run([
      { user_id: "u1", started_at: local(10, 10, 0), ended_at: local(10, 13, 0) },
      { user_id: "u1", started_at: local(10, 14, 0), ended_at: local(10, 19, 0) },
    ])[0];
    expect(row.present).toBe(1);
    expect(row.shortPresent).toBe(0);
  });

  it("carries the flags into the grid cell's label", () => {
    const row = buildMonthlyGrid(
      buildAttendanceMatrix(
        input({
          timezone: MACHINE_TZ,
          fromKey: "2026-08-10",
          toKey: "2026-08-10",
          sessions: [{ user_id: "u1", started_at: local(10, 11, 0), ended_at: local(10, 19, 0) }],
        }),
      ),
    )[0];
    expect(row.cells[0].label).toBe("Present · Late Start");
    expect(row.cells[0].code).toBe("P");
  });
});

describe("edge cases", () => {
  it("returns a row per date even with nobody in the filtered set", () => {
    const rows = days({ employees: [] });
    expect(rows).toHaveLength(31);
    // With no employee calendar to read, the date falls back to the account's own working week
    // rather than silently reading as everyone's day off.
    expect(dayRow(rows, "2026-08-10").dayType).toBe("working");
    expect(dayRow(rows, "2026-08-02").dayType).toBe("weekly_off");
    expect(dayRow(rows, "2026-08-10").expected).toBe(0);
    expect(dayRow(rows, "2026-08-10").presencePct).toBe(0);
  });

  it("ignores a session belonging to somebody outside the filtered set", () => {
    const row = dayRow(
      days({ sessions: [{ user_id: "someone-else", started_at: ist(10, 10), ended_at: ist(10, 19) }] }),
      "2026-08-10",
    );
    expect(row.present).toBe(0);
    expect(row.absent).toBe(1);
  });

  it("handles a single-day range", () => {
    const rows = days({ fromKey: "2026-08-10", toKey: "2026-08-10" });
    expect(rows).toHaveLength(1);
    expect(rows[0].dateKey).toBe("2026-08-10");
  });

  it("numbers the grid cells by day of the month", () => {
    const row = grid()[0];
    expect(row.cells[0].dayOfMonth).toBe(1);
    expect(row.cells[30].dayOfMonth).toBe(31);
  });
});
