"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useDataScope } from "@/hooks/use-data-scope";
import { formatCurrency } from "@/lib/currency";
import { MapPin, Users, Battery, Activity, Receipt, CalendarClock } from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { SectionHeading } from "./section-heading";
import {
  loadWorkforceMetrics,
  type WorkforceMetrics,
} from "@/lib/dashboard/workforce-queries";
import { WfaAnalytics } from "./wfa-analytics";
import type { Point } from "@/components/location-tracking/map-view";

const STALE_AFTER_MIN = 25;

const MapView = dynamic(() => import("@/components/location-tracking/map-view"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full animate-pulse items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
      Loading Map...
    </div>
  ),
});

/**
 * Workforce (WFA line) section — the live field-team view: who's out today,
 * visits logged, distance, device health, and what's queued for the manager to
 * approve. Rendered only when the plan includes the WFA line. Numbers respect
 * the viewer's data scope (own / team / all) via useDataScope.
 */
export function WorkforceSection() {
  const { accountId, defaultCurrency, isModuleEnabled } = useAuth();
  const scope = useDataScope();
  const expenseOn = isModuleEnabled("expense");

  const [metrics, setMetrics] = useState<WorkforceMetrics | null>(null);
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    if (!accountId || !scope.ready) return;
    let alive = true;
    const db = createClient();

    void loadWorkforceMetrics(db, accountId, scope)
      .then((m) => {
        if (alive) setMetrics(m);
      })
      .catch((err) => console.error("[dashboard/workforce] metrics failed:", err));

    // Latest position per visible agent for the live map.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let mapQuery = db
      .from("location_pings")
      .select("user_id, lat, lng, battery_pct, is_mocked, recorded_at")
      .eq("account_id", accountId)
      .gte("recorded_at", todayStart.toISOString());
    mapQuery = scope.apply(mapQuery, "user_id");

    void (async () => {
      const { data: pings } = await mapQuery;
      const { data: profiles } = await db.from("profiles").select("user_id, full_name");
      if (!alive) return;
      const nameOf = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

      const latestByUser = new Map<string, any>();
      for (const p of (pings ?? []) as any[]) {
        if (!p.lat || !p.lng) continue;
        const prev = latestByUser.get(p.user_id);
        if (!prev || new Date(p.recorded_at) > new Date(prev.recorded_at)) {
          latestByUser.set(p.user_id, p);
        }
      }

      const now = Date.now();
      const pts: Point[] = [];
      for (const [userId, p] of latestByUser) {
        const minutesAgo = Math.round((now - new Date(p.recorded_at).getTime()) / 60000);
        const lastSeen =
          minutesAgo < 1
            ? "just now"
            : minutesAgo < 60
              ? `${minutesAgo} min ago`
              : `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago`;
        pts.push({
          lat: p.lat,
          lng: p.lng,
          type: "current",
          time: new Date(p.recorded_at).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          label: nameOf.get(userId) || "Agent",
          battery: p.battery_pct,
          mocked: !!p.is_mocked,
          stale: minutesAgo > STALE_AFTER_MIN,
          lastSeen,
        });
      }
      setPoints(pts);
    })();

    return () => {
      alive = false;
    };
    // scope.key changes whenever the visible-user set changes.
  }, [accountId, scope.ready, scope.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = metrics === null;

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Workforce"
        subtitle="Live field activity and device health for today."
        icon={MapPin}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Active Field Agents"
              value={metrics.activeAgents.toString()}
              icon={Users}
              subtitle={`${metrics.liveAgents} live in the last ${STALE_AFTER_MIN} min`}
            />
            <MetricCard
              title="Visits Logged Today"
              value={metrics.visitsToday.toString()}
              icon={MapPin}
              subtitle="Customer check-ins today"
            />
            <MetricCard
              title="Distance Tracked"
              value={`${metrics.distanceKm} km`}
              icon={Activity}
              subtitle="Cumulative travel today"
            />
            <MetricCard
              title="Average Battery"
              value={`${metrics.avgBattery}%`}
              icon={Battery}
              subtitle="Across active devices"
            />
          </>
        )}
      </div>

      {/* Approvals waiting on the manager */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            {expenseOn && (
              <Link href="/expenses">
                <MetricCard
                  title="Expenses Awaiting Approval"
                  value={metrics.expensesPendingCount.toString()}
                  icon={Receipt}
                  subtitle={
                    metrics.expensesPendingCount > 0
                      ? `${formatCurrency(metrics.expensesPendingAmount, defaultCurrency)} to review`
                      : "All caught up"
                  }
                  className={metrics.expensesPendingCount > 0 ? "border-amber-500/20" : ""}
                />
              </Link>
            )}
            <Link href="/location-tracking/leaves">
              <MetricCard
                title="Leave Requests Pending"
                value={metrics.leavesPendingCount.toString()}
                icon={CalendarClock}
                subtitle={metrics.leavesPendingCount > 0 ? "Needs your decision" : "All caught up"}
                className={metrics.leavesPendingCount > 0 ? "border-amber-500/20" : ""}
              />
            </Link>
          </>
        )}
      </div>

      {/* Live agent map */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Live Agent Positions</h3>
            <p className="text-[11px] text-muted-foreground">
              Latest known position for each active field agent
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            {points.length} active
          </div>
        </div>
        <div className="h-[360px]">
          {points.length > 0 ? (
            <MapView points={points} layerType="standard" showStraightLine={false} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <MapPin className="mb-4 h-12 w-12 opacity-20" />
              <h3 className="text-lg font-semibold text-foreground">No Active Agents</h3>
              <p className="mt-2 max-w-sm text-center text-sm">
                Agent positions appear here when field staff punch in and start tracking.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Field analytics — visits, productivity, and new customers with the
          Daily/Monthly/Quarterly/Yearly lens (RLS-scoped like the Sales set). */}
      <WfaAnalytics />
    </section>
  );
}
