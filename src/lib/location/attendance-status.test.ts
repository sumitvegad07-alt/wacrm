import { describe, it, expect } from "vitest";
import {
  attendanceBadges,
  attendancePrimaryLabel,
  computeAttendanceDay,
  formatWorkedMinutes,
  SHORT_PRESENT_RATIO,
  type AttendanceLeave,
  type AttendanceSession,
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

const compute = (sessions: AttendanceSession[], over = {}) =>
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

describe("computeAttendanceDay — forgotten punch-out", () => {
  // The system closes an abandoned shift at midnight. The DB row then has an end time, but the
  // rep never chose it, so it must not be treated as a punch-out.
  const abandoned = [
    { started_at: at(9, 0), ended_at: at(0, 0, 1), end_reason: "auto_midnight" },
  ];

  it("reports no punch-out rather than a midnight one", () => {
    const d = compute(abandoned);
    expect(d.lastPunchOut).toBeNull();
    expect(d.flags).toContain("missing_punch_out");
  });

  it("does not call it early leaving", () => {
    // Midnight is 6 hours AFTER the 18:00 shift end, but a naive reading of 00:00 as a clock
    // time would make this the most extreme early-leaver in the company.
    expect(compute(abandoned).flags).not.toContain("early_leaving");
  });

  it("does not judge the hours, because they were capped not measured", () => {
    // 09:00 to midnight is 15 hours — but the rep may have stopped work at 11am. Marking the
    // day Present or Short Present off that number would be inventing a fact.
    const short = compute([
      { started_at: at(9, 0), ended_at: at(10, 0), end_reason: "auto_midnight" },
    ]);
    expect(short.status).toBe("present");
    expect(short.flags).toContain("missing_punch_out");
  });

  it("leaves a normal punch-out completely alone", () => {
    const normal = compute([
      { started_at: at(9, 0), ended_at: at(18, 0), end_reason: "manual" },
    ]);
    expect(normal.flags).not.toContain("missing_punch_out");
    expect(normal.lastPunchOut).toBe(at(18, 0));
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

/**
 * Leave, holidays and weekly offs.
 *
 * The regression cases at the end matter as much as the new ones: a day with no leave must
 * classify exactly as it did before this feature existed. That is the guarantee that adding
 * leave did not quietly change every attendance record in the product.
 */
describe("computeAttendanceDay — leave, holidays and weekly offs", () => {
  const withContext = (
    sessions: AttendanceSession[],
    context: { leave?: AttendanceLeave | null; holidayName?: string | null } = {},
    day: Date = DAY,
  ) =>
    computeAttendanceDay({
      sessions,
      day,
      settings: shift(),
      nowMs: new Date(2026, 7, 8, 20, 0, 0).getTime(),
      ...context,
    });

  const SUNDAY = new Date(2026, 7, 9); // 9 Aug 2026, a weekly off under the default Mon–Sat

  describe("a day nobody worked", () => {
    it("reads On Leave instead of Absent when a full day is approved", () => {
      const d = withContext([], { leave: { weightage: "full", typeName: "Casual Leave" } });
      expect(d.status).toBe("on_leave");
      expect(attendancePrimaryLabel(d)).toBe("On Leave");
      expect(attendanceBadges(d).map((b) => b.label)).toEqual(["On Leave", "Casual Leave"]);
    });

    it("stays Absent for a PART-day leave, with the leave shown alongside", () => {
      // Half a day was granted; the other half was still owed and nobody turned up for it.
      // Reading that as "On Leave" would hide a real no-show.
      const d = withContext([], { leave: { weightage: "first_half" } });
      expect(d.status).toBe("absent");
      expect(attendanceBadges(d).map((b) => b.label)).toEqual(["Absent", "First Half Leave"]);
    });

    it("reads Holiday, not Absent", () => {
      const d = withContext([], { holidayName: "Diwali" });
      expect(d.status).toBe("holiday");
      expect(attendanceBadges(d).map((b) => b.label)).toEqual(["Holiday", "Diwali"]);
    });

    it("reads Weekly Off, not Absent", () => {
      const d = withContext([], {}, SUNDAY);
      expect(d.status).toBe("weekly_off");
      expect(attendancePrimaryLabel(d)).toBe("Weekly Off");
    });

    it("lets a holiday win over leave that was approved before it was declared", () => {
      // An admin can add a holiday after leave was already approved. The day is a holiday for
      // everyone; the approved leave record is left untouched rather than silently rewritten.
      const d = withContext([], { leave: { weightage: "full" }, holidayName: "Diwali" });
      expect(d.status).toBe("holiday");
    });
  });

  describe("a day that was worked anyway", () => {
    it("flags Worked on Leave and does not judge the hours", () => {
      const d = withContext([{ started_at: at(10, 0), ended_at: at(12, 0) }], {
        leave: { weightage: "full", typeName: "Sick Leave" },
      });
      expect(d.status).toBe("present");
      expect(d.flags).toContain("worked_on_leave");
      expect(d.flags).not.toContain("late_start");
      expect(d.flags).not.toContain("early_leaving");
    });

    it("does not judge a shift worked on a weekly off", () => {
      const d = withContext([{ started_at: at(11, 0, 1), ended_at: at(13, 0, 1) }], {}, SUNDAY);
      expect(d.status).toBe("present");
      expect(d.flags).toEqual([]);
    });
  });

  describe("part-day leave changes what the employee owed", () => {
    it("first-half leave: arriving at 13:30 is NOT a late start", () => {
      // Shift is 09:00–18:00, so first-half leave moves the expected start to 13:30.
      const d = withContext([{ started_at: at(13, 30), ended_at: at(18, 0) }], {
        leave: { weightage: "first_half" },
      });
      expect(d.flags).not.toContain("late_start");
      expect(d.status).toBe("present");
    });

    it("first-half leave: arriving at 15:00 IS still a late start", () => {
      // The rule shifts the goalposts by exactly half a shift — it does not remove them.
      const d = withContext([{ started_at: at(15, 0), ended_at: at(18, 0) }], {
        leave: { weightage: "first_half" },
      });
      expect(d.flags).toContain("late_start");
      expect(d.lateByMinutes).toBe(75); // 15:00 vs 13:30 + 15min grace
    });

    it("second-half leave: leaving at 13:30 is NOT early leaving", () => {
      const d = withContext([{ started_at: at(9, 0), ended_at: at(13, 30) }], {
        leave: { weightage: "second_half" },
      });
      expect(d.flags).not.toContain("early_leaving");
      expect(d.status).toBe("present");
    });

    it("halves the expected hours, so half a shift is not Short Present", () => {
      const d = withContext([{ started_at: at(9, 0), ended_at: at(13, 30) }], {
        leave: { weightage: "second_half" },
      });
      expect(d.shiftMinutes).toBe(270); // half of a 9-hour shift
      expect(d.workedMinutes).toBe(270);
      expect(d.status).toBe("present");
    });

    it("quarter day: reduces the hours owed and does not judge early leaving", () => {
      // A quarter carries no position — there is no "which quarter" — so guessing when it was
      // taken would be inventing information. The hours still shrink.
      const d = withContext([{ started_at: at(9, 0), ended_at: at(15, 45) }], {
        leave: { weightage: "quarter" },
      });
      expect(d.shiftMinutes).toBe(405); // three quarters of a 9-hour shift
      expect(d.flags).not.toContain("early_leaving");
      expect(d.status).toBe("present");
    });

    it("still catches a half-day leave taker who barely worked the other half", () => {
      const d = withContext([{ started_at: at(13, 30), ended_at: at(15, 0) }], {
        leave: { weightage: "first_half" },
      });
      expect(d.status).toBe("short_present"); // 1h30m against 4h30m owed
    });
  });

  describe("regression — days with no leave classify exactly as before", () => {
    it("no sessions and no context is still Absent", () => {
      expect(withContext([]).status).toBe("absent");
    });

    it("a full shift is still Present with no flags", () => {
      const d = withContext([{ started_at: at(9, 0), ended_at: at(18, 0) }]);
      expect(d.status).toBe("present");
      expect(d.flags).toEqual([]);
      expect(d.shiftMinutes).toBe(540);
    });

    it("a late, early, short day still gets all three verdicts", () => {
      const d = withContext([{ started_at: at(11, 0), ended_at: at(15, 0) }]);
      expect(d.flags).toEqual(["late_start", "early_leaving"]);
      expect(d.status).toBe("short_present");
    });

    it("leave and holiday are null on an ordinary day", () => {
      const d = withContext([{ started_at: at(9, 0), ended_at: at(18, 0) }]);
      expect(d.leave).toBeNull();
      expect(d.holidayName).toBeNull();
    });
  });
});
