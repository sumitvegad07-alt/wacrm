import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateFilterToRange, isDateInFilter } from "./date-filters";

/**
 * `dateFilterToRange` exists so a date filter can be pushed into the query
 * instead of applied to rows the browser already downloaded. It must select
 * exactly the same days `isDateInFilter` does, or moving a screen to
 * server-side filtering would silently change its numbers.
 */

const FIXED_NOW = new Date(2026, 9, 12, 14, 30); // 12 Oct 2026, local time

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("dateFilterToRange", () => {
  it("pins today to a single day", () => {
    expect(dateFilterToRange("today")).toEqual({ gte: "2026-10-12", lte: "2026-10-12" });
  });

  it("pins yesterday to a single day", () => {
    expect(dateFilterToRange("yesterday")).toEqual({ gte: "2026-10-11", lte: "2026-10-11" });
  });

  it("reads last_week as the last 7 days, as the old code did", () => {
    expect(dateFilterToRange("last_week")).toEqual({ gte: "2026-10-05", lte: "2026-10-12" });
  });

  it("covers a whole calendar month", () => {
    expect(dateFilterToRange("current_month")).toEqual({ gte: "2026-10-01", lte: "2026-10-31" });
    expect(dateFilterToRange("previous_month")).toEqual({ gte: "2026-09-01", lte: "2026-09-30" });
  });

  it("covers the calendar quarter and year", () => {
    expect(dateFilterToRange("current_quarter")).toEqual({ gte: "2026-10-01", lte: "2026-12-31" });
    expect(dateFilterToRange("current_year")).toEqual({ gte: "2026-01-01", lte: "2026-12-31" });
  });

  it("passes a custom range through, both ends inclusive", () => {
    expect(dateFilterToRange(["2026-03-02", "2026-03-09"])).toEqual({
      gte: "2026-03-02",
      lte: "2026-03-09",
    });
  });

  it("puts no bound on an open-ended custom range", () => {
    expect(dateFilterToRange(["2026-03-02", ""])).toEqual({ gte: "2026-03-02" });
    expect(dateFilterToRange(["", "2026-03-09"])).toEqual({ lte: "2026-03-09" });
  });

  it("selects everything for an empty or unknown value, like isDateInFilter", () => {
    expect(dateFilterToRange(null)).toEqual({});
    expect(dateFilterToRange("")).toEqual({});
    expect(dateFilterToRange("something_new")).toEqual({});
    expect(isDateInFilter("2026-10-12", "something_new")).toBe(true);
  });

  /**
   * The real guard: for every preset, walk a year of days and check the range
   * admits exactly the days the old row-by-row predicate admitted.
   */
  it.each([
    "today",
    "yesterday",
    "last_week",
    "current_month",
    "previous_month",
    "current_quarter",
    "current_year",
  ])("agrees with isDateInFilter for every day of the year: %s", (preset) => {
    const { gte, lte } = dateFilterToRange(preset);

    for (let offset = -400; offset <= 60; offset++) {
      const day = new Date(FIXED_NOW.getFullYear(), FIXED_NOW.getMonth(), FIXED_NOW.getDate() + offset);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

      const byRange = (!gte || iso >= gte) && (!lte || iso <= lte);
      // isDateInFilter parses "YYYY-MM-DD" as UTC midnight, so compare using a
      // local-midnight Date to keep the two on the same calendar day.
      const byPredicate = isDateInFilter(day, preset);

      expect(byRange, `${preset} disagreed on ${iso}`).toBe(byPredicate);
    }
  });
});
