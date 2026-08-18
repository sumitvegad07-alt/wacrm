import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";

/**
 * Sync + error inspector.
 *
 * GET  — per-tenant queue health, plus the individual records behind it.
 * POST — retry or force-reprocess specific records.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const accountId = req.nextUrl.searchParams.get("accountId");

    const { data: health, error } = await admin.rpc("admin_sync_health");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Individual records: the queue entries a support answer actually needs.
    let eventsQuery = admin
      .from("automation_events")
      .select(
        "id, account_id, module, event_type, record_id, status, attempts, last_error, skip_reason, occurred_at, processed_at",
        { count: "exact" },
      )
      .in("status", ["pending", "failed"])
      .order("occurred_at", { ascending: false })
      .limit(200);

    if (accountId) eventsQuery = eventsQuery.eq("account_id", accountId);

    const { data: events, error: evErr } = await eventsQuery;
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 400 });

    await recordAdminAccess(admin, ctx, {
      action: "view_sync_inspector",
      table: "automation_events",
      targetAccountId: accountId,
      filters: { accountId },
      rowCount: events?.length ?? 0,
    });

    return NextResponse.json({
      health: (health ?? []).map((h: Record<string, unknown>) => ({
        ...h,
        events_pending: Number(h.events_pending ?? 0),
        events_failed: Number(h.events_failed ?? 0),
        events_done: Number(h.events_done ?? 0),
        events_stuck: Number(h.events_stuck ?? 0),
        pending_steps: Number(h.pending_steps ?? 0),
        orders_in_review: Number(h.orders_in_review ?? 0),
        deliveries_failed: Number(h.deliveries_failed ?? 0),
      })),
      events: events ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Retry or force-reprocess queue records.
 *
 * This is a write path, so it is narrow on purpose: it only ever resets an
 * event's dispatch state. It cannot edit the record the event describes, and
 * it cannot touch any other table — deliberately unlike the generic
 * write-any-table repair tool that was rejected.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const { action, eventIds } = await req.json();

    if (action !== "retry" && action !== "force_reprocess") {
      return NextResponse.json(
        { error: "action must be 'retry' or 'force_reprocess'" },
        { status: 400 },
      );
    }
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return NextResponse.json({ error: "eventIds is required" }, { status: 400 });
    }
    if (eventIds.length > 500) {
      return NextResponse.json(
        { error: "Refusing to reprocess more than 500 events at once" },
        { status: 400 },
      );
    }

    // Read first, so the audit entry can name what was actually touched and
    // which tenants were affected.
    const { data: before } = await admin
      .from("automation_events")
      .select("id, account_id, module, event_type, status, attempts")
      .in("id", eventIds);

    if (!before || before.length === 0) {
      return NextResponse.json({ error: "No matching events" }, { status: 404 });
    }

    // retry: clear the error and put it back in the queue, preserving attempts
    // so a repeatedly-failing event stays visible as such.
    // force_reprocess: additionally zero the attempt counter, for events whose
    // failure was environmental rather than about the record itself.
    const patch: Record<string, unknown> = {
      status: "pending",
      last_error: null,
      skip_reason: null,
      processed_at: null,
    };
    if (action === "force_reprocess") patch.attempts = 0;

    const { error } = await admin
      .from("automation_events")
      .update(patch)
      .in("id", eventIds);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const tenants = [...new Set(before.map((e) => e.account_id))];

    await recordAdminAccess(admin, ctx, {
      action: `sync_${action}`,
      table: "automation_events",
      // Only attribute to a single tenant when the batch belonged to one.
      targetAccountId: tenants.length === 1 ? tenants[0] : null,
      filters: {
        eventIds,
        tenants,
        previous: before.map((e) => ({
          id: e.id,
          status: e.status,
          attempts: e.attempts,
        })),
      },
      rowCount: before.length,
    });

    return NextResponse.json({ ok: true, requeued: before.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
