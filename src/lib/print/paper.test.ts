import { describe, expect, test } from "vitest";
import { paperMetrics, parsePaperSize } from "./paper";

describe("parsePaperSize", () => {
  test("A4 is the default for anything unrecognised", () => {
    expect(parsePaperSize(null)).toBe("A4");
    expect(parsePaperSize(undefined)).toBe("A4");
    expect(parsePaperSize("")).toBe("A4");
    expect(parsePaperSize("letter")).toBe("A4");
    expect(parsePaperSize("a4")).toBe("A4");
  });

  test("A5 is recognised whatever the case", () => {
    expect(parsePaperSize("a5")).toBe("A5");
    expect(parsePaperSize("A5")).toBe("A5");
  });
});

describe("paperMetrics", () => {
  test("A4 is not compact and keeps the roomier margin", () => {
    const m = paperMetrics("A4");
    expect(m.compact).toBe(false);
    expect(m.margin).toBe("16mm");
  });

  test("A5 is compact with a tighter margin", () => {
    const m = paperMetrics("A5");
    expect(m.compact).toBe(true);
    expect(m.margin).toBe("10mm");
  });

  // A5 is half an A4 sheet. If the type did not come down with it the same
  // table would run off the page, which is the whole reason this helper exists.
  test("every A5 measurement is smaller than its A4 counterpart", () => {
    const a4 = paperMetrics("A4");
    const a5 = paperMetrics("A5");
    for (const key of ["title", "heading", "body", "table"] as const) {
      expect(parseFloat(a5[key])).toBeLessThan(parseFloat(a4[key]));
    }
  });

  test("measurements carry CSS units", () => {
    const m = paperMetrics("A4");
    for (const key of ["title", "heading", "body", "table"] as const) {
      expect(m[key]).toMatch(/^[\d.]+px$/);
    }
  });

  // The document routes interpolate this straight into `@page { size: ... }`,
  // so it has to be the CSS keyword, not a lowercased query value.
  test("size comes back as the CSS keyword", () => {
    expect(paperMetrics("A5").size).toBe("A5");
    expect(paperMetrics("A4").size).toBe("A4");
  });
});
