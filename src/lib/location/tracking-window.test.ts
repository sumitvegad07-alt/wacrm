import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRACKING,
  normalizeTrackingSettings,
  isWithinTrackingWindow,
  hhmmToMinutes,
  formatHHMM,
  type TrackingSettings,
} from "./tracking-window";

const at = (h: number, m = 0) => new Date(2026, 7, 8, h, m, 0);

describe("DEFAULT_TRACKING", () => {
  it("defaults the interval to 10 minutes (not 15)", () => {
    expect(DEFAULT_TRACKING.interval_minutes).toBe(10);
  });
});

describe("normalizeTrackingSettings", () => {
  it("fills in defaults for empty/garbage input", () => {
    expect(normalizeTrackingSettings(undefined)).toEqual(DEFAULT_TRACKING);
    expect(normalizeTrackingSettings({ start_time: "nope", interval_minutes: -5 })).toEqual(DEFAULT_TRACKING);
  });

  it("keeps valid values", () => {
    expect(
      normalizeTrackingSettings({ enabled: true, start_time: "08:15", end_time: "19:00", interval_minutes: 15 }),
    ).toEqual({ enabled: true, start_time: "08:15", end_time: "19:00", interval_minutes: 15 });
  });

  it("rejects out-of-range times", () => {
    expect(normalizeTrackingSettings({ start_time: "24:00" }).start_time).toBe(DEFAULT_TRACKING.start_time);
    expect(normalizeTrackingSettings({ end_time: "12:60" }).end_time).toBe(DEFAULT_TRACKING.end_time);
  });

  it("treats enabled as true unless explicitly false", () => {
    expect(normalizeTrackingSettings({}).enabled).toBe(true);
    expect(normalizeTrackingSettings({ enabled: false }).enabled).toBe(false);
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

describe("isWithinTrackingWindow", () => {
  const day: TrackingSettings = { enabled: true, start_time: "09:00", end_time: "18:00", interval_minutes: 10 };

  it("is true inside and false outside a normal day window", () => {
    expect(isWithinTrackingWindow(day, at(9, 0))).toBe(true);
    expect(isWithinTrackingWindow(day, at(13, 0))).toBe(true);
    expect(isWithinTrackingWindow(day, at(18, 0))).toBe(true);
    expect(isWithinTrackingWindow(day, at(8, 59))).toBe(false);
    expect(isWithinTrackingWindow(day, at(18, 1))).toBe(false);
    expect(isWithinTrackingWindow(day, at(3, 0))).toBe(false);
  });

  it("is always false when disabled", () => {
    expect(isWithinTrackingWindow({ ...day, enabled: false }, at(13, 0))).toBe(false);
  });

  it("handles a night shift that wraps past midnight", () => {
    const night: TrackingSettings = { enabled: true, start_time: "20:00", end_time: "04:00", interval_minutes: 10 };
    expect(isWithinTrackingWindow(night, at(21, 0))).toBe(true);
    expect(isWithinTrackingWindow(night, at(2, 0))).toBe(true);
    expect(isWithinTrackingWindow(night, at(12, 0))).toBe(false);
  });
});
