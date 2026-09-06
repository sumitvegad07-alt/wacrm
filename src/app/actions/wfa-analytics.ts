"use server";

import { createClient } from "@/lib/supabase/server";
import {
  type Frequency,
  currentPeriodRange,
  trendRange,
  foldIntoBuckets,
} from "@/lib/dashboard/analytics-period";
import type { WfaAnalytics } from "@/lib/dashboard/wfa-analytics-types";
import { runReport, num, str } from "@/lib/dashboard/report-rpc";

// ------------------------------------------------------------
// WFA (Workforce) analytics — the field-activity matrices carried over from
// the SFA set: customer visits, productive visits, and new customers by
// period, plus a top-field-agent leaderboard. Visits go through the `visit`
// report module (execute_report, SECURITY INVOKER → respects the caller's
// RLS/scope); new customers are a direct contacts read. Same frequency lens
// as the Sales analytics.
// ------------------------------------------------------------

export async function getWfaAnalytics(freq: Frequency): Promise<WfaAnalytics | null> {
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

  const [visitTotals, visitTrend, topAgents, newCustCurrent, newCustTrendRows] = await Promise.all([
    // KPI totals for the current period
    runReport(
      supabase,
      accountId,
      "visit",
      [],
      ["visit_count", "customer_visit_count", "unique_customer_count", "productive_visit_count"],
      curFilter,
    ),
    // Trend — visits by day across the trailing window (total, productive, customer)
    runReport(
      supabase,
      accountId,
      "visit",
      ["date"],
      ["visit_count", "productive_visit_count", "customer_visit_count"],
      trendFilter,
    ),
    // Top 5 field agents by visits (current period)
    runReport(supabase, accountId, "visit", ["user"], ["visit_count", "customer_visit_count"], curFilter, "visit_count", 5),
    // New customers generated — contacts created in the current period
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("created_at", `${current.start_date}T00:00:00`)
      .lte("created_at", `${current.end_date}T23:59:59`),
    // New customers trend — contacts created across the trailing window
    supabase
      .from("contacts")
      .select("created_at")
      .eq("account_id", accountId)
      .gte("created_at", `${trend.start_date}T00:00:00`),
  ]);

  const customerVisitSeries = foldIntoBuckets(
    visitTrend.map((r) => ({ date: str(r.date), value: num(r.customer_visit_count) })),
    freq,
  );
  const totalSeries = foldIntoBuckets(
    visitTrend.map((r) => ({ date: str(r.date), value: num(r.visit_count) })),
    freq,
  );
  const productiveSeries = foldIntoBuckets(
    visitTrend.map((r) => ({ date: str(r.date), value: num(r.productive_visit_count) })),
    freq,
  );
  const visitProductivity = totalSeries.map((b, i) => ({
    key: b.key,
    label: b.label,
    total: b.value,
    productive: productiveSeries[i]?.value ?? 0,
  }));

  const newCustomerSeries = foldIntoBuckets(
    ((newCustTrendRows.data ?? []) as { created_at: string }[]).map((c) => ({
      date: str(c.created_at),
      value: 1,
    })),
    freq,
  );

  const vTot = visitTotals[0] ?? {};

  return {
    freq,
    kpis: {
      customerVisits: num(vTot.customer_visit_count),
      uniqueCustomerVisits: num(vTot.unique_customer_count),
      productiveVisits: num(vTot.productive_visit_count),
      totalVisits: num(vTot.visit_count),
      newCustomers: newCustCurrent.count ?? 0,
    },
    customerVisitSeries,
    newCustomerSeries,
    visitProductivity,
    topAgents: topAgents.map((r) => ({
      name: str(r.user) || "Unassigned",
      value: num(r.visit_count),
      secondary: num(r.customer_visit_count),
    })),
  };
}
