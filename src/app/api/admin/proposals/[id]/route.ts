// ============================================================
// Read / update / delete one proposal. Founder-only, service-role, same rule
// as the list route.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { getTemplate } from "@/lib/proposals/registry";
import { isProposalStatus, statusPatch } from "@/lib/proposals/status";
import { denormalise } from "../route";
import type { ProposalData } from "@/lib/proposals/types";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;

    const { data, error } = await serviceClient()
      .from("platform_proposals")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

    return NextResponse.json({ proposal: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;
    const body = await req.json().catch(() => ({}));

    // A status change is its own kind of write: it stamps the timestamps the
    // forecast depends on and must never be mixed with a content edit, or a
    // later edit would quietly move the month a deal was booked in.
    if (body?.status !== undefined) {
      if (!isProposalStatus(body.status)) {
        return NextResponse.json({ error: `Unknown status "${body.status}"` }, { status: 400 });
      }

      const admin = serviceClient();
      const { data: current } = await admin
        .from("platform_proposals")
        .select("sent_at")
        .eq("id", id)
        .maybeSingle();

      const { error: statusError } = await admin
        .from("platform_proposals")
        .update(statusPatch(body.status, current ?? {}))
        .eq("id", id);

      if (statusError) {
        return NextResponse.json({ error: statusError.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    const plan = typeof body?.plan === "string" ? body.plan : "SFA";
    if (!getTemplate(plan)) {
      return NextResponse.json({ error: `No proposal template for plan "${plan}"` }, { status: 400 });
    }
    if (!body?.data) {
      return NextResponse.json({ error: "Missing proposal data" }, { status: 400 });
    }

    const { error } = await serviceClient()
      .from("platform_proposals")
      .update(denormalise(body.data as ProposalData, plan))
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

    const { error } = await serviceClient().from("platform_proposals").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
