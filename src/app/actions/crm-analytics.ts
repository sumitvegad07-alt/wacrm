"use server";

import { createClient } from "@/lib/supabase/server";
import {
  type Frequency,
  currentPeriodRange,
  trendRange,
  foldIntoBuckets,
} from "@/lib/dashboard/analytics-period";
import type { CrmAnalytics, Slice } from "@/lib/dashboard/crm-analytics-types";
import { runReport, num, str } from "@/lib/dashboard/report-rpc";

// ------------------------------------------------------------
// CRM analytics — lead / deal / quotation / expense matrices, all under the
// caller's RLS via execute_report (lead, deal, quotation, expense, visit
// modules). Neglected leads and the deal-stage funnel are current-state
// snapshots (direct reads); everything else follows the frequency lens.
// ------------------------------------------------------------

const DEAL_STAGE_PALETTE = ["#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#64748b"];

export async function getCrmAnalytics(freq: Frequency): Promise<CrmAnalytics | null> {
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
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    leadTotals,
    visitTotals,
    dealTotals,
    dealsByStatus,
    quotationTotals,
    expenseTotals,
    leadsByStatusRows,
    leadsBySourceRows,
    topUsers,
    stagesRes,
    openDealsRes,
    neglectedRes,
    newCustTrendRows,
  ] = await Promise.all([
    runReport(supabase, accountId, "lead", [], ["lead_count", "converted_count"], curFilter),
    runReport(supabase, accountId, "visit", [], ["lead_visit_count", "unique_lead_count"], curFilter),
    runReport(supabase, accountId, "deal", [], ["deal_count", "net_amount"], curFilter),
    runReport(supabase, accountId, "deal", ["status"], ["deal_count"], curFilter),
    runReport(supabase, accountId, "quotation", [], ["quotation_count"], curFilter),
    runReport(supabase, accountId, "expense", [], ["claimed_amount", "approved_amount"], curFilter),
    runReport(supabase, accountId, "lead", ["status"], ["lead_count"], curFilter, "lead_count"),
    runReport(supabase, accountId, "lead", ["source"], ["lead_count"], curFilter, "lead_count"),
    runReport(supabase, accountId, "lead", ["user"], ["lead_count"], curFilter, "lead_count", 5),
    // Deal-stage funnel (current pipeline snapshot) — ordered by stage position
    supabase
      .from("pipeline_stages")
      .select("id, name, color, position")
      .eq("account_id", accountId)
      .order("position"),
    supabase.from("deals").select("stage_id, status").eq("account_id", accountId).eq("status", "open"),
    // Neglected leads — stale > 7 days (current-state snapshot)
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .lt("updated_at", sevenDaysAgo.toISOString()),
    // New customer acquisition trend — contacts created across the trailing window
    supabase
      .from("contacts")
      .select("created_at")
      .eq("account_id", accountId)
      .gte("created_at", `${trend.start_date}T00:00:00`),
  ]);

  const toSlices = (rows: Record<string, unknown>[], dim: string): Slice[] =>
    rows
      .map((r) => ({ name: str(r[dim]) || "Unknown", value: num(r.lead_count) }))
      .filter((s) => s.value > 0);

  const lTot = leadTotals[0] ?? {};
  const vTot = visitTotals[0] ?? {};
  const dTot = dealTotals[0] ?? {};
  const qTot = quotationTotals[0] ?? {};
  const eTot = expenseTotals[0] ?? {};

  const newLeads = num(lTot.lead_count);
  const convertedFromLead = num(lTot.converted_count);
  const newDeals = num(dTot.deal_count);
  const wonDeals = num(
    dealsByStatus.find((r) => str(r.status).toLowerCase() === "won")?.deal_count,
  );

  // Deal-stage funnel — count open deals per stage, keep stage order by position.
  const stages = (stagesRes.data ?? []) as { id: string; name: string; color: string | null; position: number }[];
  const dealsByStage = new Map<string, number>();
  for (const d of (openDealsRes.data ?? []) as { stage_id: string | null }[]) {
    if (!d.stage_id) continue;
    dealsByStage.set(d.stage_id, (dealsByStage.get(d.stage_id) ?? 0) + 1);
  }
  const dealJourney = stages
    .map((s, i) => ({
      stage: s.name,
      value: dealsByStage.get(s.id) ?? 0,
      color: s.color || DEAL_STAGE_PALETTE[i % DEAL_STAGE_PALETTE.length],
    }))
    .filter((s) => s.value > 0);

  const newCustomerSeries = foldIntoBuckets(
    ((newCustTrendRows.data ?? []) as { created_at: string }[]).map((c) => ({
      date: str(c.created_at),
      value: 1,
    })),
    freq,
  );

  return {
    freq,
    kpis: {
      leadVisits: num(vTot.lead_visit_count),
      newLeads,
      uniqueLeadVisits: num(vTot.unique_lead_count),
      convertedFromLead,
      newDeals,
      quotations: num(qTot.quotation_count),
      dealValue: num(dTot.net_amount),
      expenseClaimed: num(eTot.claimed_amount),
      expenseApproved: num(eTot.approved_amount),
      neglectedLeads: neglectedRes.count ?? 0,
    },
    leadsByStatus: toSlices(leadsByStatusRows, "status"),
    leadsBySource: toSlices(leadsBySourceRows, "source"),
    leadJourney: [
      { stage: "New Leads", value: newLeads },
      { stage: "Converted", value: convertedFromLead },
      { stage: "New Deals", value: newDeals },
      { stage: "Won Deals", value: wonDeals },
    ].filter((s) => s.value > 0),
    dealJourney,
    newCustomerSeries,
    topUsersByLead: topUsers.map((r) => ({
      name: str(r.user) || "Unassigned",
      value: num(r.lead_count),
    })),
  };
}
