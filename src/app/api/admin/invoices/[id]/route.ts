// ============================================================
// Read / edit / status / delete one invoice. Founder-only, service-role.
//
// Two kinds of write, kept strictly apart:
//   - a CONTENT edit, allowed only while the invoice is a draft, and
//   - a STATUS change, which never touches the document.
// Mixing them would let "mark paid" quietly re-price a document a customer has
// already seen.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { asTerm } from "@/lib/plans/pricing";
import { todayInIndia } from "@/lib/proposals/today";
import { invoiceColumns } from "@/lib/invoices/denormalise";
import { canTransition, isEditable, isInvoiceStatus, statusPatch } from "@/lib/invoices/status";
import type { InvoiceData, InvoiceSeries, InvoiceStatus } from "@/lib/invoices/types";
import { resolveNumber } from "../route";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;

    const { data, error } = await serviceClient()
      .from("platform_invoices")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    return NextResponse.json({ invoice: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const admin = serviceClient();

    const { data: current } = await admin
      .from("platform_invoices")
      .select("id, status, total, series, fy, seq, invoice_no, invoice_date, gst_enabled")
      .eq("id", id)
      .maybeSingle();

    if (!current) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    // ---- a status change -------------------------------------------------
    if (body?.status !== undefined) {
      if (!isInvoiceStatus(body.status)) {
        return NextResponse.json({ error: `Unknown status "${body.status}"` }, { status: 400 });
      }

      const from = current.status as InvoiceStatus;
      if (!canTransition(from, body.status)) {
        return NextResponse.json(
          { error: `An invoice that is ${from} cannot become ${body.status}.` },
          { status: 409 },
        );
      }

      // A GST invoice whose place of supply could not be determined would print
      // no tax at all. Refuse to issue it rather than let it out silently.
      if (body.status === "issued" && current.gst_enabled) {
        const { data: full } = await admin
          .from("platform_invoices")
          .select("gst_type")
          .eq("id", id)
          .maybeSingle();

        if (!full?.gst_type || full.gst_type === "unknown") {
          return NextResponse.json(
            {
              error:
                "Cannot issue a GST invoice without a place of supply. Add the customer's GSTIN, or pick their state, then try again.",
            },
            { status: 409 },
          );
        }
      }

      const { error } = await admin
        .from("platform_invoices")
        .update(
          statusPatch(
            body.status,
            Number(body.amount_received) || 0,
            Number(current.total) || 0,
            todayInIndia(),
          ),
        )
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    // ---- a content edit --------------------------------------------------
    if (!isEditable(current.status as InvoiceStatus)) {
      return NextResponse.json(
        {
          error: `Invoice ${current.invoice_no} is ${current.status} and can no longer be edited. Cancel it and raise a new one.`,
        },
        { status: 409 },
      );
    }

    const data = body?.data as InvoiceData | undefined;
    const meta = (body?.meta ?? {}) as Record<string, unknown>;
    if (!data?.buyer || !Array.isArray(data?.lines)) {
      return NextResponse.json({ error: "Missing invoice data" }, { status: 400 });
    }

    const series = (meta.series === "non_gst" ? "non_gst" : "gst") as InvoiceSeries;
    const invoiceDate =
      typeof meta.invoiceDate === "string" ? meta.invoiceDate : (current.invoice_date as string);

    // A draft that changed series or financial year must be renumbered: keeping
    // a number from the book it left would break both books' consecutiveness.
    const needsNewNumber = series !== current.series || invoiceDate !== current.invoice_date;

    const numbering = needsNewNumber
      ? await resolveNumber(admin, series, invoiceDate)
      : {
          fy: current.fy as string,
          seq: current.seq as number,
          invoiceNo: current.invoice_no as string,
        };

    const columns = invoiceColumns(data, {
      series,
      fy: numbering.fy,
      seq: numbering.seq,
      invoiceNo: numbering.invoiceNo,
      invoiceDate,
      accountId: typeof meta.accountId === "string" ? meta.accountId : null,
      customerId: typeof meta.customerId === "string" ? meta.customerId : "",
      plan: typeof meta.plan === "string" ? meta.plan : "",
      billingTerm: asTerm(meta.billingTerm),
      periodStart: typeof meta.periodStart === "string" ? meta.periodStart : null,
      periodEnd: typeof meta.periodEnd === "string" ? meta.periodEnd : null,
      gstEnabled: series === "gst",
      gstRate: Number(meta.gstRate) || 0,
    });

    const { error } = await admin.from("platform_invoices").update(columns).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, invoice_no: numbering.invoiceNo });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;

    // The database trigger refuses this too; checking here is what turns a raw
    // Postgres exception into a sentence the founder can act on.
    const admin = serviceClient();
    const { data: current } = await admin
      .from("platform_invoices")
      .select("status, invoice_no, series")
      .eq("id", id)
      .maybeSingle();

    if (!current) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (current.status !== "draft") {
      return NextResponse.json(
        {
          error: `Invoice ${current.invoice_no} is ${current.status}. Cancel it instead — deleting it would leave a gap in the ${current.series === "gst" ? "GST" : "non-GST"} series.`,
        },
        { status: 409 },
      );
    }

    const { error } = await admin.from("platform_invoices").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
