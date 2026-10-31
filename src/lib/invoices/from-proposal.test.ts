import { describe, expect, test } from "vitest";
import { invoiceFromProposal } from "./from-proposal";
import { invoiceTotals } from "./totals";
import { getTemplate } from "@/lib/proposals/registry";
import { computeTotals } from "@/lib/proposals/totals";
import type { ProposalData } from "@/lib/proposals/types";

// ---------------------------------------------------------------------------
// The founder's case, end to end: a yearly subscription with two users added
// nine months from the end. What the quotation charged is what the invoice must
// charge — if these two ever disagree, the client has been quoted one figure
// and billed another.
// ---------------------------------------------------------------------------

const QUOTE: ProposalData = {
  ...getTemplate("SFA")!.defaults("2026-10-31"),
  ref: "OZZO/2026/10/OZ-07",
  gstEnabled: true,
  gstRate: 18,
  offer: "2 months free subscription",
  billingTerm: "yearly",
  client: {
    name: "Tetramed Surgicals",
    shortName: "Tetramed",
    industry: "Surgical",
    website: "",
    address: "Block D, Second Floor, D-156, Chennai",
  },
  lineItems: [
    {
      label: "OZZO SFA — Field Salesman",
      subLabel: "PLAN: SFA\nUSER: 5",
      users: 5,
      rate: 300,
      months: 12,
      periodStart: "2026-11-01",
      periodEnd: "2027-10-31",
    },
    { label: "OZZO SFA — 2 added users", subLabel: "", users: 2, rate: 270, months: 9 },
  ],
};

describe("invoiceFromProposal", () => {
  test("bills every row for its own months, exactly as quoted", () => {
    const pre = invoiceFromProposal({ plan: "SFA", data: QUOTE });

    expect(pre.lines).toHaveLength(2);
    expect(pre.lines[0]).toMatchObject({ users: 5, rate: 300, months: 12 });
    expect(pre.lines[1]).toMatchObject({ users: 2, rate: 270, months: 9 });
  });

  test("the invoice totals what the quotation totalled", () => {
    const quoted = computeTotals(QUOTE.lineItems, {
      gstEnabled: true,
      gstRate: 18,
      term: "yearly",
    });
    const pre = invoiceFromProposal({ plan: "SFA", data: QUOTE });
    const billed = invoiceTotals(pre.lines, {
      gstEnabled: true,
      gstRate: 18,
      gstType: "interstate",
    });

    expect(billed.subtotal).toBe(quoted.subtotal);
    expect(billed.subtotal).toBe(22860); // 18,000 + 4,860
  });

  test("carries the description box and the offer across word for word", () => {
    const pre = invoiceFromProposal({ plan: "SFA", data: QUOTE });

    expect(pre.lines[0].description).toBe("PLAN: SFA\nUSER: 5");
    expect(pre.offer).toBe("2 months free subscription");
  });

  test("names the quotation it came from", () => {
    const pre = invoiceFromProposal({ plan: "SFA", data: QUOTE });

    expect(pre.notes).toBe("Against quotation OZZO/2026/10/OZ-07");
    expect(pre.fromRef).toBe("OZZO/2026/10/OZ-07");
  });

  test("a quotation with GST off goes to the non-GST book", () => {
    expect(invoiceFromProposal({ plan: "SFA", data: QUOTE }).series).toBe("gst");
    expect(
      invoiceFromProposal({ plan: "SFA", data: { ...QUOTE, gstEnabled: false } }).series,
    ).toBe("non_gst");
  });

  test("leaves the details a quotation never had blank, rather than guessing", () => {
    const { buyer } = invoiceFromProposal({ plan: "SFA", data: QUOTE });

    expect(buyer.name).toBe("Tetramed Surgicals");
    expect(buyer.address).toContain("Chennai");
    // A GST invoice needs these and a quotation never collects them. Blank is
    // what makes the founder fill them in; a guess is what prints the wrong
    // place of supply on a tax invoice.
    expect(buyer.gstin).toBe("");
    expect(buyer.state).toBe("");
    expect(buyer.pincode).toBe("");
  });

  test("takes the subscription row's dates as the invoice period", () => {
    const pre = invoiceFromProposal({ plan: "SFA", data: QUOTE });

    expect(pre.periodStart).toBe("2026-11-01");
    expect(pre.periodEnd).toBe("2027-10-31");
  });

  test("a quotation whose rows carry no months is billed on its term", () => {
    const legacy: ProposalData = {
      ...QUOTE,
      billingTerm: "quarterly",
      lineItems: [{ label: "x", subLabel: "", users: 4, rate: 420 }],
    };
    const pre = invoiceFromProposal({ plan: "SFA", data: legacy });

    expect(pre.lines[0].months).toBe(3);
    expect(pre.periodStart).toBeNull();
  });

  test("an empty quotation produces no lines rather than throwing", () => {
    const pre = invoiceFromProposal({ plan: "SFA", data: { ...QUOTE, lineItems: [] } });

    expect(pre.lines).toEqual([]);
  });
});
