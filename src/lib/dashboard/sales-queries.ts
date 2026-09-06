import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfLocalDay } from "./date-utils";
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

export async function loadSalesMetrics(
  db: DB,
  accountId: string,
  scope?: DataScope,
): Promise<SalesMetrics> {
  if (!accountId) return { ...EMPTY };

  const todayStart = startOfLocalDay().toISOString();
  const monthStart = (() => {
    const d = startOfLocalDay();
    d.setDate(1);
    return d.toISOString();
  })();

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
