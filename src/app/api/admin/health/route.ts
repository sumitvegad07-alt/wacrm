import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";
import { bySeverity, summarise, type TenantHealth } from "@/lib/admin/health";

/**
 * Fleet-wide tenant health.
 *
 * Audited: this reads across every tenant by definition, which is exactly the
 * shape of access the audit trail exists to record. It reports aggregates
 * rather than rows, so `row_count` is the tenant count.
 */
export async function GET() {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();

    const { data, error } = await admin.rpc("admin_tenant_health");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const tenants = ((data ?? []) as TenantHealth[]).map((t) => ({
      ...t,
      // Postgres numerics arrive as strings through PostgREST; the health
      // thresholds compare numerically.
      payments_total: Number(t.payments_total ?? 0),
      user_count: Number(t.user_count ?? 0),
      contacts: Number(t.contacts ?? 0),
      orders: Number(t.orders ?? 0),
      payments: Number(t.payments ?? 0),
      records_last_7d: Number(t.records_last_7d ?? 0),
      open_sessions: Number(t.open_sessions ?? 0),
      failed_automations: Number(t.failed_automations ?? 0),
      stalled_flows: Number(t.stalled_flows ?? 0),
    }));

    await recordAdminAccess(admin, ctx, {
      action: "tenant_health",
      table: "accounts",
      targetAccountId: null,
      filters: {},
      rowCount: tenants.length,
    });

    return NextResponse.json({
      tenants: bySeverity(tenants),
      summary: summarise(tenants),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
