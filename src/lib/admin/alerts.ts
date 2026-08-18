// ============================================================
// Sensitive-access detection over the superadmin audit log.
//
// The audit log answers "what happened". This answers "which of it should
// someone look at". A superadmin reading one contact row is routine; the same
// superadmin pulling every employee profile across all tenants is not, and the
// difference is only visible if something computes it.
//
// Pure functions over already-fetched rows: no IO here, so the thresholds are
// directly testable and the route stays a thin wrapper.
// ============================================================

/**
 * Tables where a bulk or cross-tenant read is worth surfacing. Personal data,
 * money, and location history — the categories where a leak is not recoverable
 * by changing a password.
 */
export const SENSITIVE_TABLES = new Set([
  "profiles",
  "payments",
  "expenses",
  "tracking_sessions", // attendance
  "location_pings", // GPS history
  "contacts",
  "leads",
  "accounts",
  "api_keys",
  "whatsapp_config",
]);

/** A single read that returned at least this many rows is worth flagging. */
export const BULK_ROW_THRESHOLD = 500;

/** Reads of sensitive tables within the burst window before it counts as a sweep. */
export const SWEEP_COUNT_THRESHOLD = 10;
export const SWEEP_WINDOW_MS = 5 * 60 * 1000;

export type AlertSeverity = "info" | "warning" | "critical";

export interface AuditRow {
  id: string;
  actor_user_id: string;
  actor_email: string | null;
  action: string;
  table_name: string | null;
  target_account_id: string | null;
  row_count: number | null;
  created_at: string;
}

export interface AuditAlert {
  id: string;
  severity: AlertSeverity;
  kind: "bulk_read" | "cross_tenant_sweep" | "burst";
  message: string;
}

/**
 * Flags attached to a single audit row, judged on that row alone.
 *
 * A cross-tenant read of a sensitive table is the one that matters most: it
 * means the superadmin pulled, say, every profile in the platform rather than
 * one tenant's. `target_account_id` is null exactly when no tenant filter was
 * applied, which is why the browser records it that way.
 */
export function alertsForRow(row: AuditRow): AuditAlert[] {
  const alerts: AuditAlert[] = [];
  const table = row.table_name ?? "";
  const sensitive = SENSITIVE_TABLES.has(table);
  const rows = row.row_count ?? 0;

  if (sensitive && row.target_account_id === null && rows > 0) {
    alerts.push({
      id: row.id,
      severity: rows >= BULK_ROW_THRESHOLD ? "critical" : "warning",
      kind: "cross_tenant_sweep",
      message: `Cross-tenant read of ${table} (${rows} rows, no tenant filter)`,
    });
  }

  if (rows >= BULK_ROW_THRESHOLD) {
    alerts.push({
      id: row.id,
      severity: sensitive ? "critical" : "info",
      kind: "bulk_read",
      message: `Bulk read: ${rows} rows from ${table}`,
    });
  }

  return alerts;
}

/**
 * Flags that only exist across rows: one actor hitting sensitive tables many
 * times in a short window. A per-row check cannot see this, because each
 * individual read looks unremarkable.
 *
 * Rows may arrive in any order; this sorts a copy rather than relying on the
 * caller's ordering.
 */
export function burstAlerts(rows: AuditRow[]): AuditAlert[] {
  const byActor = new Map<string, AuditRow[]>();

  for (const row of rows) {
    if (!SENSITIVE_TABLES.has(row.table_name ?? "")) continue;
    const list = byActor.get(row.actor_user_id) ?? [];
    list.push(row);
    byActor.set(row.actor_user_id, list);
  }

  const alerts: AuditAlert[] = [];

  for (const [, actorRows] of byActor) {
    const sorted = [...actorRows].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );

    // Sliding window: for each start index, how far can we reach within the
    // window. Reports at most one burst per actor, anchored at the densest run.
    let best: { count: number; row: AuditRow } | null = null;
    let start = 0;

    for (let end = 0; end < sorted.length; end++) {
      while (
        Date.parse(sorted[end].created_at) - Date.parse(sorted[start].created_at) >
        SWEEP_WINDOW_MS
      ) {
        start++;
      }
      const count = end - start + 1;
      if (!best || count > best.count) best = { count, row: sorted[end] };
    }

    if (best && best.count >= SWEEP_COUNT_THRESHOLD) {
      alerts.push({
        id: best.row.id,
        severity: "warning",
        kind: "burst",
        message: `${best.row.actor_email ?? "superadmin"} read sensitive tables ${best.count} times within ${SWEEP_WINDOW_MS / 60000} minutes`,
      });
    }
  }

  return alerts;
}

/** Every alert for a page of audit rows, most severe first. */
export function analyseAudit(rows: AuditRow[]): AuditAlert[] {
  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...rows.flatMap(alertsForRow), ...burstAlerts(rows)].sort(
    (a, b) => order[a.severity] - order[b.severity],
  );
}
