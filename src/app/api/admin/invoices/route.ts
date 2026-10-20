// ============================================================
// Invoice list + create. Founder-only.
//
// requireFounder() on the caller's own session, then the service-role client —
// platform_invoices has RLS with no policies, which is the point.
//
// Creating is where the number is assigned. The unique index on
// (series, fy, seq) is the real guard: a collision is a 23505, retried once.
// Reading max(seq) and adding one is racy in theory and this is a single-user
// module in practice, so the index does the work rather than a lock.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { asTerm } from "@/lib/plans/pricing";
import { todayInIndia } from "@/lib/proposals/today";
import { invoiceColumns, type InvoiceMeta } from "@/lib/invoices/denormalise";
import { financialYear } from "@/lib/invoices/fy";
import { buildInvoiceNo, nextSeq } from "@/lib/invoices/number";
import type { InvoiceData, InvoiceSeries } from "@/lib/invoices/types";

const LIST_COLUMNS =
  "id, invoice_no, series, fy, seq, invoice_date, account_id, customer_id, client_name, " +
  "plan, billing_term, users_billed, period_start, period_end, gst_enabled, gst_rate, " +
  "gst_type, place_of_supply_code, subtotal, discount_amount, taxable_value, cgst_amount, " +
  "sgst_amount, igst_amount, total, amount_received, status, paid_at, created_at, updated_at";

export async function GET() {
  try {
    await requireFounder();

    const { data, error } = await serviceClient()
      .from("platform_invoices")
      .select(LIST_COLUMNS)
      .order("invoice_date", { ascending: false })
      .order("seq", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ invoices: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function isSeries(value: unknown): value is InvoiceSeries {
  return value === "gst" || value === "non_gst";
}

/**
 * The next number in a series, honouring the founder's starting override.
 *
 * Exported so the edit route can renumber a draft whose series or date changed
 * financial year — an invoice that moves from the GST book to the non-GST one
 * must not keep a number from the book it left.
 */
export async function resolveNumber(
  admin: SupabaseClient,
  series: InvoiceSeries,
  invoiceDate: string,
): Promise<{ fy: string; seq: number; invoiceNo: string }> {
  const fy = financialYear(invoiceDate);

  const { data: last } = await admin
    .from("platform_invoices")
    .select("seq")
    .eq("series", series)
    .eq("fy", fy)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: settings } = await admin
    .from("platform_invoice_settings")
    .select("next_gst_seq_override, next_non_gst_seq_override")
    .eq("id", true)
    .maybeSingle();

  const override =
    series === "gst"
      ? (settings?.next_gst_seq_override ?? null)
      : (settings?.next_non_gst_seq_override ?? null);

  const seq = nextSeq(last?.seq ?? null, override);
  return { fy, seq, invoiceNo: buildInvoiceNo(series, fy, seq) };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const body = (await req.json().catch(() => ({}))) as {
      data?: InvoiceData;
      meta?: Partial<InvoiceMeta>;
    };

    const data = body?.data;
    const meta = body?.meta;

    if (!data?.buyer || !Array.isArray(data?.lines)) {
      return NextResponse.json({ error: "Missing invoice data" }, { status: 400 });
    }

    const series: InvoiceSeries = isSeries(meta?.series) ? meta.series : "gst";
    const invoiceDate = typeof meta?.invoiceDate === "string" ? meta.invoiceDate : todayInIndia();
    const admin = serviceClient();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { fy, seq, invoiceNo } = await resolveNumber(admin, series, invoiceDate);

      const columns = invoiceColumns(data, {
        series,
        fy,
        seq,
        invoiceNo,
        invoiceDate,
        accountId: typeof meta?.accountId === "string" ? meta.accountId : null,
        customerId: typeof meta?.customerId === "string" ? meta.customerId : "",
        plan: typeof meta?.plan === "string" ? meta.plan : "",
        billingTerm: asTerm(meta?.billingTerm),
        periodStart: typeof meta?.periodStart === "string" ? meta.periodStart : null,
        periodEnd: typeof meta?.periodEnd === "string" ? meta.periodEnd : null,
        // A non-GST invoice is exactly "GST off", so the series decides it and
        // the two can never disagree.
        gstEnabled: series === "gst",
        gstRate: Number(meta?.gstRate) || 0,
      });

      const { data: row, error } = await admin
        .from("platform_invoices")
        .insert({ ...columns, status: "draft", created_by: ctx.userId })
        .select("id, invoice_no")
        .single();

      if (!error) return NextResponse.json({ id: row.id, invoice_no: row.invoice_no });

      // 23505 = unique violation. Someone (or another tab) took that number
      // between the read and the insert; read again and try once more.
      if (error.code !== "23505" || attempt === 1) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ error: "Could not assign an invoice number" }, { status: 409 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
