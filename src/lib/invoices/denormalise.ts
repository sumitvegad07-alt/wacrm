// ============================================================
// The payload is the document; these are the columns the list, the filters and
// the outstanding total read. Derived on EVERY write, so "what did I bill them"
// never parses JSONB — and can never disagree with what was printed.
//
// Same pattern as `denormalise()` in /api/admin/proposals/route.ts.
// ============================================================

import { determineGstType, gstStateCodeFromGstin } from "@/lib/gst/states";
import { PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import { asTerm, quote, TERM_MONTHS, type BillingTerm } from "@/lib/plans/pricing";
import { placeOfSupply } from "./tax";
import { invoiceTotals } from "./totals";
import { DEFAULT_SAC, type InvoiceData, type InvoiceLine, type InvoiceSeries } from "./types";

export interface InvoiceMeta {
  series: InvoiceSeries;
  fy: string;
  seq: number;
  invoiceNo: string;
  invoiceDate: string;
  accountId: string | null;
  customerId: string;
  plan: string;
  billingTerm: BillingTerm;
  periodStart: string | null;
  periodEnd: string | null;
  gstEnabled: boolean;
  gstRate: number;
}

/**
 * The subscription line, priced by the shared engine.
 *
 * `quote()` is called with discountPct 0 and gstRate 0 on purpose: it supplies
 * the per-user-per-month rate for the term and nothing else. The discount and
 * all tax belong to `invoiceTotals()`, which sees the extra charge lines too.
 */
export function planLine(
  plan: PlanId,
  users: number,
  term: BillingTerm,
  label?: string,
): InvoiceLine {
  const q = quote({ plan, users, term, discountPct: 0, gstRate: 0 });

  return {
    label: label ?? `OZZO ${PLAN_LABEL[plan]}`,
    description: `Subscription · ${users} user${users === 1 ? "" : "s"} · ${TERM_MONTHS[term]} months`,
    sac: DEFAULT_SAC,
    users: q.usersBilled,
    months: q.months,
    rate: q.ratePerMonth,
  };
}

export function invoiceColumns(
  data: InvoiceData,
  meta: InvoiceMeta,
): Record<string, unknown> {
  const gstEnabled = !!meta.gstEnabled;

  // Supplier state comes from OUR GSTIN; the buyer's place of supply from
  // theirs, or from the state picked when they have none.
  const supplierCode =
    gstStateCodeFromGstin(data.seller?.gstin) || (data.seller?.gstStateCode ?? "") || null;
  const posCode = gstEnabled
    ? placeOfSupply(data.buyer?.gstin ?? "", data.buyer?.state ?? "")
    : null;

  // The CHECK constraint pairs these two: a GST invoice must carry a gst_type,
  // a non-GST invoice must carry none.
  const gstType = gstEnabled ? determineGstType(supplierCode, posCode) : null;

  const totals = invoiceTotals(data.lines ?? [], {
    gstEnabled,
    gstRate: Number(meta.gstRate) || 0,
    gstType,
    discountPct: Number(data.discountPct) || 0,
    discountAmount: Number(data.discountAmount) || 0,
  });

  return {
    invoice_no: meta.invoiceNo,
    series: meta.series,
    fy: meta.fy,
    seq: meta.seq,
    invoice_date: meta.invoiceDate,
    account_id: meta.accountId,
    customer_id: meta.customerId ?? "",
    client_name: data.buyer?.name ?? "",
    plan: meta.plan ?? "",
    billing_term: asTerm(meta.billingTerm),
    // The SUBSCRIPTION line's users, not a sum across lines: a one-off setup
    // charge carrying users 1 would otherwise inflate the seat count.
    users_billed: Number(data.lines?.[0]?.users) || 0,
    period_start: meta.periodStart,
    period_end: meta.periodEnd,
    gst_enabled: gstEnabled,
    gst_rate: Number(meta.gstRate) || 0,
    gst_type: gstType,
    place_of_supply_code: posCode,
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    taxable_value: totals.taxableValue,
    cgst_amount: totals.cgst,
    sgst_amount: totals.sgst,
    igst_amount: totals.igst,
    total: totals.total,
    data,
  };
}
