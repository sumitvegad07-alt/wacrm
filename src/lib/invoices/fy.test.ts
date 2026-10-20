import { describe, expect, test } from "vitest";
import { financialYear } from "./fy";

// ---------------------------------------------------------------------------
// The Indian financial year starts on 1 April. Every GST invoice number here
// carries it, so an off-by-one at the boundary renumbers a whole year's books.
// ---------------------------------------------------------------------------

describe("financialYear", () => {
  test("a date in April starts the new year", () => {
    expect(financialYear("2026-04-01")).toBe("26-27");
  });

  test("a date in March belongs to the year that began last April", () => {
    expect(financialYear("2027-03-31")).toBe("26-27");
  });

  test("January, February and March all look back", () => {
    expect(financialYear("2027-01-15")).toBe("26-27");
    expect(financialYear("2027-02-28")).toBe("26-27");
  });

  test("the day before the boundary is still the old year", () => {
    expect(financialYear("2026-03-31")).toBe("25-26");
  });

  test("a yyyy-mm-dd string is never passed through Date", () => {
    // 2026-04-01 read as UTC midnight then formatted in a timezone behind UTC
    // would come back as 31 March and answer "25-26".
    expect(financialYear("2026-04-01")).toBe("26-27");
    expect(financialYear("2026-12-31")).toBe("26-27");
  });

  test("a Date object is read in local terms", () => {
    expect(financialYear(new Date(2026, 3, 1))).toBe("26-27"); // month 3 = April
    expect(financialYear(new Date(2026, 2, 31))).toBe("25-26"); // month 2 = March
  });

  test("the century rolls over without a four-digit label", () => {
    expect(financialYear("2099-05-01")).toBe("99-00");
  });
});
