"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from "recharts";
import {
  MapPin,
  UserPlus,
  Footprints,
  UserCheck,
  GitBranch,
  FileText,
  DollarSign,
  Receipt,
  BadgeCheck,
  UserX,
  BarChart3,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { getCrmAnalytics } from "@/app/actions/crm-analytics";
import type { CrmAnalytics, FunnelStage, Slice } from "@/lib/dashboard/crm-analytics-types";
import { FREQUENCY_LABEL, PERIOD_LABEL, type Frequency } from "@/lib/dashboard/analytics-period";
import { CHART, tooltipStyle, FrequencyTabs, ChartCard, EmptyChart, AnalyticsError, TopList } from "./analytics-ui";

const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#ef4444", "#64748b", "#14b8a6", "#f97316"];

export function CrmAnalytics() {
  const { defaultCurrency, isModuleEnabled } = useAuth();
  const expenseOn = isModuleEnabled("expense");
  const [freq, setFreq] = useState<Frequency>("monthly");
  const [data, setData] = useState<CrmAnalytics | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  const load = useCallback((f: Frequency) => {
    let alive = true;
    setFailed(false);
    startTransition(() => {
      void getCrmAnalytics(f)
        .then((d) => {
          if (!alive) return;
          if (d) setData(d);
          else setFailed(true);
        })
        .catch((err) => {
          console.warn("[dashboard/crm-analytics] load failed:", err?.message ?? err);
          if (alive) setFailed(true);
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(freq), [freq, load]);

  const money = (n: number) => formatCurrency(n, defaultCurrency);
  const periodLabel = PERIOD_LABEL[freq];
  const loading = !data && !failed;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">CRM Analytics</h3>
        </div>
        <FrequencyTabs value={freq} onChange={setFreq} />
      </div>

      {failed ? (
        <AnalyticsError onRetry={() => load(freq)} />
      ) : (
        <>
          {/* KPI tiles (#1) */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{periodLabel}</p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {loading || !data ? (
                Array.from({ length: expenseOn ? 10 : 8 }).map((_, i) => <SkeletonCard key={i} />)
              ) : (
                <>
                  <MetricCard title="Lead Visits" value={data.kpis.leadVisits.toLocaleString()} icon={MapPin} />
                  <MetricCard title="New Leads Generated" value={data.kpis.newLeads.toLocaleString()} icon={UserPlus} />
                  <MetricCard title="Unique Lead Visits" value={data.kpis.uniqueLeadVisits.toLocaleString()} icon={Footprints} />
                  <MetricCard title="Converted from Lead" value={data.kpis.convertedFromLead.toLocaleString()} icon={UserCheck} />
                  <MetricCard title="New Deals Generated" value={data.kpis.newDeals.toLocaleString()} icon={GitBranch} />
                  <MetricCard title="Sales Quotations" value={data.kpis.quotations.toLocaleString()} icon={FileText} />
                  <MetricCard title="Total Deal Value" value={money(data.kpis.dealValue)} icon={DollarSign} />
                  {expenseOn && (
                    <MetricCard title="Expense Claimed" value={money(data.kpis.expenseClaimed)} icon={Receipt} />
                  )}
                  {expenseOn && (
                    <MetricCard title="Expense Approved" value={money(data.kpis.expenseApproved)} icon={BadgeCheck} />
                  )}
                  <MetricCard
                    title="Neglected Leads"
                    value={data.kpis.neglectedLeads.toLocaleString()}
                    icon={UserX}
                    className={data.kpis.neglectedLeads > 0 ? "border-red-500/20" : ""}
                  />
                </>
              )}
            </div>
          </div>

          {/* New customer acquisition trend (#7) */}
          <ChartCard title="New Customer Acquisition" subtitle={`By ${FREQUENCY_LABEL[freq].toLowerCase()} period`} loading={loading}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data?.newCustomerSeries ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="text-muted-foreground" width={40} />
                <Tooltip formatter={(v) => `${Number(v).toLocaleString()} new`} {...tooltipStyle} />
                <Bar dataKey="value" name="New customers" fill={CHART.customer} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Leads by status (#2) + Lead by source (#4) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Leads by Status" subtitle={periodLabel} loading={loading}>
              <Donut items={data?.leadsByStatus} />
            </ChartCard>
            <ChartCard title="Leads by Source" subtitle={periodLabel} loading={loading}>
              <Donut items={data?.leadsBySource} />
            </ChartCard>
          </div>

          {/* Lead journey (#3) + Deal journey (#6) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Lead Journey" subtitle={`Lead → customer → deal · ${periodLabel}`} loading={loading}>
              <FunnelBars items={data?.leadJourney} />
            </ChartCard>
            <ChartCard title="Deal Journey" subtitle="Open deals across pipeline stages" loading={loading}>
              <FunnelBars items={data?.dealJourney} />
            </ChartCard>
          </div>

          {/* Top 5 users by lead assigned (#5) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Top 5 Users by Leads Assigned" subtitle={periodLabel} loading={loading}>
              <TopList
                items={data?.topUsersByLead}
                primaryFormat={(v) => `${v.toLocaleString()} leads`}
              />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

/** A donut with an inline legend for a name/value breakdown. */
function Donut({ items }: { items?: Slice[] }) {
  if (!items || items.length === 0) return <EmptyChart label="No data in this period" />;
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="55%" height={220}>
        <PieChart>
          <Pie data={items} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
            {items.map((s, i) => (
              <Cell key={s.name} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v, n) => [Number(v).toLocaleString(), String(n)]} {...tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1.5">
        {items.map((s, i) => (
          <div key={s.name} className="flex items-center justify-between text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="ml-2 shrink-0 font-medium tabular-nums text-foreground">{s.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A vertical funnel rendered as proportional horizontal bars. */
function FunnelBars({ items }: { items?: FunnelStage[] }) {
  if (!items || items.length === 0) return <EmptyChart label="No data in this period" />;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-3 py-2">
      {items.map((s, i) => (
        <div key={s.stage} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{s.stage}</span>
            <span className="font-medium tabular-nums text-foreground">{s.value.toLocaleString()}</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${(s.value / max) * 100}%`, background: s.color || PALETTE[i % PALETTE.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
