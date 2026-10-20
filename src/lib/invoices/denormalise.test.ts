import { describe, expect, test } from "vitest";
import { invoiceColumns, planLine } from "./denormalise";
import type { InvoiceData } from "./types";

function data(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    seller: {
      firmName: "OZZO", address: "", pincode: "", state: "Gujarat",
      gstStateCode: "24", gstin: "24AAAAA0000A1Z5", pan: "", phone: "", email: "",
      bankName: "", bankAccountNo: "", ifsc: "", upiId: "", declaration: "",
      signatureUrl: null, logoUrl: null,
    },
    buyer: {
      name: "Shree Narmada Masala", address: "", pincode: "", state: "Gujarat",
      gstStateCode: "24", gstin: "24BBBBB1111B1Z5", contactPerson: "", phone: "", email: "",
    },
    lines: [
      { label: "OZZO CRM + SFA", description: "", sac: "998314", users: 5, months: 12, rate: 400 },
    ],
    discountPct: 0,
    discountAmount: 0,
    notes: "",
    terms: "",
    ...overrides,
  };
}

const meta = {
  series: "gst" as const,
  fy: "26-27",
  seq: 1,
  invoiceNo: "OZZO/26-27/001",
  invoiceDate: "2026-10-20",
  accountId: "acc-1",
  customerId: "001001",
  plan: "CRM_SFA",
  billingTerm: "yearly" as const,
  periodStart: "2026-11-01",
  periodEnd: "2027-10-31",
  gstEnabled: true,
  gstRate: 18,
};

describe("invoiceColumns", () => {
  test("derives every money column from the payload", () => {
    const row = invoiceColumns(data(), meta);
    expect(row).toMatchObject({
      invoice_no: "OZZO/26-27/001",
      series: "gst",
      fy: "26-27",
      seq: 1,
      client_name: "Shree Narmada Masala",
      customer_id: "001001",
      plan: "CRM_SFA",
      billing_term: "yearly",
      users_billed: 5,
      subtotal: 24000,
      taxable_value: 24000,
      cgst_amount: 2160,
      sgst_amount: 2160,
      igst_amount: 0,
      total: 28320,
    });
  });

  test("same state is intra-state, from the two GSTINs", () => {
    expect(invoiceColumns(data(), meta).gst_type).toBe("intrastate");
    expect(invoiceColumns(data(), meta).place_of_supply_code).toBe("24");
  });

  test("a different state is inter-state and taxes as IGST", () => {
    const d = data();
    d.buyer.gstin = "27CCCCC2222C1Z5"; // Maharashtra
    const row = invoiceColumns(d, meta);
    expect(row.gst_type).toBe("interstate");
    expect(row.place_of_supply_code).toBe("27");
    expect(row.igst_amount).toBe(4320);
    expect(row.cgst_amount).toBe(0);
  });

  test("an undeterminable place of supply is 'unknown', never a guess", () => {
    const d = data();
    d.buyer.gstin = "";
    d.buyer.state = "";
    d.buyer.gstStateCode = "";
    const row = invoiceColumns(d, meta);
    expect(row.gst_type).toBe("unknown");
    expect(row.place_of_supply_code).toBeNull();
    expect(row.total).toBe(24000); // no tax charged on a guess
  });

  test("a non-GST invoice stores gst_type null, as the CHECK constraint requires", () => {
    const row = invoiceColumns(data(), { ...meta, gstEnabled: false, series: "non_gst" });
    expect(row.gst_enabled).toBe(false);
    expect(row.gst_type).toBeNull();
    expect(row.place_of_supply_code).toBeNull();
    expect(row.total).toBe(24000);
  });

  test("users_billed is the plan line's users, not the sum of every line", () => {
    const d = data();
    d.lines.push({
      label: "One-time setup", description: "", sac: "998314", users: 1, months: 1, rate: 6000,
    });
    expect(invoiceColumns(d, meta).users_billed).toBe(5);
    expect(invoiceColumns(d, meta).subtotal).toBe(30000);
  });

  test("the whole payload is stored as data", () => {
    const d = data();
    expect(invoiceColumns(d, meta).data).toBe(d);
  });

  test("an unrecognised term reads as yearly, the base rate", () => {
    // Never an uplifted one: a bad value can only ever under-charge.
    const row = invoiceColumns(data(), { ...meta, billingTerm: "monthly" as never });
    expect(row.billing_term).toBe("yearly");
  });
});

describe("planLine", () => {
  test("prices the plan line from the shared quote engine", () => {
    // CRM_SFA at ₹400 pupm yearly (PLAN_PRICE.CRM_SFA), 5 users, 12 months.
    expect(planLine("CRM_SFA", 5, "yearly")).toMatchObject({
      users: 5,
      months: 12,
      rate: 400,
      sac: "998314",
    });
  });

  test("a quarterly line carries the uplifted rate and three months", () => {
    const line = planLine("CRM_SFA", 5, "quarterly");
    expect(line.months).toBe(3);
    expect(line.rate).toBe(560); // 400 × 1.40
  });

  test("the label names the plan", () => {
    expect(planLine("CRM_SFA", 5, "yearly").label).toContain("OZZO");
  });
});
