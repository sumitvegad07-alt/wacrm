import { describe, expect, test } from "vitest";
import { formatLongDate, inr } from "./format";

describe("formatLongDate", () => {
  test("prints the date the way the proposal cover does", () => {
    expect(formatLongDate("2026-09-22")).toBe("22 September 2026");
  });

  test("does not zero-pad the day", () => {
    expect(formatLongDate("2026-01-04")).toBe("4 January 2026");
  });

  test("reads the date as written, with no timezone shift", () => {
    // Parsed from the parts, not through Date, so a proposal dated the 1st
    // never prints as the last day of the previous month.
    expect(formatLongDate("2026-03-01")).toBe("1 March 2026");
  });

  test("prints nothing for a blank date rather than 'Invalid Date'", () => {
    expect(formatLongDate("")).toBe("");
  });
});

describe("inr", () => {
  test("groups thousands", () => {
    expect(inr(21600)).toBe("21,600");
  });

  test("groups in lakhs, Indian style", () => {
    expect(inr(125000)).toBe("1,25,000");
  });

  test("omits decimals for whole rupees", () => {
    expect(inr(18000)).toBe("18,000");
  });

  test("keeps paise when there are any", () => {
    expect(inr(359.82)).toBe("359.82");
  });

  test("prints zero as 0", () => {
    expect(inr(0)).toBe("0");
  });
});
