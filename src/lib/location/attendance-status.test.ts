import { describe, it, expect } from "vitest";
import {
  attendanceBadges,
  attendancePrimaryLabel,
  computeAttendanceDay,
  formatWorkedMinutes,
  SHORT_PRESENT_RATIO,
} from "./attendance-status";
import { DEFAULT_TRACKING, type TrackingSettings } from "./tracking-window";

// A fixed local day so the tests don't drift with the machine's timezone. Every helper below
// builds LOCAL dates, matching the code under test (which compares against local shift times).
const DAY = new Date(2026, 7, 8); // 8 Aug 2026
const at = (h: number, m = 0, dayOffset = 0) =>
  new Date(2026, 7, 8 + dayOffset, h, m, 0).toISOString();

const shift = (over: Partial<TrackingSettings> = {}): TrackingSettings => ({
  ...DEFAULT_TRACKING,
  start_time: "09:00",
  end_time: "18:00",
  grace_minutes: 15,
  ...over,
});

const compute = (sessions: { started_at: string; ended_at: string | null }[], over = {}) =>
  computeAttendanceDay({
    sessions,
    day: DAY,
    settings: shift(over),
    nowMs: new Date(2026, 7, 8, 20, 0, 0).getTime(),
  });

describe("computeAttendanceDay — the basic verdicts", () => {
  it("marks a day with no sessions as Absent", () => {
    const d = compute([]);
    expect(d.status).toBe("absent");
    expect(d.flags).toEqual([]);
    expect(d.workedMinutes).toBe(0);
    expect(attendancePrimaryLabel(d)).toBe("Absent");
  });

  it("marks a full shift as Present with no flags", () => {
    const d = compute([{ started_at: at(9, 0), ended_at: at(18, 0) }]);
    expect(d.status).toBe("present");
    expect(d.flags).toEqual([]);
    expect(d.workedMinutes).toBe(9 * 60);
  });
});

describe("computeAttendanceDay — Late Start", () => {
  it("does not flag a punch-in inside the grace period", () => {
    const d = compute([{ started_at: at(9, 15), ended_at: at(18, 0) }]);
    expect(d.flags).not.toContain("late_start");
    expect(d.lateByMinutes).toBe(0);
  });

  it("flags a punch-in past the grace period and reports how late", () => {
    const d = compute([{ started_at: at(10, 0), ended_at: at(18, 0) }]);
    expect(d.flags).toContain("late_start");
    expect(d.lateByMinutes).toBe(45); // 10:00 vs 09:00 + 15min grace
  });

  it("honours a zero grace period", () => {
    const d = compute([{ started_at: at(9, 1), ended_at: at(18, 0) }], { grace_minutes: 0 });
    expect(d.flags).toContain("late_start");
    expect(d.lateByMinutes).toBe(1);
  });

  it("flags regardless of any legacy enabled flag left in stored settings", () => {
    // The on/off switch was removed; shift rules always apply now.
    const d = compute([{ started_at: at(14, 0), ended_at: at(18, 0) }], { enabled: false });
    expect(d.flags).toContain("late_start");
  });
});

describe("computeAttendanceDay — Early Leaving", () => {
  it("does not flag a punch-out inside the grace period", () => {
    const d = compute([{ started_at: at(9, 0), ended_at: at(17, 45) }]);
    expect(d.flags).not.toContain("early_leaving");
  });

  it("flags a punch-out past the grace period and reports how early", () => {
    const d = compute([{ started_at: at(9, 0), ended_at: at(16, 0) }]);
    expect(d.flags).toContain("early_leaving");
    expect(d.leftEarlyByMinutes).toBe(105); // 16:00 vs 18:00 - 15min grace
  });

  it("does not call a rep still on duty an early leaver", () => {
    const d = compute([{ started_at: at(9, 0), ended_at: null }]);
    expect(d.stillOnDuty).toBe(true);
    expect(d.flags).not.toContain("early_leaving");
  });
});

describe("computeAttendanceDay — Short Present", () => {
  it("flags a day worked below the short-present ratio", () => {
    // 09:00 -> 13:00 is 4h of a 9h shift = 44%, well under the threshold.
    const d = compute([{ started_at: at(9, 0), ended_at: at(13, 0) }]);
    expect(d.status).toBe("short_present");
  });

  it("does not flag a day just above the threshold", () => {
    // 75% of 9h = 6h45m. 09:00 -> 15:50 is 6h50m.
    const d = compute([{ started_at: at(9, 0), ended_at: at(15, 50) }]);
    expect(d.status).toBe("present");
    expect(d.workedMinutes).toBeGreaterThan(9 * 60 * SHORT_PRESENT_RATIO);
  });

  it("sums multiple sessions rather than judging on the first alone", () => {
    // Punch out for lunch and back in: 4h + 4h = 8h. Counting only the first would read as short.
    const d = compute([
      { started_at: at(9, 0), ended_at: at(13, 0) },
      { started_at: at(14, 0), ended_at: at(18, 0) },
    ]);
    expect(d.workedMinutes).toBe(8 * 60);
    expect(d.status).toBe("present");
  });

  it("does not judge hours mid-shift", () => {
    const d = compute([{ started_at: at(19, 30), ended_at: null }]);
    expect(d.stillOnDuty).toBe(true);
    expect(d.status).toBe("present");
  });
});

describe("computeAttendanceDay — night shift", () => {
  const night = { start_time: "20:00", end_time: "04:00" };

  it("treats an on-time night shift as Present, not Late", () => {
    // Punch in 20:00 on the 8th, out 04:00 on the 9th.
    const d = computeAttendanceDay({
      sessions: [{ started_at: at(20, 0), ended_at: at(4, 0, 1) }],
      day: DAY,
      settings: shift(night),
      nowMs: new Date(2026, 7, 9, 6, 0, 0).getTime(),
    });
    expect(d.status).toBe("present");
    expect(d.flags).toEqual([]);
    expect(d.workedMinutes).toBe(8 * 60);
  });

  it("still catches a late start on a night shift", () => {
    const d = computeAttendanceDay({
      sessions: [{ started_at: at(22, 0), ended_at: at(4, 0, 1) }],
      day: DAY,
      settings: shift(night),
      nowMs: new Date(2026, 7, 9, 6, 0, 0).getTime(),
    });
    expect(d.flags).toContain("late_start");
    expect(d.lateByMinutes).toBe(105);
  });
});

describe("computeAttendanceDay — combined problems", () => {
  it("reports both Late Start and Early Leaving on the same day", () => {
    const d = compute([{ started_at: at(11, 0), ended_at: at(15, 0) }]);
    expect(d.flags).toEqual(["late_start", "early_leaving"]);
    expect(d.status).toBe("short_present");
  });
});

describe("attendanceBadges", () => {
  it("puts the status first, then each flag", () => {
    const d = compute([{ started_at: at(11, 0), ended_at: at(15, 0) }]);
    expect(attendanceBadges(d).map((b) => b.label)).toEqual([
      "Short Present",
      "Late Start",
      "Early Leaving",
    ]);
  });

  it("shows On Duty instead of a verdict while a session is running", () => {
    const d = compute([{ started_at: at(9, 0), ended_at: null }]);
    expect(attendanceBadges(d)[0].label).toBe("On Duty");
    expect(attendancePrimaryLabel(d)).toBe("On Duty");
  });
});

describe("formatWorkedMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatWorkedMinutes(0)).toBe("-");
    expect(formatWorkedMinutes(45)).toBe("45min");
    expect(formatWorkedMinutes(405)).toBe("6h 45m");
  });
});
