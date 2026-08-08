import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRACKING,
  normalizeTrackingSettings,
  isWithinShift,
  shiftBoundsFor,
  hhmmToMinutes,
  formatHHMM,
  type TrackingSettings,
} from "./tracking-window";

const at = (h: number, m = 0) => new Date(2026, 7, 8, h, m, 0);

const shift = (over: Partial<TrackingSettings> = {}): TrackingSettings => ({
  ...DEFAULT_TRACKING,
  ...over,
});

describe("DEFAULT_TRACKING", () => {
  it("defaults the interval to 10 minutes (not 15)", () => {
    expect(DEFAULT_TRACKING.interval_minutes).toBe(10);
  });

  it("ships a grace period so a 09:01 punch-in isn't flagged late", () => {
    expect(DEFAULT_TRACKING.grace_minutes).toBe(15);
  });
});

describe("normalizeTrackingSettings", () => {
  it("fills in defaults for empty/garbage input", () => {
    expect(normalizeTrackingSettings(undefined)).toEqual(DEFAULT_TRACKING);
    expect(normalizeTrackingSettings({ start_time: "nope", interval_minutes: -5 })).toEqual(DEFAULT_TRACKING);
  });

  it("keeps valid values", () => {
    expect(
      normalizeTrackingSettings({
        start_time: "08:15",
        end_time: "19:00",
        interval_minutes: 15,
        grace_minutes: 30,
      }),
    ).toEqual({
      start_time: "08:15",
      end_time: "19:00",
      interval_minutes: 15,
      grace_minutes: 30,
    });
  });

  it("ignores a stored enabled:false — the flag no longer gates anything", () => {
    // Old accounts may still carry it. Shift rules must apply regardless.
    expect(normalizeTrackingSettings({ enabled: false } as never)).toEqual(DEFAULT_TRACKING);
  });

  it("rejects out-of-range times", () => {
    expect(normalizeTrackingSettings({ start_time: "24:00" }).start_time).toBe(DEFAULT_TRACKING.start_time);
    expect(normalizeTrackingSettings({ end_time: "12:60" }).end_time).toBe(DEFAULT_TRACKING.end_time);
  });

  it("keeps a grace of 0 — 'no leeway' is a real choice, not a missing value", () => {
    expect(normalizeTrackingSettings({ grace_minutes: 0 }).grace_minutes).toBe(0);
    expect(normalizeTrackingSettings({ grace_minutes: -5 }).grace_minutes).toBe(
      DEFAULT_TRACKING.grace_minutes,
    );
  });
});

describe("hhmmToMinutes / formatHHMM", () => {
  it("converts correctly", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(hhmmToMinutes("23:59")).toBe(1439);
  });
  it("formats 12-hour clock with correct noon/midnight handling", () => {
    expect(formatHHMM("09:00")).toBe("9:00 AM");
    expect(formatHHMM("00:15")).toBe("12:15 AM");
    expect(formatHHMM("12:00")).toBe("12:00 PM");
    expect(formatHHMM("18:30")).toBe("6:30 PM");
  });
});

describe("isWithinShift", () => {
  const day = shift({ start_time: "09:00", end_time: "18:00" });

  it("is true inside and false outside a normal day shift", () => {
    expect(isWithinShift(day, at(9, 0))).toBe(true);
    expect(isWithinShift(day, at(13, 0))).toBe(true);
    expect(isWithinShift(day, at(18, 0))).toBe(true);
    expect(isWithinShift(day, at(8, 59))).toBe(false);
    expect(isWithinShift(day, at(18, 1))).toBe(false);
    expect(isWithinShift(day, at(3, 0))).toBe(false);
  });

  it("handles a night shift that wraps past midnight", () => {
    const night = shift({ start_time: "20:00", end_time: "04:00" });
    expect(isWithinShift(night, at(21, 0))).toBe(true);
    expect(isWithinShift(night, at(2, 0))).toBe(true);
    expect(isWithinShift(night, at(12, 0))).toBe(false);
  });
});

describe("shiftBoundsFor", () => {
  const day = new Date(2026, 7, 8);

  it("anchors a normal shift to the given day", () => {
    const b = shiftBoundsFor(day, shift({ start_time: "09:00", end_time: "18:00" }));
    expect(new Date(b.startMs).getHours()).toBe(9);
    expect(new Date(b.endMs).getHours()).toBe(18);
    expect(new Date(b.endMs).getDate()).toBe(8);
    expect(b.durationMinutes).toBe(9 * 60);
  });

  it("pushes a night shift's end onto the next calendar day", () => {
    const b = shiftBoundsFor(day, shift({ start_time: "20:00", end_time: "04:00" }));
    expect(new Date(b.startMs).getDate()).toBe(8);
    expect(new Date(b.endMs).getDate()).toBe(9);
    expect(b.durationMinutes).toBe(8 * 60);
  });
});
