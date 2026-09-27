// ============================================================
// What OZZO deletes, and when.
//
// The published policy (ozzo.co.in/privacy#retention) says two things:
//   - business data is kept while the account is active;
//   - tracking data is kept one year, then reduced to a summary or a smaller
//     copy, and technical logs are kept 90 days.
//
// This file is the executable version of that promise. It decides *what* is
// eligible; the API route does the deleting. Keeping the decision here, in
// tested TypeScript, is deliberate: the same rules written separately in SQL
// and in TypeScript is exactly the drift the pricing engine already had to be
// rescued from.
//
// The rule that keeps this safe is RETENTION_RULES being a closed list. A table
// is deleted from only if it appears here, and a test pins every business table
// OUT of it — because deleting from `orders` or `payments` would silently
// corrupt every customer's outstanding balance, and `tracking_sessions` is the
// attendance record itself.
// ============================================================

export type RetentionClass = "tracking" | "machine_log" | "activity";

/** Default days per class. The published figures; do not change casually. */
const DAYS: Record<RetentionClass, number> = {
  tracking: 365,
  machine_log: 90,
  activity: 365,
};

/**
 * Classes an account may be given a longer period for.
 *
 * Machine logs are deliberately not on this list: they hold no business
 * content, nobody has ever asked to read one, and letting a customer extend
 * them would grow the database for nothing.
 */
const OVERRIDABLE: ReadonlySet<RetentionClass> = new Set<RetentionClass>(["tracking"]);

export function cutoffFor(cls: RetentionClass, now: Date, overrideDays?: number): Date {
  const days =
    OVERRIDABLE.has(cls) && Number.isFinite(overrideDays) && (overrideDays as number) > 0
      ? (overrideDays as number)
      : DAYS[cls];

  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export interface RetentionRule {
  table: string;
  /** The timestamp column age is measured from. Verified against the schema. */
  dateColumn: string;
  cls: RetentionClass;
  /** Human wording for the founder's preview screen. */
  label: string;
  /**
   * Rows may only be deleted once the day they belong to has been rolled up
   * into `location_daily_summary`. Without this, a failed roll-up followed by a
   * successful delete would lose the day's distance permanently.
   */
  requiresSummary?: boolean;
}

/**
 * Every table the retention job is allowed to touch. Nothing else is eligible.
 *
 * Column names were read from the live schema rather than assumed — several of
 * these use `occurred_at` or `recorded_at` rather than `created_at`, and a
 * wrong column here would either delete nothing or delete the wrong rows.
 */
export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    table: "location_pings",
    dateColumn: "recorded_at",
    cls: "tracking",
    label: "GPS location points",
    requiresSummary: true,
  },
  {
    table: "tracking_events",
    dateColumn: "recorded_at",
    cls: "tracking",
    label: "Tracking events",
  },
  {
    table: "device_health_snapshots",
    dateColumn: "recorded_at",
    cls: "machine_log",
    label: "Device health snapshots",
  },
  {
    table: "automation_events",
    dateColumn: "occurred_at",
    cls: "machine_log",
    label: "Automation events",
  },
  {
    table: "automation_event_deliveries",
    dateColumn: "created_at",
    cls: "machine_log",
    label: "Automation deliveries",
  },
  {
    table: "automation_logs",
    dateColumn: "created_at",
    cls: "machine_log",
    label: "Automation logs",
  },
  {
    table: "notification_outbox",
    dateColumn: "occurred_at",
    cls: "machine_log",
    label: "Sent notification records",
  },
  {
    table: "impl_analytics_events",
    dateColumn: "created_at",
    cls: "machine_log",
    label: "Onboarding analytics",
  },
  {
    table: "import_row_map",
    dateColumn: "created_at",
    cls: "machine_log",
    label: "Import row mappings",
  },
  {
    table: "module_activities",
    dateColumn: "created_at",
    cls: "activity",
    label: "Activity log",
  },
] as const;

export interface RetentionJob extends RetentionRule {
  cutoff: Date;
}

/** Every rule with its cutoff resolved for a given day and account setting. */
export function retentionPlan(now: Date, overrideDays?: number): RetentionJob[] {
  return RETENTION_RULES.map((rule) => ({
    ...rule,
    cutoff: cutoffFor(rule.cls, now, overrideDays),
  }));
}
