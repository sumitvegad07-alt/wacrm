"use server";

import { createClient } from "@/lib/supabase/server";
import {
  type Frequency,
  currentPeriodRange,
  trendRange,
  foldIntoBuckets,
} from "@/lib/dashboard/analytics-period";
import { ORDER_STATUSES } from "@/lib/orders/statuses";
import type { SfaAnalytics, StatusSlice } from "@/lib/dashboard/sfa-analytics-types";
import { runReport, num, str } from "@/lib/dashboard/report-rpc";

// ------------------------------------------------------------
// SFA analytics bundle — every matrix the Sales dashboard needs, in ONE
// server round trip. Orders / sales / products / customers / salespeople go
// through execute_report (SECURITY INVOKER → respects the caller's RLS, so a
// team-scoped manager sees only their team). "Sales" there means status
// 'Closed' dated by dispatch completion — the exact Sales Report definition,
// so the dashboard and the report can never disagree. Payment collection and
// order-by-status are direct reads (no report dimension covers them) and also
// run under the caller's RLS.
// ------------------------------------------------------------

export async function getSfaAnalytics(freq: Frequency): Promise<SfaAnalytics | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const accountId = prof?.account_id as string | undefined;
  if (!accountId) return null;

  const current = currentPeriodRange(freq);
  const trend = trendRange(freq);
  const curFilter = { date_range: current };
  const trendFilter = { date_range: trend };

  const [
    orderTotals,
    salesTotals,
    visitTotals,
    orderTrend,
    salesTrend,
    topUsers,
    topProducts,
    topCustomers,
    paymentRows,
    statusRows,
    newCustomers,
  ] = await Promise.all([
    // KPI grand totals — orders in the current period
    runReport(supabase, accountId, "order", [], ["order_count", "net_amount", "customer_count"], curFilter),
    // KPI — sales (Closed, dispatch-dated) value in the current period
    runReport(supabase, accountId, "sales", [], ["net_amount"], curFilter),
    // KPI — visits in the current period
    runReport(supabase, accountId, "visit", [], ["customer_visit_count", "unique_customer_count"], curFilter),
    // Trend series — order value by day across the trailing window
    runReport(supabase, accountId, "order", ["date"], ["net_amount"], trendFilter),
    // Trend series — sales value by dispatch day across the trailing window
    runReport(supabase, accountId, "sales", ["date"], ["net_amount"], trendFilter),
    // Top 5 salespeople by order value (current period)
    runReport(supabase, accountId, "order", ["user"], ["net_amount", "order_count"], curFilter, "net_amount", 5),
    // Top 5 products by quantity ordered (current period)
    runReport(supabase, accountId, "order", ["product"], ["product_quantity", "net_amount"], curFilter, "product_quantity", 5),
    // Top 5 customers by order value (current period)
    runReport(supabase, accountId, "order", ["customer"], ["net_amount", "order_count"], curFilter, "net_amount", 5),
    // Payment collection — direct read (status Approved), current period + trend in one pull
    supabase
      .from("payments")
      .select("amount, verified_amount, created_at")
      .eq("account_id", accountId)
      .eq("status", "Approved")
      .gte("created_at", `${trend.start_date}T00:00:00`),
    // Order-by-status — direct read over the current period (no status report dimension)
    supabase
      .from("orders")
      .select("status, total_amount")
      .eq("account_id", accountId)
      .gte("created_at", `${current.start_date}T00:00:00`)
      .lte("created_at", `${current.end_date}T23:59:59`),
    // New customers generated — contacts created in the current period
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("created_at", `${current.start_date}T00:00:00`)
      .lte("created_at", `${current.end_date}T23:59:59`),
  ]);

  // ── Trend series ─────────────────────────────────────────────
  const orderValueSeries = foldIntoBuckets(
    orderTrend.map((r) => ({ date: str(r.date), value: num(r.net_amount) })),
    freq,
  );
  const salesSeries = foldIntoBuckets(
    salesTrend.map((r) => ({ date: str(r.date), value: num(r.net_amount) })),
    freq,
  );
  const paymentRowsData = (paymentRows.data ?? []) as {
    amount: number | null;
    verified_amount: number | null;
    created_at: string;
  }[];
  const paymentSeries = foldIntoBuckets(
    paymentRowsData.map((p) => ({
      date: str(p.created_at),
      value: p.verified_amount ?? p.amount ?? 0,
    })),
    freq,
  );

  const orderVsSales = orderValueSeries.map((b, i) => ({
    key: b.key,
    label: b.label,
    order: b.value,
    sales: salesSeries[i]?.value ?? 0,
  }));

  // ── Order by status (current period) ─────────────────────────
  const statusMap = new Map<string, { count: number; value: number }>();
  for (const s of ORDER_STATUSES) statusMap.set(s, { count: 0, value: 0 });
  for (const r of (statusRows.data ?? []) as { status: string; total_amount: number | null }[]) {
    const row = statusMap.get(r.status) ?? { count: 0, value: 0 };
    row.count += 1;
    row.value += r.total_amount ?? 0;
    statusMap.set(r.status, row);
  }
  const ordersByStatus: StatusSlice[] = [...statusMap.entries()]
    .map(([status, v]) => ({ status, count: v.count, value: v.value }))
    .filter((s) => s.count > 0);

  // ── KPI collection total for the current period (from the same pull) ──
  const curStart = `${current.start_date}`;
  const collectionCurrent = paymentRowsData
    .filter((p) => str(p.created_at).slice(0, 10) >= curStart)
    .reduce((s, p) => s + (p.verified_amount ?? p.amount ?? 0), 0);

  const oTot = orderTotals[0] ?? {};
  const sTot = salesTotals[0] ?? {};
  const vTot = visitTotals[0] ?? {};

  return {
    freq,
    kpis: {
      customerVisits: num(vTot.customer_visit_count),
      newCustomers: newCustomers.count ?? 0,
      salesOrders: num(oTot.order_count),
      orderValue: num(oTot.net_amount),
      salesValue: num(sTot.net_amount),
      uniqueCustomersOrdered: num(oTot.customer_count),
      paymentCollection: collectionCurrent,
      uniqueCustomerVisits: num(vTot.unique_customer_count),
    },
    orderValueSeries,
    salesSeries,
    paymentSeries,
    orderVsSales,
    ordersByStatus,
    topSalespeople: topUsers.map((r) => ({
      name: str(r.user) || "Unassigned",
      value: num(r.net_amount),
      secondary: num(r.order_count),
    })),
    topProducts: topProducts.map((r) => ({
      name: str(r.product) || "—",
      value: num(r.product_quantity),
      secondary: num(r.net_amount),
    })),
    topCustomers: topCustomers.map((r) => ({
      name: str(r.customer) || "—",
      value: num(r.net_amount),
      secondary: num(r.order_count),
    })),
  };
}
