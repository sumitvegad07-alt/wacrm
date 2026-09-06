"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { MapPin, Footprints, CheckCircle2, UserPlus, BarChart3 } from "lucide-react";
import { getWfaAnalytics } from "@/app/actions/wfa-analytics";
import type { WfaAnalytics } from "@/lib/dashboard/wfa-analytics-types";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { FREQUENCY_LABEL, PERIOD_LABEL, type Frequency } from "@/lib/dashboard/analytics-period";
import {
  CHART,
  tooltipStyle,
  FrequencyTabs,
  ChartCard,
  AnalyticsError,
  TopList,
} from "./analytics-ui";

/**
 * WFA (Workforce) analytics — the field-activity matrices carried over from the
 * Sales dashboard: customer visits, productive visits, and new customers by
 * period, with the same Daily/Monthly/Quarterly/Yearly lens, plus a top
 * field-agent leaderboard. Respects the viewer's data scope (execute_report is
 * RLS-aware).
 */
export function WfaAnalytics() {
  const [freq, setFreq] = useState<Frequency>("monthly");
  const [data, setData] = useState<WfaAnalytics | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  const load = useCallback((f: Frequency) => {
    let alive = true;
    setFailed(false);
    startTransition(() => {
      void getWfaAnalytics(f)
        .then((d) => {
          if (!alive) return;
          if (d) setData(d);
          else setFailed(true);
        })
        .catch((err) => {
          console.warn("[dashboard/wfa-analytics] load failed:", err?.message ?? err);
          if (alive) setFailed(true);
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(freq), [freq, load]);

  const periodLabel = PERIOD_LABEL[freq];
  const loading = !data && !failed;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Field Analytics</h3>
        </div>
        <FrequencyTabs value={freq} onChange={setFreq} />
      </div>

      {failed ? (
        <AnalyticsError onRetry={() => load(freq)} />
      ) : (
        <>
          {/* KPI tiles — current period */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {periodLabel}
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {loading || !data ? (
                Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
              ) : (
                <>
                  <MetricCard title="Customer Visits" value={data.kpis.customerVisits.toLocaleString()} icon={MapPin} />
                  <MetricCard title="Unique Customer Visits" value={data.kpis.uniqueCustomerVisits.toLocaleString()} icon={Footprints} />
                  <MetricCard title="Productive Visits" value={data.kpis.productiveVisits.toLocaleString()} icon={CheckCircle2} subtitle="Produced an order" />
                  <MetricCard title="New Customers" value={data.kpis.newCustomers.toLocaleString()} icon={UserPlus} />
                </>
              )}
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Customer Visits" subtitle={`By ${FREQUENCY_LABEL[freq].toLowerCase()} period`} loading={loading}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.customerVisitSeries ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="text-muted-foreground" width={40} />
                  <Tooltip formatter={(v) => `${Number(v).toLocaleString()} visits`} {...tooltipStyle} />
                  <Bar dataKey="value" name="Customer visits" fill={CHART.visit} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="New Customers" subtitle={`By ${FREQUENCY_LABEL[freq].toLowerCase()} period`} loading={loading}>
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

            <ChartCard title="Productive vs Total Visits" subtitle="A visit is productive if it produced an order" loading={loading}>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={data?.visitProductivity ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="text-muted-foreground" width={40} />
                  <Tooltip formatter={(v) => Number(v).toLocaleString()} {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="total" name="Total visits" fill={CHART.visit} radius={[4, 4, 0, 0]} />
                  <Line dataKey="productive" name="Productive" stroke={CHART.sales} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top 5 Field Agents" subtitle={`By visits · ${periodLabel}`} loading={loading}>
              <TopList
                items={data?.topAgents}
                primaryFormat={(v) => `${v.toLocaleString()} visits`}
                secondaryFormat={(n) => n.toLocaleString()}
                secondaryLabel="customer visits"
              />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
