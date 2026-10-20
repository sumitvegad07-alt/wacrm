import { describe, expect, test } from "vitest";
import { placeOfSupply, splitTax } from "./tax";

// ---------------------------------------------------------------------------
// The two halves of an intra-state tax MUST be equal — CGST 9% and SGST 9% are
// separate levies at their own rate, not a split of one 18% figure. Computing
// each at its own rate is what keeps them equal AND keeps the printed rows
// adding up to the printed total.
// ---------------------------------------------------------------------------

describe("splitTax", () => {
  test("intra-state charges CGST and SGST at half the rate each", () => {
    expect(splitTax(10000, 18, "intrastate")).toEqual({
      cgst: 900,
      sgst: 900,
      igst: 0,
      total: 1800,
    });
  });

  test("inter-state puts the whole rate in IGST", () => {
    expect(splitTax(10000, 18, "interstate")).toEqual({
      cgst: 0,
      sgst: 0,
      igst: 1800,
      total: 1800,
    });
  });

  test("the two halves stay equal on an awkward amount, and sum to the total", () => {
    const split = splitTax(25005, 18, "intrastate");
    expect(split.cgst).toBe(split.sgst);
    expect(split.cgst + split.sgst).toBe(split.total);
    expect(split.cgst).toBe(2250); // 25005 × 9% = 2250.45 → 2250
  });

  test("an unknown place of supply charges nothing rather than guessing", () => {
    expect(splitTax(10000, 18, "unknown")).toEqual({ cgst: 0, sgst: 0, igst: 0, total: 0 });
    expect(splitTax(10000, 18, null)).toEqual({ cgst: 0, sgst: 0, igst: 0, total: 0 });
  });

  test("a zero rate is a non-GST invoice and produces no tax", () => {
    expect(splitTax(10000, 0, "intrastate").total).toBe(0);
  });

  test("a zero or negative taxable value produces no tax", () => {
    expect(splitTax(0, 18, "interstate").total).toBe(0);
    expect(splitTax(-500, 18, "interstate").total).toBe(0);
  });

  test("every figure is a whole rupee", () => {
    const split = splitTax(1234, 18, "interstate");
    expect(Number.isInteger(split.igst)).toBe(true);
    expect(split.igst).toBe(222); // 1234 × 18% = 222.12
  });

  test("nonsense never produces NaN", () => {
    expect(splitTax(Number.NaN, 18, "interstate").total).toBe(0);
    expect(splitTax(10000, Number.NaN, "interstate").total).toBe(0);
  });
});

describe("placeOfSupply", () => {
  test("a registered buyer's GSTIN decides it", () => {
    expect(placeOfSupply("24AAAAA0000A1Z5", "Maharashtra")).toBe("24");
  });

  test("an unregistered buyer falls back to the state picked", () => {
    expect(placeOfSupply("", "Gujarat")).toBe("24");
  });

  test("neither one gives null, so the caller must refuse to issue", () => {
    expect(placeOfSupply("", "")).toBeNull();
    expect(placeOfSupply("  ", "Not A State")).toBeNull();
  });
});
