// ============================================================
// A quotation, carried onto an invoice.
//
// Pure: it takes a stored proposal and returns the fields an invoice form
// starts from. It creates nothing and numbers nothing — the founder reviews the
// result and presses Save, and only then is an invoice number given out. A
// quotation converted and then abandoned therefore never eats a number out of
// the series, which a number assigned at conversion time would.
//
// What does NOT carry over is as deliberate as what does. A quotation has no
// GSTIN, no place of supply and no pincode for the client, because it never
// needed them; an invoice does, and they are the founder's to fill in. Leaving
// them blank is what makes the gap visible on the form instead of printing a
// tax invoice with the wrong state on it.
// ============================================================

import { TERM_MONTHS, asTerm, type BillingTerm } from "@/lib/plans/pricing";
import { lineMonths } from "@/lib/proposals/totals";
import type { ProposalData } from "@/lib/proposals/types";
import {
  DEFAULT_SAC,
  type BuyerSnapshot,
  type InvoiceLine,
  type InvoiceSeries,
} from "./types";

/** Everything an invoice form can take from a quotation. */
export interface InvoicePrefill {
  series: InvoiceSeries;
  plan: string;
  billingTerm: BillingTerm;
  periodStart: string | null;
  periodEnd: string | null;
  gstRate: number;
  buyer: BuyerSnapshot;
  lines: InvoiceLine[];
  offer: string;
  notes: string;
  /** The quotation this came from, for the heading on the form. */
  fromRef: string;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function invoiceFromProposal(proposal: {
  plan: string;
  ref?: string;
  data: ProposalData;
}): InvoicePrefill {
  const data = proposal?.data ?? ({} as ProposalData);
  const term = asTerm(data.billingTerm);
  const defaultMonths = TERM_MONTHS[term];
  const items = data.lineItems ?? [];

  const lines: InvoiceLine[] = items.map((item) => ({
    label: item?.label ?? "",
    // The quotation's own description box, carried word for word — it is the
    // same box on both documents, so what the client was quoted is what the
    // client is billed.
    description: item?.subLabel ?? "",
    sac: DEFAULT_SAC,
    users: num(item?.users),
    // Each row's OWN period. This is the whole point: two users added nine
    // months from the end are invoiced for nine months, not for the term.
    months: lineMonths(item, defaultMonths),
    rate: num(item?.rate),
  }));

  // The subscription row's dates, when it carries any. Only the first row's:
  // the invoice has ONE period on its face, and rows that disagree with it
  // still each carry their own months, which is what the money is made of.
  const first = items[0];

  const buyer: BuyerSnapshot = {
    name: data.client?.name ?? "",
    address: data.client?.address ?? "",
    // Not on a quotation. The founder fills these in, or the invoice is a
    // non-GST one and they are not needed.
    pincode: "",
    state: "",
    gstStateCode: "",
    gstin: "",
    contactPerson: "",
    phone: "",
    email: "",
  };

  const ref = proposal?.ref ?? data.ref ?? "";

  return {
    // GST off on the quotation means the non-GST book, which is the whole
    // reason that book exists.
    series: data.gstEnabled ? "gst" : "non_gst",
    plan: proposal?.plan ?? "",
    billingTerm: term,
    periodStart: first?.periodStart || null,
    periodEnd: first?.periodEnd || null,
    gstRate: num(data.gstRate),
    buyer,
    lines,
    offer: data.offer ?? "",
    // Traceability without a column: the invoice says which quotation it came
    // from, in the one field that is already printed on it.
    notes: ref ? `Against quotation ${ref}` : "",
    fromRef: ref,
  };
}
