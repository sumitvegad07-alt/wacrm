// ============================================================
// Proposal list + create. Founder-only.
//
// Every handler here follows the superadmin panel's rule: authorise on the
// caller's own session with requireFounder(), and only then touch the
// service-role client. platform_proposals has RLS enabled with no policies, so
// the service role is the only way in — which is the point.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { getTemplate } from "@/lib/proposals/registry";
import { computeTotals } from "@/lib/proposals/totals";
import { buildRef } from "@/lib/proposals/ref";
import { todayInIndia } from "@/lib/proposals/today";
import type { ProposalData } from "@/lib/proposals/types";

const LIST_COLUMNS =
  "id, ref, plan, client_name, proposal_date, users_total, annual_total, grand_total, " +
  "gst_enabled, status, sent_at, decided_at, updated_at";

export async function GET() {
  try {
    await requireFounder();
    const admin = serviceClient();

    const { data, error } = await admin
      .from("platform_proposals")
      .select(LIST_COLUMNS)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ proposals: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Creates a draft. With no body, the plan's defaults; with `data`, a duplicate
 * of an existing proposal — which always gets a fresh reference and today's
 * date, so a clone can never go out still carrying last year's number.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const body = await req.json().catch(() => ({}));

    const plan = typeof body?.plan === "string" ? body.plan : "SFA";
    const template = getTemplate(plan);
    if (!template) {
      return NextResponse.json({ error: `No proposal template for plan "${plan}"` }, { status: 400 });
    }

    const today = todayInIndia();
    const source = (body?.data ?? null) as ProposalData | null;
    const data: ProposalData = source
      ? { ...source, proposalDate: today, ref: "" }
      : template.defaults(today);

    const admin = serviceClient();

    // Sequence is per calendar month, matching the OZZO/YYYY/MM/XXX-NN shape.
    const { count } = await admin
      .from("platform_proposals")
      .select("id", { count: "exact", head: true })
      .gte("proposal_date", `${today.slice(0, 7)}-01`)
      .lte("proposal_date", `${today.slice(0, 7)}-31`);

    data.ref = buildRef(data.client?.name ?? "", today, (count ?? 0) + 1);

    const { data: row, error } = await admin
      .from("platform_proposals")
      .insert({ ...denormalise(data, plan), created_by: ctx.userId })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ id: row.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * The columns the history list reads are derived from the payload on every
 * write, so "what did I quote them" never needs to parse JSONB — and can never
 * disagree with the document.
 */
export function denormalise(data: ProposalData, plan: string) {
  const totals = computeTotals(data.lineItems ?? [], {
    gstEnabled: !!data.gstEnabled,
    gstRate: Number(data.gstRate) || 0,
  });

  return {
    ref: data.ref ?? "",
    plan,
    client_name: data.client?.name ?? "",
    proposal_date: data.proposalDate,
    gst_enabled: !!data.gstEnabled,
    users_total: totals.usersTotal,
    annual_total: totals.subtotal,
    grand_total: totals.grandTotal,
    data,
  };
}
