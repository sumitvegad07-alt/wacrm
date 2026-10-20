// ============================================================
// Renew one subscription: archive the current period, advance the row.
//
// A thin wrapper over renew_platform_subscription(), because the atomicity is
// the whole point — doing the two writes from here would leave a renewal
// half-done if the second failed, or write history twice on a retry.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { asTerm } from "@/lib/plans/pricing";
import { periodEnd } from "@/lib/renewals/next-period";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireFounder();
    const { id } = await props.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const admin = serviceClient();

    const { data: current } = await admin
      .from("platform_subscriptions")
      .select("plan, billing_term, users, amount, end_date")
      .eq("id", id)
      .maybeSingle();

    if (!current) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const term = asTerm(body?.billing_term ?? current.billing_term);

    const start =
      typeof body?.start_date === "string" && body.start_date.length === 10
        ? body.start_date
        : null;

    if (!start) {
      return NextResponse.json({ error: "A new start date is required" }, { status: 400 });
    }

    const end =
      typeof body?.end_date === "string" && body.end_date.length === 10
        ? body.end_date
        : periodEnd(start, term);

    if (!end) {
      return NextResponse.json({ error: "A new end date is required" }, { status: 400 });
    }
    if (end < start) {
      return NextResponse.json(
        { error: "The new period cannot end before it starts." },
        { status: 400 },
      );
    }

    const { data, error } = await admin.rpc("renew_platform_subscription", {
      p_id: id,
      // Omitted fields keep what the row already had: the SQL coalesces, so a
      // renewal that only moves the dates does not blank the plan or amount.
      p_plan: typeof body?.plan === "string" ? body.plan.trim() : null,
      p_billing_term: term,
      p_users:
        body?.users === undefined ? null : Math.max(0, Math.floor(Number(body.users) || 0)),
      p_amount:
        body?.amount === undefined ? null : Math.max(0, Math.round(Number(body.amount) || 0)),
      p_start_date: start,
      p_end_date: end,
      p_renewed_by: ctx.userId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ subscription: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
