import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfLocalDay } from "./date-utils";
import { computeFilteredDistanceKm } from "@/lib/location/distance";
import type { DataScope } from "@/hooks/use-data-scope";

// ------------------------------------------------------------
// Workforce (WFA line) dashboard metrics — the "who's in the field
// right now" view a manager opens first thing in the morning.
//
// RLS already scopes every query to what the signed-in user may read.
// On top of that, when the caller passes a DataScope (Reporting
// Hierarchy on + a non-bypass role) we hard-filter the pure-directional
// tables (location_pings.user_id, site_visits.user_id, expenses.employee_id)
// so a manager sees only their team and empty states read correctly. Leaves
// stay RLS-authoritative (their RLS OR-s downline + approver visibility, so a
// client `.in()` would subtract legitimate rows — same rule the lists follow).
// ------------------------------------------------------------

type DB = SupabaseClient;

/** Minutes without a ping before an agent counts as "gone dark" rather than active. */
const STALE_AFTER_MIN = 25;

export interface WorkforceMetrics {
  /** Distinct field agents who reported a position today. */
  activeAgents: number;
  /** Of those, how many pinged within the last STALE_AFTER_MIN minutes (still live). */
  liveAgents: number;
  /** Customer check-ins logged today. */
  visitsToday: number;
  /** Trustworthy distance travelled today across all visible agents, in km. */
  distanceKm: number;
  /** Average battery across today's active devices, 0–100. */
  avgBattery: number;
  /** Expense claims awaiting approval (count + total amount). */
  expensesPendingCount: number;
  expensesPendingAmount: number;
  /** Leave requests awaiting approval. */
  leavesPendingCount: number;
}

const EMPTY: WorkforceMetrics = {
  activeAgents: 0,
  liveAgents: 0,
  visitsToday: 0,
  distanceKm: 0,
  avgBattery: 0,
  expensesPendingCount: 0,
  expensesPendingAmount: 0,
  leavesPendingCount: 0,
};

interface PingRow {
  user_id: string;
  battery_pct: number | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  is_mocked: boolean | null;
  recorded_at: string;
}

export async function loadWorkforceMetrics(
  db: DB,
  accountId: string,
  scope?: DataScope,
): Promise<WorkforceMetrics> {
  if (!accountId) return { ...EMPTY };
  const todayStart = startOfLocalDay().toISOString();

  // Today's pings, scoped to the visible team. One fetch powers active-agent
  // count, live count, distance, and battery — the same pattern the Location
  // Tracking overview uses, kept in sync so the numbers agree between screens.
  let pingsQuery = db
    .from("location_pings")
    .select("user_id, battery_pct, lat, lng, accuracy_m, is_mocked, recorded_at")
    .eq("account_id", accountId)
    .gte("recorded_at", todayStart);
  pingsQuery = scope ? scope.apply(pingsQuery, "user_id") : pingsQuery;

  // site_visits is the real table (customer_visits does not exist); it's dated by
  // check_in_at and RLS-scoped via data_scope_allows, so this "today" count is
  // already hierarchy-scoped (rep=own, manager=team, admin=all).
  let visitsQuery = db
    .from("site_visits")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("check_in_at", todayStart);
  visitsQuery = scope ? scope.apply(visitsQuery, "user_id") : visitsQuery;

  let expensesQuery = db
    .from("expenses")
    .select("amount")
    .eq("account_id", accountId)
    .eq("status", "Pending");
  expensesQuery = scope ? scope.apply(expensesQuery, "employee_id", "profile") : expensesQuery;

  const leavesQuery = db
    .from("leaves")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("status", "Pending");

  const [pingsRes, visitsRes, expensesRes, leavesRes] = await Promise.all([
    pingsQuery,
    visitsQuery,
    expensesQuery,
    leavesQuery,
  ]);

  const pings = (pingsRes.data ?? []) as PingRow[];

  // Group by agent so distance sums per person (a single Haversine run across
  // everyone mixed together would draw impossible lines between two people).
  const byUser = new Map<string, PingRow[]>();
  for (const p of pings) {
    const list = byUser.get(p.user_id) ?? [];
    list.push(p);
    byUser.set(p.user_id, list);
  }

  const now = Date.now();
  let distanceKm = 0;
  let liveAgents = 0;
  const batteries: number[] = [];

  for (const userPings of byUser.values()) {
    userPings.sort(
      (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
    );
    // Trustworthy distance — filters low-accuracy pings + impossible jumps.
    distanceKm += computeFilteredDistanceKm(userPings);

    const latest = userPings[userPings.length - 1];
    if (latest.battery_pct !== null) batteries.push(latest.battery_pct);
    const minutesAgo = (now - new Date(latest.recorded_at).getTime()) / 60000;
    if (minutesAgo <= STALE_AFTER_MIN) liveAgents += 1;
  }

  const expenses = (expensesRes.data ?? []) as { amount: number | null }[];

  return {
    activeAgents: byUser.size,
    liveAgents,
    visitsToday: visitsRes.count ?? 0,
    distanceKm: Number(distanceKm.toFixed(1)),
    avgBattery: batteries.length
      ? Math.round(batteries.reduce((a, b) => a + b, 0) / batteries.length)
      : 0,
    expensesPendingCount: expenses.length,
    expensesPendingAmount: expenses.reduce((s, e) => s + (e.amount ?? 0), 0),
    leavesPendingCount: leavesRes.count ?? 0,
  };
}
