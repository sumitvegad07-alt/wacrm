import { describe, expect, test } from "vitest";
import { DEFAULT_PERIOD, matchesPeriod } from "./period-filter";

const TODAY = new Date();
const iso = (d: Date) => d.toISOString().split("T")[0];
const shift = (days: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return iso(d);
};

describe("matchesPeriod", () => {
  test("All keeps everything, dated or not", () => {
    expect(matchesPeriod(shift(-30), "All")).toBe(true);
    expect(matchesPeriod(null, "All")).toBe(true);
  });

  test("Today keeps today", () => {
    expect(matchesPeriod(shift(0), "Today")).toBe(true);
  });

  // The whole point of the change: an unscheduled task is not a future
  // task, and it must not vanish from the screen named after today.
  test("Today also keeps tasks with no due date", () => {
    expect(matchesPeriod(null, "Today")).toBe(true);
    expect(matchesPeriod(undefined, "Today")).toBe(true);
  });

  test("Today drops other days", () => {
    expect(matchesPeriod(shift(-1), "Today")).toBe(false);
    expect(matchesPeriod(shift(1), "Today")).toBe(false);
  });

  // Picking a range by hand means naming dates on purpose, so undated
  // tasks stay out of it.
  test("a hand-picked period still drops undated tasks", () => {
    expect(matchesPeriod(null, "Tomorrow")).toBe(false);
    expect(matchesPeriod(null, "This Week")).toBe(false);
    expect(matchesPeriod(null, "Overdue")).toBe(false);
  });

  test("Tomorrow keeps tomorrow only", () => {
    expect(matchesPeriod(shift(1), "Tomorrow")).toBe(true);
    expect(matchesPeriod(shift(0), "Tomorrow")).toBe(false);
  });

  test("Overdue keeps the past only", () => {
    expect(matchesPeriod(shift(-1), "Overdue")).toBe(true);
    expect(matchesPeriod(shift(0), "Overdue")).toBe(false);
  });

  test("Custom Range honours both ends inclusively", () => {
    expect(matchesPeriod(shift(2), "Custom Range", shift(1), shift(3))).toBe(true);
    expect(matchesPeriod(shift(5), "Custom Range", shift(1), shift(3))).toBe(false);
    expect(matchesPeriod(shift(3), "Custom Range", shift(1), shift(3))).toBe(true);
  });

  test("Custom Range with no dates chosen keeps dated rows", () => {
    expect(matchesPeriod(shift(99), "Custom Range")).toBe(true);
  });

  test("the page default is Today", () => {
    expect(DEFAULT_PERIOD).toBe("Today");
  });
});
