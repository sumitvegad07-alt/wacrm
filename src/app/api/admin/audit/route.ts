import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { analyseAudit, type AuditRow } from "@/lib/admin/alerts";

const MAX_PAGE_SIZE = 200;

/**
 * The superadmin audit trail, with sensitive-access alerts computed over it.
 *
 * Deliberately NOT audited itself: recording "superadmin looked at the audit
 * log" on every page load would bury the entries that matter under noise about
 * reading them. Reading the trail is also the one action that cannot be used to
 * exfiltrate tenant data — the log holds table names and filters, not rows.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperadmin();
    const admin = serviceClient();
    const params = req.nextUrl.searchParams;

    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(params.get("pageSize") ?? 100) || 100),
    );
    const from = (page - 1) * pageSize;

    let query = admin
      .from("superadmin_audit_log")
      .select(
        "id, actor_user_id, actor_email, action, table_name, target_account_id, filters, row_count, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    const actor = params.get("actor");
    if (actor) query = query.eq("actor_user_id", actor);

    const table = params.get("table");
    if (table) query = query.eq("table_name", table);

    const tenant = params.get("tenant");
    if (tenant) query = query.eq("target_account_id", tenant);

    const since = params.get("since");
    if (since) query = query.gte("created_at", since);

    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rows = (data ?? []) as unknown as AuditRow[];

    return NextResponse.json({
      entries: rows,
      // Alerts are computed over the returned page, so they describe what is on
      // screen. A platform-wide sweep detector would need its own scheduled job.
      alerts: analyseAudit(rows),
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
