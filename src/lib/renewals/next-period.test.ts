import { describe, expect, test } from "vitest";
import { nextPeriod, periodEnd } from "./next-period";

// ---------------------------------------------------------------------------
// A period ends the day BEFORE the next one starts. Getting that wrong by a day
// either double-bills a day or leaves a gap, and the gap is what makes a
// customer appear overdue when they are not.
// ---------------------------------------------------------------------------

describe("periodEnd", () => {
  test("a yearly period starting 1 Nov ends 31 Oct", () => {
    expect(periodEnd("2026-11-01", "yearly")).toBe("2027-10-31");
  });

  test("a quarterly period runs three months", () => {
    expect(periodEnd("2026-11-01", "quarterly")).toBe("2027-01-31");
  });

  test("a half-yearly period runs six months", () => {
    expect(periodEnd("2026-11-01", "half_yearly")).toBe("2027-04-30");
  });

  test("a period starting mid-month ends mid-month", () => {
    expect(periodEnd("2026-10-15", "yearly")).toBe("2027-10-14");
  });

  test("a 31st start clamps into a shorter month rather than overflowing it", () => {
    // 31 Jan + 3 months has no 31 April to land on, so the anniversary clamps
    // to 30 April and the period ends the day before it, 29 April. Clamping
    // down rather than spilling into May is what keeps a quarterly term three
    // months long; the one-day shortfall is the price of February.
    expect(periodEnd("2026-01-31", "quarterly")).toBe("2026-04-29");
  });

  test("a leap-day start clamps to 28 February the following year", () => {
    // 29 Feb 2028 + 12 months clamps to 28 Feb 2029, so the period ends 27 Feb.
    expect(periodEnd("2028-02-29", "yearly")).toBe("2029-02-27");
  });

  test("no term reads as yearly, the base term", () => {
    expect(periodEnd("2026-11-01", null)).toBe("2027-10-31");
  });

  test("a blank start date is blank, never an invalid date", () => {
    expect(periodEnd("", "yearly")).toBe("");
    expect(periodEnd("not-a-date", "yearly")).toBe("");
  });
});

describe("nextPeriod", () => {
  test("the next period starts the day after the current one ends", () => {
    expect(nextPeriod("2026-10-20", "yearly")).toEqual({
      start: "2026-10-21",
      end: "2027-10-20",
    });
  });

  test("it rolls over a month end", () => {
    expect(nextPeriod("2026-10-31", "quarterly")).toEqual({
      start: "2026-11-01",
      end: "2027-01-31",
    });
  });

  test("it rolls over a year end", () => {
    expect(nextPeriod("2026-12-31", "yearly")).toEqual({
      start: "2027-01-01",
      end: "2027-12-31",
    });
  });

  test("a blank end date gives blanks, not an invalid date", () => {
    expect(nextPeriod("", "yearly")).toEqual({ start: "", end: "" });
  });

  // The invariant the whole register depends on: consecutive periods must
  // neither overlap (double-billing a day) nor leave a gap (a paid-up customer
  // reading as overdue). Checked across the awkward starts, not just a clean one.
  test.each([
    ["2026-11-01", "yearly"],
    ["2026-01-31", "quarterly"],
    ["2028-02-29", "yearly"],
    ["2026-10-15", "half_yearly"],
    ["2026-12-31", "quarterly"],
  ] as const)("no gap and no overlap after %s on a %s term", (start, term) => {
    const end = periodEnd(start, term);
    const next = nextPeriod(end, term);

    // The next period begins exactly one day after this one ended.
    const endMs = Date.parse(`${end}T00:00:00Z`);
    const startMs = Date.parse(`${next.start}T00:00:00Z`);
    expect(startMs - endMs).toBe(86_400_000);

    // And it is itself a valid, forward-running period.
    expect(next.end >= next.start).toBe(true);
  });
});
