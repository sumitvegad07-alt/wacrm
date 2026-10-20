import { describe, expect, test } from "vitest";
import { buildInvoiceNo, nextSeq, parseInvoiceNo } from "./number";

// ---------------------------------------------------------------------------
// GST wants a consecutive series, unique within a financial year. The two
// series are kept apart by a single letter so a glance at the number says
// which book an invoice belongs in.
// ---------------------------------------------------------------------------

describe("buildInvoiceNo", () => {
  test("a GST invoice is OZZO/<fy>/<3 digits>", () => {
    expect(buildInvoiceNo("gst", "26-27", 1)).toBe("OZZO/26-27/001");
  });

  test("a non-GST invoice carries a B", () => {
    expect(buildInvoiceNo("non_gst", "26-27", 1)).toBe("OZZO/26-27/B001");
  });

  test("padding stops at three digits and then grows", () => {
    expect(buildInvoiceNo("gst", "26-27", 99)).toBe("OZZO/26-27/099");
    expect(buildInvoiceNo("gst", "26-27", 100)).toBe("OZZO/26-27/100");
    expect(buildInvoiceNo("gst", "26-27", 1234)).toBe("OZZO/26-27/1234");
  });

  test("the number stays inside the 16-character GST limit", () => {
    // Rule 46(b): at most 16 characters, alphanumeric plus "-" and "/".
    expect(buildInvoiceNo("non_gst", "26-27", 9999).length).toBeLessThanOrEqual(16);
  });
});

describe("parseInvoiceNo", () => {
  test("round-trips both series", () => {
    expect(parseInvoiceNo("OZZO/26-27/001")).toEqual({ series: "gst", fy: "26-27", seq: 1 });
    expect(parseInvoiceNo("OZZO/26-27/B042")).toEqual({ series: "non_gst", fy: "26-27", seq: 42 });
  });

  test("anything else is null, never a guess", () => {
    expect(parseInvoiceNo("")).toBeNull();
    expect(parseInvoiceNo("INV-1")).toBeNull();
    expect(parseInvoiceNo("OZZO/2026/001")).toBeNull();
    expect(parseInvoiceNo("OZZO/26-27/X001")).toBeNull();
  });
});

describe("nextSeq", () => {
  test("the first invoice of a series is 1", () => {
    expect(nextSeq(null, null)).toBe(1);
    expect(nextSeq(0, null)).toBe(1);
  });

  test("otherwise it follows the last one", () => {
    expect(nextSeq(7, null)).toBe(8);
  });

  test("an override starts the series higher, for books begun outside the app", () => {
    expect(nextSeq(null, 51)).toBe(51);
    expect(nextSeq(3, 51)).toBe(51);
  });

  test("an override already passed is ignored — the series never goes backwards", () => {
    expect(nextSeq(60, 51)).toBe(61);
  });

  test("nonsense never produces a NaN number", () => {
    expect(nextSeq(Number.NaN, null)).toBe(1);
    expect(nextSeq(null, Number.NaN)).toBe(1);
    expect(nextSeq(null, -5)).toBe(1);
  });
});
