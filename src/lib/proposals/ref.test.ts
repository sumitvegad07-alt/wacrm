import { describe, expect, test } from "vitest";
import { buildRef, companyCode } from "./ref";

describe("companyCode", () => {
  test("takes word initials for a multi-word company", () => {
    expect(companyCode("Shaahi Niti Masale")).toBe("SNM");
  });

  test("uses the first three letters when there is only one meaningful word", () => {
    expect(companyCode("Anode")).toBe("ANO");
  });

  test("caps initials at three letters", () => {
    expect(companyCode("Bharat Agro Food Products Group")).toBe("BAF");
  });

  test("ignores company-form noise words", () => {
    expect(companyCode("Shree Plastics Pvt Ltd")).toBe("SP");
  });

  test("ignores an M/s prefix", () => {
    expect(companyCode("M/s. Gupta Traders")).toBe("GT");
  });

  test("strips digits and punctuation from the code", () => {
    expect(companyCode("3M Coated Abrasives")).toBe("MCA");
  });

  test("falls back to OZ when nothing usable is left", () => {
    expect(companyCode("  123  ")).toBe("OZ");
  });
});

describe("buildRef", () => {
  test("reproduces the reference on the Shaahi Niti proposal", () => {
    expect(buildRef("Shaahi Niti Masale", "2026-09-22", 1)).toBe("OZZO/2026/09/SNM-01");
  });

  test("zero-pads the month", () => {
    expect(buildRef("Anode", "2026-01-04", 1)).toBe("OZZO/2026/01/ANO-01");
  });

  test("zero-pads a single-digit sequence and leaves two digits alone", () => {
    expect(buildRef("Anode", "2026-09-22", 9)).toBe("OZZO/2026/09/ANO-09");
    expect(buildRef("Anode", "2026-09-22", 12)).toBe("OZZO/2026/09/ANO-12");
  });

  test("reads the month from the given date rather than today", () => {
    expect(buildRef("Gupta Traders", new Date(2025, 11, 31), 2)).toBe("OZZO/2025/12/GT-02");
  });
});
