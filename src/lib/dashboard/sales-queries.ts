import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  startOfAccountDay,
  startOfAccountMonth,
} from "./date-utils";
import { callAggregateRpc, num } from "./aggregate-rpc";
import type { DataScope } from "@/hooks/use-data-scope";

// ------------------------------------------------------------
// Sales (SFA line) dashboard metrics — the "money moved today" view.
// Collections / outstanding / overdue / credit live in the existing
// self-fetching payment-widgets; this file covers the order side
// (orders placed, month-to-date value, pending dispatch).
//
// orders.user_id is a pure-directional column, so when the caller passes
// a DataScope we hard-filter it — a manager sees their team's orders, a
// rep only their own — matching the Orders list. RLS is the real
// boundary underneath; this is defense-in-depth + correct empty states.
//
// The totals are summed by `dashboard_sales_metrics` in the database. They
// used to be summed here, over rows fetched with no range: PostgREST stops
// at 1,000 and reports nothing, so a busy tenant's "Sales This Month" was
// quietly short by however many orders came after the thousandth. The day and
// month boundaries also used to come from the viewer's own laptop clock; they
// now come from the account's timezone, which is the house rule and what the
// reports already do. See aggregate-rpc.ts for why the old path is kept.
// ------------------------------------------------------------

type DB = SupabaseClient;

/** Statuses that represent a live/booked order — Cancelled & Rejected never count toward value. */
const VALUE_STATUSES = ["Pending", "Approved", "Part Dispatch", "Dispatched", "Closed"];
/** An order is "pending dispatch" until every line has shipped. */
const PENDING_DISPATCH_STATUSES = ["Approved", "Part Dispatch"];

export interface SalesMetrics {
  ordersTodayCount: number;
  ordersTodayValue: number;
  ordersMonthValue: number;
  pendingDispatchCount: number;
}

const EMPTY: SalesMetrics = {
  ordersTodayCount: 0,
  ordersTodayValue: 0,
  ordersMonthValue: 0,
  pendingDispatchCount: 0,
};

interface SalesMetricsRow {
  orders_today_count: number | string | null;
  orders_today_value: number | string | null;
  orders_month_value: number | string | null;
  pending_dispatch_count: number | string | null;
}

/**
 * `timezone` is the account's IANA zone (read with `accountTimezone(account.settings)`).
 * The RPC resolves the account's own boundaries itself and ignores it; it is
 * used only by the pre-migration fallback below, so that path lands on the
 * same instant the RPC would rather than disagreeing with it by 5.5 hours.
 */
export async function loadSalesMetrics(
  db: DB,
  accountId: string,
  scope?: DataScope,
  timezone: string = DEFAULT_ACCOUNT_TIMEZONE,
): Promise<SalesMetrics> {
  if (!accountId) return { ...EMPTY };

  // NULL means unrestricted. An empty visible set must stay an empty set —
  // sending NULL there would widen a rep to the whole account.
  const userIds = scope && !scope.unrestricted ? scope.userIds : null;

  const rpc = await callAggregateRpc<SalesMetricsRow>(db, "dashboard_sales_metrics", {
    p_account_id: accountId,
    p_value_statuses: VALUE_STATUSES,
    p_pending_dispatch_statuses: PENDING_DISPATCH_STATUSES,
    p_user_ids: userIds,
  });

  if (rpc.ok) {
    return {
      ordersTodayCount: num(rpc.data.orders_today_count),
      ordersTodayValue: num(rpc.data.orders_today_value),
      ordersMonthValue: num(rpc.data.orders_month_value),
      pendingDispatchCount: num(rpc.data.pending_dispatch_count),
    };
  }

  return loadSalesMetricsLegacy(db, accountId, scope, timezone);
}

/**
 * The original client-side implementation, kept as the fallback for the window
 * between this deploying and the migration being applied.
 *
 * It truncates at 1,000 orders. That is not fixable from the client — there is
 * no aggregate to ask for and paging every order of a busy account to add up
 * four numbers would be slower than the tile is worth. The console warning in
 * aggregate-rpc.ts says so out loud while this path is in use.
 */
async function loadSalesMetricsLegacy(
  db: DB,
  accountId: string,
  scope: DataScope | undefined,
  timezone: string,
): Promise<SalesMetrics> {
  const todayStart = startOfAccountDay(timezone).toISOString();
  const monthStart = startOfAccountMonth(timezone).toISOString();

  const scoped = <T>(q: T): T => (scope ? scope.apply(q, "user_id") : q);

  let todayQuery = db
    .from("orders")
    .select("total_amount, status")
    .eq("account_id", accountId)
    .gte("created_at", todayStart);
  todayQuery = scoped(todayQuery);

  let monthQuery = db
    .from("orders")
    .select("total_amount, status")
    .eq("account_id", accountId)
    .gte("created_at", monthStart);
  monthQuery = scoped(monthQuery);

  let dispatchQuery = db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .in("status", PENDING_DISPATCH_STATUSES);
  dispatchQuery = scoped(dispatchQuery);

  const [todayRes, monthRes, dispatchRes] = await Promise.all([
    todayQuery,
    monthQuery,
    dispatchQuery,
  ]);

  const todayRows = ((todayRes.data ?? []) as { total_amount: number | null; status: string }[])
    .filter((o) => VALUE_STATUSES.includes(o.status));
  const monthRows = ((monthRes.data ?? []) as { total_amount: number | null; status: string }[])
    .filter((o) => VALUE_STATUSES.includes(o.status));

  return {
    ordersTodayCount: todayRows.length,
    ordersTodayValue: todayRows.reduce((s, o) => s + (o.total_amount ?? 0), 0),
    ordersMonthValue: monthRows.reduce((s, o) => s + (o.total_amount ?? 0), 0),
    pendingDispatchCount: dispatchRes.count ?? 0,
  };
}
