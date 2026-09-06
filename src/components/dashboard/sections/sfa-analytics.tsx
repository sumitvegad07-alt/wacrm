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
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  MapPin,
  UserPlus,
  ShoppingCart,
  DollarSign,
  TrendingUp,
  Users,
  Banknote,
  Footprints,
  BarChart3,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency, getCurrencySymbol } from "@/lib/currency";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { getSfaAnalytics } from "@/app/actions/sfa-analytics";
import type { SfaAnalytics } from "@/lib/dashboard/sfa-analytics-types";
import {
  FREQUENCY_LABEL,
  PERIOD_LABEL,
  type Frequency,
} from "@/lib/dashboard/analytics-period";
import {
  CHART,
  tooltipStyle,
  FrequencyTabs,
  ChartCard,
  EmptyChart,
  AnalyticsError,
  TopList,
} from "./analytics-ui";

const STATUS_COLOR: Record<string, string> = {
  Pending: "#f59e0b",
  Approved: "#3b82f6",
  "Part Dispatch": "#06b6d4",
  Dispatched: "#8b5cf6",
  Rejected: "#ef4444",
  Cancelled: "#6b7280",
  Closed: "#10b981",
};

export function SfaAnalytics() {
  const { defaultCurrency } = useAuth();
  const [freq, setFreq] = useState<Frequency>("monthly");
  const [data, setData] = useState<SfaAnalytics | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  const load = useCallback((f: Frequency) => {
    let alive = true;
    setFailed(false);
    startTransition(() => {
      void getSfaAnalytics(f)
        .then((d) => {
          if (!alive) return;
          if (d) setData(d);
          else setFailed(true); // null = no auth/account (e.g. session lapsed)
        })
        .catch((err) => {
          // A lapsed session makes the server action POST return an unexpected
          // (login) response. Degrade to a retry card rather than a hard error.
          console.warn("[dashboard/sfa-analytics] load failed:", err?.message ?? err);
          if (alive) setFailed(true);
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(freq), [freq, load]);

  const sym = getCurrencySymbol(defaultCurrency);
  const compact = (n: number) =>
    `${sym}${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
  const money = (n: number) => formatCurrency(n, defaultCurrency);
  const periodLabel = PERIOD_LABEL[freq];
  const loading = !data && !failed;

  return (
    <div className="space-y-5">
      {/* Header + frequency control */}
      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Sales Analytics</h3>
        </div>
        <FrequencyTabs value={freq} onChange={setFreq} />
      </div>

      {failed ? (
        <AnalyticsError onRetry={() => load(freq)} />
      ) : (
        <>
          {/* KPI tiles (#6) — current period at the chosen frequency */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {periodLabel}
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {loading || !data ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
              ) : (
                <>
                  <MetricCard title="Sales Orders" value={data.kpis.salesOrders.toLocaleString()} icon={ShoppingCart} />
                  <MetricCard title="Total Order Value" value={money(data.kpis.orderValue)} icon={DollarSign} />
                  <MetricCard title="Total Sales Value" value={money(data.kpis.salesValue)} icon={TrendingUp} />
                  <MetricCard title="Payment Collection" value={money(data.kpis.paymentCollection)} icon={Banknote} />
                  <MetricCard title="Unique Customers Ordered" value={data.kpis.uniqueCustomersOrdered.toLocaleString()} icon={Users} />
                  <MetricCard title="New Customers" value={data.kpis.newCustomers.toLocaleString()} icon={UserPlus} />
                  <MetricCard title="Customer Visits" value={data.kpis.customerVisits.toLocaleString()} icon={MapPin} />
                  <MetricCard title="Unique Customer Visits" value={data.kpis.uniqueCustomerVisits.toLocaleString()} icon={Footprints} />
                </>
              )}
            </div>
          </div>

          {/* Time-series charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Order Value" subtitle={`By ${FREQUENCY_LABEL[freq].toLowerCase()} period`} loading={loading}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.orderValueSeries ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} className="text-muted-foreground" width={54} />
                  <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle} />
                  <Bar dataKey="value" name="Order value" fill={CHART.order} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Sales Value" subtitle="Shipped revenue (Closed orders)" loading={loading}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.salesSeries ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} className="text-muted-foreground" width={54} />
                  <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle} />
                  <Bar dataKey="value" name="Sales value" fill={CHART.sales} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Order vs Sales" subtitle="Booked vs shipped, by period" loading={loading}>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={data?.orderVsSales ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} className="text-muted-foreground" width={54} />
                  <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="order" name="Order value" fill={CHART.order} radius={[4, 4, 0, 0]} />
                  <Line dataKey="sales" name="Sales value" stroke={CHART.sales} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Payment Collection" subtitle={`By ${FREQUENCY_LABEL[freq].toLowerCase()} period`} loading={loading}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.paymentSeries ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} className="text-muted-foreground" width={54} />
                  <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle} />
                  <Bar dataKey="value" name="Collected" fill={CHART.payment} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Order by status + Top salespeople */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Orders by Status" subtitle={periodLabel} loading={loading}>
              {data && data.ordersByStatus.length > 0 ? (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={220}>
                    <PieChart>
                      <Pie data={data.ordersByStatus} dataKey="count" nameKey="status" innerRadius={50} outerRadius={85} paddingAngle={2}>
                        {data.ordersByStatus.map((s) => (
                          <Cell key={s.status} fill={STATUS_COLOR[s.status] ?? "#64748b"} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v, _n, p) => {
                          const pl = (p as { payload?: { value?: number; status?: string } }).payload;
                          return [`${Number(v)} orders · ${money(pl?.value ?? 0)}`, pl?.status ?? ""];
                        }}
                        {...tooltipStyle}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {data.ordersByStatus.map((s) => (
                      <div key={s.status} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s.status] ?? "#64748b" }} />
                          {s.status}
                        </span>
                        <span className="font-medium tabular-nums text-foreground">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyChart label="No orders in this period" />
              )}
            </ChartCard>

            <ChartCard title="Top 5 Salespeople" subtitle={`By order value · ${periodLabel}`} loading={loading}>
              <TopList items={data?.topSalespeople} primaryFormat={money} secondaryFormat={(n) => n.toLocaleString()} secondaryLabel="orders" />
            </ChartCard>
          </div>

          {/* Top products + Top customers */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Top 5 Products" subtitle={`Most ordered · ${periodLabel}`} loading={loading}>
              <TopList
                items={data?.topProducts}
                primaryFormat={(v) => `${v.toLocaleString()} qty`}
                secondaryFormat={money}
              />
            </ChartCard>

            <ChartCard title="Top 5 Customers" subtitle={`By order value · ${periodLabel}`} loading={loading}>
              <TopList items={data?.topCustomers} primaryFormat={money} secondaryFormat={(n) => n.toLocaleString()} secondaryLabel="orders" />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
