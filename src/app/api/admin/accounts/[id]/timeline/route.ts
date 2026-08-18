import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";

/**
 * Chronological history for one tenant.
 *
 * Assembled from records that already exist rather than from a new event log.
 * That matters: a fresh event table would have started empty today and been
 * useless for exactly the question this answers — "something broke yesterday,
 * what changed?" — until enough time had passed. Reading existing history means
 * it is correct back to the tenant's creation on day one.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const { id } = await params;

    const { data, error } = await admin.rpc("admin_account_timeline", {
      p_account_id: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAccess(admin, ctx, {
      action: "view_account_timeline",
      table: "accounts",
      targetAccountId: id,
      filters: {},
      rowCount: data?.length ?? 0,
    });

    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
