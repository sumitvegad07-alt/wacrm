// ============================================================
// Types for OZZO's own invoices.
//
// A stored invoice is one row in `platform_invoices`: denormalised columns the
// list and the books read, plus `data` — the frozen document. Everything in
// `InvoiceData` is a snapshot taken at save time, never a live lookup, because
// an issued invoice must print the same figures and the same addresses forever.
// ============================================================

import type { BillingTerm } from "@/lib/plans/pricing";
import type { GstType } from "@/lib/gst/states";

export type InvoiceSeries = "gst" | "non_gst";

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "part_paid",
  "paid",
  "cancelled",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Human label, as shown in the list and on the detail screen. */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  part_paid: "Part Paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const SERIES_LABEL: Record<InvoiceSeries, string> = {
  gst: "GST",
  non_gst: "Non-GST",
};

/**
 * One row of the invoice's price table.
 *
 * `users`, `months` and `rate` describe a subscription line and multiply out;
 * a one-off charge (setup, training) sets `users: 1`, `months: 1` and puts the
 * whole charge in `rate`. One shape, so `lineAmount()` has one branch.
 */
export interface InvoiceLine {
  label: string;
  description: string;
  /** SAC code. Defaults to 998314 — IT design and development services. */
  sac: string;
  users: number;
  months: number;
  /** Rupees per user per month for a plan line; the whole charge for a one-off. */
  rate: number;
}

/** OZZO's own details, frozen onto the invoice. */
export interface SellerSnapshot {
  firmName: string;
  address: string;
  pincode: string;
  state: string;
  gstStateCode: string;
  gstin: string;
  pan: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccountNo: string;
  ifsc: string;
  upiId: string;
  declaration: string;
  signatureUrl: string | null;
  logoUrl: string | null;
}

/** The customer's details, frozen onto the invoice. */
export interface BuyerSnapshot {
  name: string;
  address: string;
  pincode: string;
  state: string;
  gstStateCode: string;
  gstin: string;
  contactPerson: string;
  phone: string;
  email: string;
}

export interface InvoiceData {
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  lines: InvoiceLine[];
  /** Percent, 0–100. Zero when a flat amount was entered instead. */
  discountPct: number;
  /** Rupees. Used only when `discountPct` is 0. */
  discountAmount: number;
  notes: string;
  terms: string;
  /**
   * The concession being granted on this invoice, in the founder's own words —
   * "2 months free subscription", an extended period, a waived charge.
   *
   * Separate from `notes` on purpose, and printed next to the total rather than
   * down with the terms: an offer is something the client should see, and Notes
   * is where delivery or reference detail goes. Like the quotation's box, it is
   * text only and never touches a figure, so what is owed stays exactly what
   * the lines and tax add up to.
   *
   * Optional: `data` is stored JSONB, and invoices issued before this existed
   * have no such key.
   */
  offer?: string;
}

/** The row as the API returns it. Numeric columns arrive as numbers. */
export interface InvoiceRow {
  id: string;
  invoice_no: string;
  series: InvoiceSeries;
  fy: string;
  seq: number;
  invoice_date: string;
  account_id: string | null;
  customer_id: string;
  client_name: string;
  plan: string;
  billing_term: BillingTerm;
  users_billed: number;
  period_start: string | null;
  period_end: string | null;
  gst_enabled: boolean;
  gst_rate: number;
  gst_type: GstType | null;
  place_of_supply_code: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total: number;
  amount_received: number;
  status: InvoiceStatus;
  paid_at: string | null;
  data: InvoiceData;
  created_at: string;
  updated_at: string;
}

/**
 * The seller settings row as the API returns it — snake_case, straight from
 * Postgres, because the settings form edits the row and the mapping to
 * `SellerSnapshot` happens once, at invoice save time.
 */
export interface InvoiceSettingsRow {
  firm_name: string;
  address: string;
  pincode: string;
  state: string;
  gst_state_code: string;
  gstin: string;
  pan: string;
  phone: string;
  email: string;
  bank_name: string;
  bank_account_no: string;
  ifsc: string;
  upi_id: string;
  declaration: string;
  default_terms: string;
  signature_url: string | null;
  logo_url: string | null;
  next_gst_seq_override: number | null;
  next_non_gst_seq_override: number | null;
}

export const DEFAULT_SAC = "998314";

/** The settings row mapped onto the snapshot that gets frozen on an invoice. */
export function sellerFromSettings(row: InvoiceSettingsRow): SellerSnapshot {
  return {
    firmName: row.firm_name ?? "",
    address: row.address ?? "",
    pincode: row.pincode ?? "",
    state: row.state ?? "",
    gstStateCode: row.gst_state_code ?? "",
    gstin: row.gstin ?? "",
    pan: row.pan ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    bankName: row.bank_name ?? "",
    bankAccountNo: row.bank_account_no ?? "",
    ifsc: row.ifsc ?? "",
    upiId: row.upi_id ?? "",
    declaration: row.declaration ?? "",
    signatureUrl: row.signature_url ?? null,
    logoUrl: row.logo_url ?? null,
  };
}
