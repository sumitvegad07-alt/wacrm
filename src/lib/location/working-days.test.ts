import { describe, it, expect } from "vitest";
import {
  classifyDay,
  describeWorkingDays,
  eachDay,
  eligibleLeaveDates,
  fromDateKey,
  monthWorkingDays,
  toDateKey,
} from "./working-days";
import { DEFAULT_TRACKING, type TrackingSettings } from "./tracking-window";

// August 2026: the 1st is a Saturday, the 2nd a Sunday. 31 days, five Sundays (2,9,16,23,30).
const AUG = new Date(2026, 7, 1);
const settings = (over: Partial<TrackingSettings> = {}): TrackingSettings => ({
  ...DEFAULT_TRACKING,
  ...over,
});

describe("toDateKey / fromDateKey", () => {
  it("builds a local YYYY-MM-DD, never a UTC-shifted one", () => {
    // 23:30 local on the 17th must key as the 17th. toISOString() would return the 18th for
    // anyone east of UTC, which would mis-file a whole month of leave against attendance.
    expect(toDateKey(new Date(2026, 7, 17, 23, 30))).toBe("2026-08-17");
    expect(toDateKey(new Date(2026, 0, 5, 0, 15))).toBe("2026-01-05");
  });

  it("round-trips", () => {
    const d = fromDateKey("2026-08-17");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(17);
    expect(toDateKey(d)).toBe("2026-08-17");
  });
});

describe("eachDay", () => {
  it("is inclusive at both ends", () => {
    const days = eachDay(new Date(2026, 7, 24), new Date(2026, 7, 26));
    expect(days.map(toDateKey)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26"]);
  });

  it("returns a single day when from equals to", () => {
    expect(eachDay(new Date(2026, 7, 24), new Date(2026, 7, 24))).toHaveLength(1);
  });

  it("returns nothing when the range is inverted", () => {
    expect(eachDay(new Date(2026, 7, 26), new Date(2026, 7, 24))).toEqual([]);
  });

  it("crosses a month boundary", () => {
    const days = eachDay(new Date(2026, 7, 30), new Date(2026, 8, 2));
    expect(days.map(toDateKey)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  });
});

describe("classifyDay", () => {
  const holidays = new Set(["2026-08-26"]);

  it("calls a Sunday a weekly off under the default Mon–Sat week", () => {
    expect(classifyDay(new Date(2026, 7, 30), settings(), holidays)).toBe("weekly_off");
  });

  it("calls a Saturday a working day under Mon–Sat, and an off day under Mon–Fri", () => {
    expect(classifyDay(new Date(2026, 7, 29), settings(), holidays)).toBe("working");
    expect(
      classifyDay(new Date(2026, 7, 29), settings({ working_days: [1, 2, 3, 4, 5] }), holidays),
    ).toBe("weekly_off");
  });

  it("calls a listed date a holiday", () => {
    expect(classifyDay(new Date(2026, 7, 26), settings(), holidays)).toBe("holiday");
  });

  it("lets the weekly off win when a holiday falls on one", () => {
    // Otherwise a company that lists a Sunday holiday would show "Holiday" on a day that was
    // already off — the weekly off is the truthful reason nobody worked.
    const sundayHoliday = new Set(["2026-08-30"]);
    expect(classifyDay(new Date(2026, 7, 30), settings(), sundayHoliday)).toBe("weekly_off");
  });
});

describe("eligibleLeaveDates", () => {
  const holidays = new Set(["2026-08-26"]);

  it("drops weekly offs and holidays from a range", () => {
    // Mon 24 → Sun 30: 26th is a holiday, 30th is a Sunday, leaving five bookable days.
    const dates = eligibleLeaveDates(
      new Date(2026, 7, 24),
      new Date(2026, 7, 30),
      settings(),
      holidays,
    );
    expect(dates.map(toDateKey)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
    ]);
  });

  it("returns nothing for a range made entirely of days off", () => {
    const dates = eligibleLeaveDates(
      new Date(2026, 7, 30),
      new Date(2026, 7, 30),
      settings(),
      holidays,
    );
    expect(dates).toEqual([]);
  });

  it("matches the five-day week when configured that way", () => {
    const dates = eligibleLeaveDates(
      new Date(2026, 7, 28),
      new Date(2026, 7, 31),
      settings({ working_days: [1, 2, 3, 4, 5] }),
      new Set(),
    );
    expect(dates.map(toDateKey)).toEqual(["2026-08-28", "2026-08-31"]); // Fri then Mon
  });
});

describe("monthWorkingDays", () => {
  const AFTER_AUGUST = new Date(2026, 8, 15);

  it("counts a six-day week correctly for a completed month", () => {
    // August 2026 has 31 days and five Sundays.
    const r = monthWorkingDays(AUG, settings(), new Set(), AFTER_AUGUST);
    expect(r.workingDays).toBe(26);
    expect(r.weeklyOffs).toBe(5);
    expect(r.holidays).toBe(0);
  });

  it("counts a five-day week correctly for the same month", () => {
    // This is the difference the hardcoded Mon–Fri week was silently applying: five fewer days.
    const r = monthWorkingDays(AUG, settings({ working_days: [1, 2, 3, 4, 5] }), new Set(), AFTER_AUGUST);
    expect(r.workingDays).toBe(21);
    expect(r.weeklyOffs).toBe(10);
  });

  it("subtracts holidays from the working total", () => {
    const r = monthWorkingDays(AUG, settings(), new Set(["2026-08-26", "2026-08-27"]), AFTER_AUGUST);
    expect(r.workingDays).toBe(24);
    expect(r.holidays).toBe(2);
  });

  it("does not count a holiday that falls on a weekly off", () => {
    const r = monthWorkingDays(AUG, settings(), new Set(["2026-08-30"]), AFTER_AUGUST);
    expect(r.workingDays).toBe(26);
    expect(r.holidays).toBe(0);
    expect(r.weeklyOffs).toBe(5);
  });

  it("counts only up to today in the current month", () => {
    // Counting the rest of the month would make everybody look absent for days not yet worked.
    const r = monthWorkingDays(AUG, settings(), new Set(), new Date(2026, 7, 10));
    expect(r.workingDays).toBe(8); // 1st–10th minus the Sundays on the 2nd and 9th
    expect(r.weeklyOffs).toBe(2);
  });

  it("returns zero for a future month", () => {
    expect(monthWorkingDays(new Date(2026, 11, 1), settings(), new Set(), AFTER_AUGUST)).toEqual({
      workingDays: 0,
      holidays: 0,
      weeklyOffs: 0,
    });
  });
});

describe("describeWorkingDays", () => {
  it("collapses a run into a range", () => {
    expect(describeWorkingDays([1, 2, 3, 4, 5, 6])).toBe("Mon–Sat");
    expect(describeWorkingDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
  });

  it("lists scattered days", () => {
    expect(describeWorkingDays([1, 3, 5])).toBe("Mon, Wed, Fri");
  });

  it("handles the extremes", () => {
    expect(describeWorkingDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(describeWorkingDays([])).toBe("No working days");
    expect(describeWorkingDays([2])).toBe("Tue");
  });
});
