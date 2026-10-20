import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceDocument } from "./invoice-document";
import type { InvoiceRow } from "../types";

// ---------------------------------------------------------------------------
// The document is the only artefact a customer and a CA ever see. These tests
// pin the three things that make it a valid tax invoice — the title, both
// GSTINs, and the right pair of tax rows — and the one thing that makes the
// non-GST variant safe: no GSTIN and no tax anywhere on it.
// ---------------------------------------------------------------------------

function text(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function row(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1", invoice_no: "OZZO/26-27/001", series: "gst", fy: "26-27", seq: 1,
    invoice_date: "2026-10-20", account_id: "acc-1", customer_id: "001001",
    client_name: "Shree Narmada Masala", plan: "CRM_SFA", billing_term: "yearly",
    users_billed: 5, period_start: "2026-11-01", period_end: "2027-10-31",
    gst_enabled: true, gst_rate: 18, gst_type: "intrastate", place_of_supply_code: "24",
    subtotal: 24000, discount_amount: 0, taxable_value: 24000,
    cgst_amount: 2160, sgst_amount: 2160, igst_amount: 0,
    total: 28320, amount_received: 0, status: "issued", paid_at: null,
    created_at: "", updated_at: "",
    data: {
      seller: {
        firmName: "OZZO Technologies", address: "Surat, Gujarat", pincode: "395006",
        state: "Gujarat", gstStateCode: "24", gstin: "24AAAAA0000A1Z5", pan: "AAAAA0000A",
        phone: "", email: "", bankName: "HDFC Bank", bankAccountNo: "50200012345678",
        ifsc: "HDFC0001234", upiId: "ozzo@hdfcbank",
        declaration: "We declare that this invoice shows the actual price.",
        signatureUrl: null, logoUrl: null,
      },
      buyer: {
        name: "Shree Narmada Masala", address: "Rajkot, Gujarat", pincode: "360001",
        state: "Gujarat", gstStateCode: "24", gstin: "24BBBBB1111B1Z5",
        contactPerson: "", phone: "", email: "",
      },
      lines: [{
        label: "OZZO CRM + SFA", description: "Subscription · 5 users · 12 months",
        sac: "998314", users: 5, months: 12, rate: 400,
      }],
      discountPct: 0, discountAmount: 0, notes: "", terms: "Payment due within 7 days.",
    },
    ...overrides,
  };
}

describe("InvoiceDocument — GST variant", () => {
  test("is titled a tax invoice", () => {
    expect(text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />))).toContain(
      "TAX INVOICE",
    );
  });

  test("prints both GSTINs and the place of supply", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).toContain("24AAAAA0000A1Z5");
    expect(out).toContain("24BBBBB1111B1Z5");
    expect(out).toContain("Gujarat (24)");
  });

  test("prints CGST and SGST for an intra-state sale, and no IGST", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).toContain("CGST");
    expect(out).toContain("SGST");
    expect(out).not.toContain("IGST");
  });

  test("prints IGST only, for an inter-state sale", () => {
    const inter = row({
      gst_type: "interstate", place_of_supply_code: "27",
      cgst_amount: 0, sgst_amount: 0, igst_amount: 4320,
    });
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={inter} />));
    expect(out).toContain("IGST");
    expect(out).not.toContain("CGST");
  });

  test("prints the SAC code, the period and the amount in words", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).toContain("998314");
    expect(out).toContain("01 Nov 2026");
    expect(out).toContain("31 Oct 2027");
    expect(out).toContain("Rupees Twenty Eight Thousand Three Hundred Twenty Only");
  });

  test("prints the bank details so the customer can pay it", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).toContain("50200012345678");
    expect(out).toContain("HDFC0001234");
  });

  test("a cancelled invoice says so on its face", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row({ status: "cancelled" })} />));
    expect(out).toContain("CANCELLED");
  });

  test("a draft is watermarked, so an unissued document is never mistaken for one", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row({ status: "draft" })} />));
    expect(out).toContain("DRAFT");
  });

  test("an issued invoice carries no watermark", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).not.toContain("DRAFT");
    expect(out).not.toContain("CANCELLED");
  });
});

describe("InvoiceDocument — non-GST variant", () => {
  const nonGst = row({
    series: "non_gst", gst_enabled: false, gst_type: null, place_of_supply_code: null,
    gst_rate: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total: 24000,
  });

  test("is titled an invoice, not a tax invoice", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).toContain("INVOICE");
    expect(out).not.toContain("TAX INVOICE");
  });

  test("prints no GSTIN at all — neither ours nor theirs", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).not.toContain("24AAAAA0000A1Z5");
    expect(out).not.toContain("24BBBBB1111B1Z5");
    expect(out).not.toContain("GSTIN");
  });

  test("prints no tax row and no place of supply", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).not.toContain("CGST");
    expect(out).not.toContain("SGST");
    expect(out).not.toContain("IGST");
    expect(out).not.toContain("Place of Supply");
  });

  test("the total is the taxable value", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).toContain("Rupees Twenty Four Thousand Only");
  });

  test("prints no SAC column, which only a tax invoice needs", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).not.toContain("SAC");
  });
});
