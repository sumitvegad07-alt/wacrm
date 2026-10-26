import { describe, expect, test } from "vitest";
import { A5_SCALE, documentPrintCss } from "./document-styles";

describe("documentPrintCss", () => {
  test("A4 keeps the sheet exactly as it has always printed", () => {
    const css = documentPrintCss("A4");
    expect(css).toContain("size: A4 portrait");
    expect(css).toContain("margin: 16mm");
    // No zoom at all on A4 — the documents in production today have none, and
    // adding one would change sheets the customer has already approved.
    expect(css).not.toContain("zoom");
  });

  test("A5 names the smaller sheet and shrinks the document onto it", () => {
    const css = documentPrintCss("A5");
    expect(css).toContain("size: A5 portrait");
    expect(css).toContain("margin: 10mm");
    expect(css).toContain(`zoom: ${A5_SCALE}`);
  });

  // A5's edges are 1/√2 of A4's. Any other factor either crops the document
  // or leaves a band of white down the side.
  test("the scale is the real ratio between the two sheets", () => {
    expect(A5_SCALE).toBeCloseTo(1 / Math.SQRT2, 4);
  });

  test("both sizes keep the on-screen controls off the paper", () => {
    for (const size of ["A4", "A5"] as const) {
      expect(documentPrintCss(size)).toContain(".print-hide { display: none !important; }");
    }
  });
});
