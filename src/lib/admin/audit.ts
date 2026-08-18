// ============================================================
// Audit trail for cross-tenant superadmin access.
//
// The data browser can read any tenant's rows, so every read is recorded:
// who, which table, which filters, which tenant, when, and how many rows came
// back. Writes go through the service-role client, and `superadmin_audit_log`
// has no INSERT/UPDATE/DELETE policy, so an actor cannot edit their own trail.
//
// Logging is best-effort by design: an audit write failing must not take the
// panel down, but it is logged loudly server-side so the gap is visible.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuperadminContext } from "@/lib/auth/superadmin";

export interface AuditEntry {
  action: string;
  table?: string;
  /** Tenant whose data was read. Omit for reads that span tenants. */
  targetAccountId?: string | null;
  filters?: Record<string, unknown>;
  rowCount?: number;
}

export async function recordAdminAccess(
  admin: SupabaseClient,
  ctx: SuperadminContext,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await admin.from("superadmin_audit_log").insert({
    actor_user_id: ctx.userId,
    actor_email: ctx.email,
    action: entry.action,
    table_name: entry.table ?? null,
    target_account_id: entry.targetAccountId ?? null,
    filters: entry.filters ?? {},
    row_count: entry.rowCount ?? null,
  });

  if (error) {
    console.error("[superadmin-audit] failed to record access", {
      actor: ctx.userId,
      action: entry.action,
      table: entry.table,
      error: error.message,
    });
  }
}
