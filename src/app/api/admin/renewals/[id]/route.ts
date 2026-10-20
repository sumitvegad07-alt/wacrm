// ============================================================
// Read / update / delete one subscription. Founder-only, service-role.
//
// The read also returns the history, because the detail panel never wants one
// without the other.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { cleanBody } from "../route";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;
    const admin = serviceClient();

    const { data: subscription, error } = await admin
      .from("platform_subscriptions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const { data: periods } = await admin
      .from("platform_subscription_periods")
      .select("*")
      .eq("subscription_id", id)
      .order("start_date", { ascending: false });

    return NextResponse.json({ subscription, periods: periods ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = cleanBody(body);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const admin = serviceClient();

    // The dates may arrive one at a time, so the ordering check has to compare
    // the patch against what the row already holds — not only against itself.
    const { data: current } = await admin
      .from("platform_subscriptions")
      .select("start_date, end_date")
      .eq("id", id)
      .maybeSingle();

    if (!current) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const start = String(patch.start_date ?? current.start_date);
    const end = String(patch.end_date ?? current.end_date);
    if (end < start) {
      return NextResponse.json(
        { error: "The subscription cannot end before it starts." },
        { status: 400 },
      );
    }

    const { error } = await admin
      .from("platform_subscriptions")
      .update(patch)
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;

    // The history rows go with it: the FK is ON DELETE CASCADE.
    const { error } = await serviceClient()
      .from("platform_subscriptions")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
