// ============================================================
// Tenant health classification.
//
// The RPC returns raw per-tenant counts; this decides what they mean. Kept as
// pure functions so the thresholds are testable and arguable in one place
// rather than scattered through JSX.
//
// The bias throughout is toward "quietly wrong" over "loudly broken". A tenant
// that logs in but creates nothing, or has an open tracking session that never
// closed, produces no error anywhere — those are exactly the states that go
// unnoticed until renewal.
// ============================================================

export interface TenantHealth {
  account_id: string;
  name: string;
  subscription_plan: string | null;
  subscription_status: string | null;
  created_at: string;
  user_count: number;
  last_login_at: string | null;
  contacts: number;
  orders: number;
  payments: number;
  payments_total: number;
  records_last_7d: number;
  last_ping_at: string | null;
  open_sessions: number;
  last_device_report: string | null;
  failed_automations: number;
  stalled_flows: number;
}

export type SignalLevel = "ok" | "info" | "warn" | "critical";

export interface HealthSignal {
  level: SignalLevel;
  code:
    | "never_activated"
    | "no_users"
    | "dormant"
    | "idle"
    | "gps_stalled"
    | "session_stuck"
    | "automations_failing"
    | "flows_stalled";
  message: string;
}

export const DORMANT_DAYS = 30;
export const GPS_STALL_HOURS = 48;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function ageMs(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : now - t;
}

/**
 * Signals for one tenant. `now` is injected so the thresholds are testable
 * without freezing the system clock.
 */
export function signalsFor(t: TenantHealth, now: number = Date.now()): HealthSignal[] {
  const signals: HealthSignal[] = [];

  // An account row with no profiles is a signup that never completed. It is not
  // "dormant" — nobody was ever there — and conflating the two hides how many
  // registrations are actually failing to convert.
  if (t.user_count === 0) {
    signals.push({
      level: "warn",
      code: "no_users",
      message: "No users — signup never completed",
    });
    return signals;
  }

  const loginAge = ageMs(t.last_login_at, now);

  if (loginAge === null) {
    signals.push({
      level: "warn",
      code: "never_activated",
      message: "Users exist but nobody has ever signed in",
    });
  } else if (loginAge > DORMANT_DAYS * DAY_MS) {
    signals.push({
      level: "critical",
      code: "dormant",
      message: `No login for ${Math.floor(loginAge / DAY_MS)} days`,
    });
  } else if (t.records_last_7d === 0) {
    // Logging in but creating nothing is the churn signal a login date alone
    // conceals.
    signals.push({
      level: "warn",
      code: "idle",
      message: "Signed in recently but created no records in 7 days",
    });
  }

  // Only meaningful for tenants that have ever sent a ping; a tenant not using
  // field tracking should not be flagged for having no GPS.
  const pingAge = ageMs(t.last_ping_at, now);
  if (pingAge !== null && pingAge > GPS_STALL_HOURS * HOUR_MS) {
    signals.push({
      level: "warn",
      code: "gps_stalled",
      message: `No GPS ping for ${Math.floor(pingAge / HOUR_MS)} hours`,
    });
  }

  // A punch-in that never punched out. Distorts attendance and never errors.
  if (t.open_sessions > 0 && pingAge !== null && pingAge > GPS_STALL_HOURS * HOUR_MS) {
    signals.push({
      level: "warn",
      code: "session_stuck",
      message: `${t.open_sessions} tracking session(s) open with no recent pings`,
    });
  }

  if (t.failed_automations > 0) {
    signals.push({
      level: "critical",
      code: "automations_failing",
      message: `${t.failed_automations} automation failure(s) in 7 days`,
    });
  }

  if (t.stalled_flows > 0) {
    signals.push({
      level: "info",
      code: "flows_stalled",
      message: `${t.stalled_flows} flow run(s) stuck over 24h`,
    });
  }

  return signals;
}

const RANK: Record<SignalLevel, number> = { critical: 0, warn: 1, info: 2, ok: 3 };

/** Worst signal level for a tenant, or "ok" when nothing fired. */
export function healthLevel(signals: HealthSignal[]): SignalLevel {
  return signals.reduce<SignalLevel>(
    (worst, s) => (RANK[s.level] < RANK[worst] ? s.level : worst),
    "ok",
  );
}

export interface FleetSummary {
  total: number;
  ok: number;
  info: number;
  warn: number;
  critical: number;
  /** Tenants excluded from commercial metrics because they never activated. */
  inactive: number;
}

export function summarise(
  tenants: TenantHealth[],
  now: number = Date.now(),
): FleetSummary {
  const summary: FleetSummary = {
    total: tenants.length,
    ok: 0,
    info: 0,
    warn: 0,
    critical: 0,
    inactive: 0,
  };

  for (const t of tenants) {
    const level = healthLevel(signalsFor(t, now));
    summary[level] += 1;
    if (t.user_count === 0 || t.last_login_at === null) summary.inactive += 1;
  }

  return summary;
}

/** Sort worst-first, so the tenants needing attention lead the table. */
export function bySeverity(
  tenants: TenantHealth[],
  now: number = Date.now(),
): TenantHealth[] {
  return [...tenants].sort((a, b) => {
    const la = RANK[healthLevel(signalsFor(a, now))];
    const lb = RANK[healthLevel(signalsFor(b, now))];
    if (la !== lb) return la - lb;
    return a.name.localeCompare(b.name);
  });
}
