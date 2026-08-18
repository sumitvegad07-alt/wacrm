// ============================================================
// Which tables the superadmin data browser surfaces, and where.
//
// Every table in `public` is reachable — nothing is blocked. The registry only
// decides *placement*: business tables lead the navigation, infrastructure and
// high-volume machine tables are grouped under "System" and collapsed by
// default so the 95% case isn't buried under log tables.
//
// A table not named here still shows up, under "Other". That matters: new
// tables appear on their own without anyone remembering to edit this file.
// ============================================================

/** Leads the nav. The tables support work actually happens in. */
export const PRIMARY_TABLES = [
  "accounts", // a "company" is an account — there is no separate companies table
  "profiles",
  "contacts",
  "leads",
  "deals",
  "tasks",
  "orders",
  "order_items",
  "quotations",
  "payments",
  "expenses",
  "products",
  "routes",
  "site_visits", // the "visits" table
  "tracking_sessions", // attendance lives here; there is no attendance table
  "leaves",
  "superadmin_audit_log",
] as const;

/**
 * Reachable, but out of the default nav: high-volume machine chatter and
 * internal plumbing. Collapsed under "System", and always findable by search.
 */
export const SYSTEM_TABLES = [
  "location_pings",
  "flow_run_events",
  "flow_runs",
  "flow_nodes",
  "automation_event_deliveries",
  "automation_events",
  "automation_logs",
  "automation_pending_executions",
  "automation_steps",
  "kb_chunks", // the embeddings store
  "kb_documents",
  "messages", // the message log
  "message_reactions",
  "device_health_snapshots",
  "module_activities",
  "pricing_drift_log",
  "member_presence",
  "report_registry_dimensions",
  "report_registry_filters",
  "report_registry_joins",
  "report_registry_measures",
  "broadcast_recipients",
  "quotation_activities",
] as const;

export type TableGroup = "primary" | "system" | "other";

export function groupFor(table: string): TableGroup {
  if ((PRIMARY_TABLES as readonly string[]).includes(table)) return "primary";
  if ((SYSTEM_TABLES as readonly string[]).includes(table)) return "system";
  return "other";
}

/** Primary tables keep their curated order; everything else goes alphabetical. */
export function sortTables(tables: string[]): string[] {
  const rank = (t: string) => {
    const primaryIdx = (PRIMARY_TABLES as readonly string[]).indexOf(t);
    if (primaryIdx !== -1) return [0, primaryIdx] as const;
    return [groupFor(t) === "other" ? 1 : 2, 0] as const;
  };

  return [...tables].sort((a, b) => {
    const [ga, ia] = rank(a);
    const [gb, ib] = rank(b);
    if (ga !== gb) return ga - gb;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

/**
 * Columns never sent to the browser, in any table.
 *
 * `plain_password` on `profiles` stores credentials in clear text. The browser
 * is not the place to fix that, but it is emphatically not going to put them
 * on screen — or into the audit log — on the way past.
 */
export const REDACTED_COLUMNS = new Set([
  "plain_password",
  "password",
  "verify_token",
  "access_token",
  "refresh_token",
  "api_key",
  "key_hash",
  "token_hash",
  "secret",
  "client_secret",
  "encrypted_password",
]);

export function isRedacted(column: string): boolean {
  return REDACTED_COLUMNS.has(column.toLowerCase());
}
