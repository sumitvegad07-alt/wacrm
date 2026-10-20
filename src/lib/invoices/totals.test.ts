import { describe, expect, test } from "vitest";
import { amountInWords, invoiceTotals, lineAmount } from "./totals";
import type { InvoiceLine } from "./types";

function line(partial: Partial<InvoiceLine>): InvoiceLine {
  return {
    label: "OZZO CRM + SFA",
    description: "",
    sac: "998314",
    users: 1,
    months: 1,
    rate: 0,
    ...partial,
  };
}

describe("lineAmount", () => {
  test("a subscription line multiplies users, months and rate", () => {
    expect(lineAmount(line({ users: 5, months: 12, rate: 400 }))).toBe(24000);
  });

  test("a one-off charge is users 1, months 1 and the whole amount in rate", () => {
    expect(lineAmount(line({ users: 1, months: 1, rate: 7500 }))).toBe(7500);
  });

  test("a blank line is zero, never NaN", () => {
    expect(lineAmount(line({ users: Number.NaN, rate: 400 }))).toBe(0);
  });
});

describe("invoiceTotals", () => {
  const lines = [
    line({ users: 5, months: 12, rate: 400 }), // 24,000
    line({ label: "One-time setup", users: 1, months: 1, rate: 6000 }), // 6,000
  ];

  test("subtotal is every line, extra charges included", () => {
    const t = invoiceTotals(lines, { gstEnabled: false, gstRate: 0, gstType: null });
    expect(t.subtotal).toBe(30000);
    expect(t.taxableValue).toBe(30000);
    expect(t.total).toBe(30000);
    expect(t.taxTotal).toBe(0);
  });

  test("a percent discount comes off the whole subtotal, including extra lines", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: false,
      gstRate: 0,
      gstType: null,
      discountPct: 10,
    });
    expect(t.discountAmount).toBe(3000);
    expect(t.taxableValue).toBe(27000);
  });

  test("a flat discount is used when no percent was given", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: false,
      gstRate: 0,
      gstType: null,
      discountAmount: 2500,
    });
    expect(t.discountAmount).toBe(2500);
    expect(t.taxableValue).toBe(27500);
  });

  test("a percent wins over a flat amount, so a discount can never apply twice", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: false,
      gstRate: 0,
      gstType: null,
      discountPct: 10,
      discountAmount: 2500,
    });
    expect(t.discountAmount).toBe(3000);
  });

  test("a discount cannot exceed the subtotal", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: false,
      gstRate: 0,
      gstType: null,
      discountAmount: 99999,
    });
    expect(t.discountAmount).toBe(30000);
    expect(t.taxableValue).toBe(0);
    expect(t.total).toBe(0);
  });

  test("GST is charged on the discounted value, not the subtotal", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: true,
      gstRate: 18,
      gstType: "intrastate",
      discountPct: 10,
    });
    expect(t.taxableValue).toBe(27000);
    expect(t.cgst).toBe(2430);
    expect(t.sgst).toBe(2430);
    expect(t.igst).toBe(0);
    expect(t.taxTotal).toBe(4860);
    expect(t.total).toBe(31860);
  });

  test("the printed rows always add up to the printed total", () => {
    const t = invoiceTotals([line({ users: 3, months: 3, rate: 557 })], {
      gstEnabled: true,
      gstRate: 18,
      gstType: "intrastate",
    });
    expect(t.taxableValue + t.cgst + t.sgst + t.igst).toBe(t.total);
  });

  test("GST off ignores the rate entirely", () => {
    const t = invoiceTotals(lines, { gstEnabled: false, gstRate: 18, gstType: "intrastate" });
    expect(t.taxTotal).toBe(0);
    expect(t.total).toBe(30000);
  });

  test("no lines is a zero invoice, not a crash", () => {
    const t = invoiceTotals([], { gstEnabled: true, gstRate: 18, gstType: "intrastate" });
    expect(t).toMatchObject({ subtotal: 0, taxableValue: 0, taxTotal: 0, total: 0 });
  });
});

describe("amountInWords", () => {
  test("the Indian scale: thousand, lakh, crore", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(7)).toBe("Rupees Seven Only");
    expect(amountInWords(19)).toBe("Rupees Nineteen Only");
    expect(amountInWords(40)).toBe("Rupees Forty Only");
    expect(amountInWords(99)).toBe("Rupees Ninety Nine Only");
    expect(amountInWords(100)).toBe("Rupees One Hundred Only");
    expect(amountInWords(1000)).toBe("Rupees One Thousand Only");
    expect(amountInWords(31860)).toBe("Rupees Thirty One Thousand Eight Hundred Sixty Only");
    expect(amountInWords(100000)).toBe("Rupees One Lakh Only");
    expect(amountInWords(123400)).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Only",
    );
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
    expect(amountInWords(112345678)).toBe(
      "Rupees Eleven Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only",
    );
  });

  test("a figure with paise is rounded to the rupee", () => {
    expect(amountInWords(99.6)).toBe("Rupees One Hundred Only");
  });

  test("a negative or nonsense figure reads zero rather than crashing a print", () => {
    expect(amountInWords(-5)).toBe("Rupees Zero Only");
    expect(amountInWords(Number.NaN)).toBe("Rupees Zero Only");
  });
});
