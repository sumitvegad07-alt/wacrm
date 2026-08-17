/**
 * Sanity-check the attendance engine against the SHAPES that actually occur in production
 * (taken from the live account on 8–9 Aug 2026): a shift that runs past midnight, and an
 * open session started in the small hours.
 *
 * These are the cases that broke the previous design, so they get a regression test rather
 * than only synthetic ones.
 */

import { describe, it, expect } from "vitest";
import { attendancePrimaryLabel, computeAttendanceDay } from "./attendance-status";
import { DEFAULT_TRACKING } from "./tracking-window";

// Real timings, expressed as local (IST-equivalent) wall-clock times.
const AUG_8 = new Date(2026, 7, 8);
const AUG_9 = new Date(2026, 7, 9);

/**
 * 9 Aug 2026 is a Sunday, which is a weekly off under the default Mon–Sat week — and a shift
 * worked on a non-working day is deliberately not judged against the shift window. These cases
 * are about the night-shift boundary maths, so they run against a seven-day week to keep testing
 * what they were written to test.
 */
const SEVEN_DAY_WEEK = [0, 1, 2, 3, 4, 5, 6];
const local = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo, d, h, mi, 0).toISOString();

describe("attendance against real production sessions", () => {
  it("classifies the 15:49 → 01:22 session on a 09:00–18:00 shift", () => {
    const day = computeAttendanceDay({
      sessions: [
        { started_at: local(2026, 7, 8, 15, 49), ended_at: local(2026, 7, 9, 1, 22) },
      ],
      day: AUG_8,
      settings: DEFAULT_TRACKING, // 09:00–18:00, 15 min grace
      nowMs: new Date(2026, 7, 9, 3, 0, 0).getTime(),
    });

    // Punched in at 15:49 against a 09:00 shift — genuinely a very late start.
    expect(day.flags).toContain("late_start");
    // Worked 9h33m, which is MORE than the 9h shift, so it is not short.
    expect(day.workedMinutes).toBe(573);
    expect(day.status).toBe("present");
    // Finished long after 18:00, so not an early leaver.
    expect(day.flags).not.toContain("early_leaving");
  });

  it("shows the still-open 01:26 session as On Duty rather than judging it", () => {
    const day = computeAttendanceDay({
      sessions: [{ started_at: local(2026, 7, 9, 1, 26), ended_at: null }],
      day: AUG_9,
      settings: { ...DEFAULT_TRACKING, working_days: SEVEN_DAY_WEEK },
      nowMs: new Date(2026, 7, 9, 3, 7, 0).getTime(),
    });

    expect(day.stillOnDuty).toBe(true);
    expect(attendancePrimaryLabel(day)).toBe("On Duty");
    // Started BEFORE 09:00, so not late — an early start is not a violation.
    expect(day.flags).toEqual([]);
    expect(day.workedMinutes).toBe(101);
  });

  it("re-reads that same 01:26 start sensibly once a night shift is configured", () => {
    const nightShift = (start: string) =>
      computeAttendanceDay({
        sessions: [{ started_at: local(2026, 7, 9, 1, 26), ended_at: local(2026, 7, 9, 4, 0) }],
        settings: {
          ...DEFAULT_TRACKING,
          start_time: start,
          end_time: "09:00",
          working_days: SEVEN_DAY_WEEK,
        },
        day: AUG_9,
        nowMs: new Date(2026, 7, 9, 10, 0, 0).getTime(),
      });

    // Against a 01:00 shift, 01:26 is 11 minutes past the 15-minute grace — late, but only just.
    const late = nightShift("01:00");
    expect(late.flags).toContain("late_start");
    expect(late.lateByMinutes).toBe(11);

    // Against a 01:30 shift the same punch-in is early, so nothing is flagged on the start.
    const onTime = nightShift("01:30");
    expect(onTime.flags).not.toContain("late_start");

    // Both left at 04:00 of a shift ending 09:00 — short, and an early finish.
    expect(onTime.flags).toContain("early_leaving");
    expect(onTime.status).toBe("short_present"); // 2h34m against an unusually long shift
  });
});
