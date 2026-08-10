import { describe, expect, it } from "vitest";
import {
  formatWhatsAppForDisplay,
  joinWhatsAppNumber,
  normalizeCountryCode,
  normalizeWhatsAppNumber,
  sanitizeNationalInput,
  splitWhatsAppNumber,
  validateNationalNumber,
} from "./number-format";

describe("normalizeCountryCode", () => {
  it.each(["91", "+91", " +91 ", "+ 9 1"])("normalises %s to +91", (input) => {
    expect(normalizeCountryCode(input)).toBe("+91");
  });

  it("falls back to +91 when empty", () => {
    expect(normalizeCountryCode("")).toBe("+91");
    expect(normalizeCountryCode(null)).toBe("+91");
    expect(normalizeCountryCode(undefined)).toBe("+91");
  });

  it("supports other countries, since the code is an account setting", () => {
    expect(normalizeCountryCode("+1")).toBe("+1");
    expect(normalizeCountryCode("971")).toBe("+971");
  });
});

describe("splitWhatsAppNumber", () => {
  it("splits a fully-qualified stored number", () => {
    expect(splitWhatsAppNumber("+919876543210")).toEqual({
      countryCode: "+91",
      national: "9876543210",
    });
  });

  it("splits a number stored without the plus", () => {
    expect(splitWhatsAppNumber("919876543210")).toEqual({
      countryCode: "+91",
      national: "9876543210",
    });
  });

  it("treats a bare national number as national", () => {
    // The 9-of-27 case in production.
    expect(splitWhatsAppNumber("9876543210")).toEqual({
      countryCode: "+91",
      national: "9876543210",
    });
  });

  it("does NOT mangle a national number that happens to start with 91", () => {
    // 9199887766 is a valid 10-digit Indian mobile. Naively stripping a leading
    // "91" would leave 8 digits and silently corrupt a good number.
    expect(splitWhatsAppNumber("9199887766")).toEqual({
      countryCode: "+91",
      national: "9199887766",
    });
  });

  it("does strip the country code when the remainder is still plausible", () => {
    expect(splitWhatsAppNumber("919199887766")).toEqual({
      countryCode: "+91",
      national: "9199887766",
    });
  });

  it("ignores spaces, dashes and brackets", () => {
    expect(splitWhatsAppNumber("+91 98765-43210")).toEqual({
      countryCode: "+91",
      national: "9876543210",
    });
    expect(splitWhatsAppNumber("(98765) 43210")).toEqual({
      countryCode: "+91",
      national: "9876543210",
    });
  });

  it("returns empty for empty input rather than a half-formed value", () => {
    for (const empty of ["", "   ", null, undefined, "abc"]) {
      expect(splitWhatsAppNumber(empty)).toEqual({ countryCode: "+91", national: "" });
    }
  });

  it("preserves a foreign number instead of forcing it under the account code", () => {
    const split = splitWhatsAppNumber("+14155552671");
    expect(`${split.countryCode}${split.national}`).toBe("+14155552671");
  });

  it("honours a non-default account country code", () => {
    expect(splitWhatsAppNumber("+971501234567", "+971")).toEqual({
      countryCode: "+971",
      national: "501234567",
    });
  });
});

describe("joinWhatsAppNumber", () => {
  it("joins into storage form", () => {
    expect(joinWhatsAppNumber("+91", "9876543210")).toBe("+919876543210");
  });

  it("accepts a country code written without the plus", () => {
    expect(joinWhatsAppNumber("91", "9876543210")).toBe("+919876543210");
  });

  it("strips formatting from the national part", () => {
    expect(joinWhatsAppNumber("+91", "98765 43210")).toBe("+919876543210");
  });

  it("returns empty when there is no number, never a lone country code", () => {
    // Storing '+91' alone would look like a number and be unreachable.
    expect(joinWhatsAppNumber("+91", "")).toBe("");
    expect(joinWhatsAppNumber("+91", null)).toBe("");
    expect(joinWhatsAppNumber("+91", "   ")).toBe("");
  });
});

describe("normalizeWhatsAppNumber — the backfill and save path", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["+919876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["98765-43210", "+919876543210"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeWhatsAppNumber(input)).toBe(expected);
  });

  it("is idempotent, so re-running the backfill is harmless", () => {
    const once = normalizeWhatsAppNumber("9876543210");
    expect(normalizeWhatsAppNumber(once)).toBe(once);
    expect(normalizeWhatsAppNumber(normalizeWhatsAppNumber(once))).toBe(once);
  });

  it("returns empty for unusable input", () => {
    for (const junk of ["", null, undefined, "N/A", "-"]) {
      expect(normalizeWhatsAppNumber(junk)).toBe("");
    }
  });

  it("never produces a bare country code", () => {
    expect(normalizeWhatsAppNumber("+91")).toBe("");
  });
});

describe("validateNationalNumber", () => {
  it("accepts a normal 10-digit mobile", () => {
    expect(validateNationalNumber("9876543210")).toEqual({ valid: true });
  });

  it("allows empty — required-ness belongs to the form", () => {
    expect(validateNationalNumber("")).toEqual({ valid: true });
  });

  it("rejects something far too short", () => {
    const r = validateNationalNumber("12345");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/too short/i);
  });

  it("rejects something too long for E.164", () => {
    const r = validateNationalNumber("1234567890123456");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/too long/i);
  });

  it("catches the trunk-zero habit and explains it", () => {
    // Indian admins routinely type 0 before the mobile number.
    const r = validateNationalNumber("09876543210");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/leading 0/i);
  });

  it("does not impose country-specific length rules", () => {
    // A 9-digit UAE number must not be rejected just because Indian mobiles
    // are 10 digits.
    expect(validateNationalNumber("501234567", "+971")).toEqual({ valid: true });
  });
});

describe("sanitizeNationalInput", () => {
  it("keeps digits only", () => {
    expect(sanitizeNationalInput("98765 43210")).toBe("9876543210");
    expect(sanitizeNationalInput("+91-98765-43210")).toBe("919876543210");
    expect(sanitizeNationalInput("abc")).toBe("");
  });

  it("caps length so the field cannot overflow E.164", () => {
    expect(sanitizeNationalInput("1".repeat(30))).toHaveLength(15);
  });
});

describe("formatWhatsAppForDisplay", () => {
  it("renders a readable number for read-only surfaces", () => {
    expect(formatWhatsAppForDisplay("+919876543210")).toBe("+91 9876543210");
  });

  it("renders empty when there is no number", () => {
    expect(formatWhatsAppForDisplay(null)).toBe("");
    expect(formatWhatsAppForDisplay("")).toBe("");
  });
});
