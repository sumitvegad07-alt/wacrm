"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { UserPlus, DollarSign, GitBranch, Users } from "lucide-react";

import { loadActivity, loadMetrics } from "@/lib/dashboard/queries";
import type { ActivityItem, MetricsBundle } from "@/lib/dashboard/types";

import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { SectionHeading } from "./section-heading";
import { CrmAnalytics } from "./crm-analytics";

/**
 * CRM line section — a quick operational strip (today's leads, conversions,
 * open-deal value) plus recent activity, then the full CRM Analytics block
 * (leads/deals/quotations/expense matrices with a Daily/Monthly/Quarterly/
 * Yearly lens). Rendered on every plan that includes the CRM line, so it also
 * powers CRM+WFA and CRM+SFA. Row scoping is handled by RLS.
 */
export function CrmSection() {
  const { defaultCurrency } = useAuth();

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const loadAll = useCallback(() => {
    const db = createClient();

    void loadMetrics(db)
      .then(setMetrics)
      .catch((err) => console.error("[dashboard/crm] metrics failed:", err))
      .finally(() => setMetricsLoading(false));

    void loadActivity(db, 50)
      .then(setActivity)
      .catch((err) => console.error("[dashboard/crm] activity failed:", err))
      .finally(() => setActivityLoading(false));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <section className="space-y-4">
      <SectionHeading title="CRM" subtitle="Your leads, deals, and customer pipeline." />

      {/* Operational snapshot */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="New Leads Today"
              value={metrics.newLeadsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign: metrics.newLeadsToday.current - metrics.newLeadsToday.previous,
                label: deltaLabel(metrics.newLeadsToday.current - metrics.newLeadsToday.previous, "vs yesterday"),
              }}
            />
            <MetricCard title="Converted Customers" value={metrics.convertedContacts.toLocaleString()} icon={Users} />
            <MetricCard
              title="New Pipelines Today"
              value={metrics.newPipelinesToday.current.toLocaleString()}
              icon={GitBranch}
              delta={{
                sign: metrics.newPipelinesToday.current - metrics.newPipelinesToday.previous,
                label: deltaLabel(metrics.newPipelinesToday.current - metrics.newPipelinesToday.previous, "vs yesterday"),
              }}
            />
            <MetricCard
              title="Open Deals Value"
              value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
              icon={DollarSign}
              subtitle={`${metrics.openDealsCount} open deal${metrics.openDealsCount === 1 ? "" : "s"}`}
            />
          </>
        )}
      </div>

      <QuickActions />

      {/* Full CRM analytics — KPIs, breakdowns, funnels, trends, leaderboard */}
      <CrmAnalytics />

      <ActivityFeed items={activity} loading={activityLoading} />
    </section>
  );
}

function deltaLabel(delta: number, suffix: string): string {
  if (delta === 0) return `No change ${suffix}`;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toLocaleString()} ${suffix}`;
}
