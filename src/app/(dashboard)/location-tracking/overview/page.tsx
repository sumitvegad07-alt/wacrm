"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { MapPin, Users, Battery, Activity } from "lucide-react";
import dynamic from "next/dynamic";
import type { Point } from "@/components/location-tracking/map-view";
import { computeFilteredDistanceKm } from "@/lib/location/distance";

/** Minutes without a ping (during an otherwise active day) before an agent is "gone dark". */
const STALE_AFTER_MIN = 25;

const MapView = dynamic(
  () => import("@/components/location-tracking/map-view"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-muted flex items-center justify-center animate-pulse text-muted-foreground text-sm rounded-xl">
        Loading Map...
      </div>
    ),
  },
);

export default function LocationTrackingOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    activeAgents: 0,
    totalVisits: 0,
    avgBattery: 0,
    totalDistance: "0",
  });
  const [agentPoints, setAgentPoints] = useState<Point[]>([]);

  useEffect(() => {
    async function loadMetrics() {
      const supabase = createClient();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // Fetch today's pings for battery and agents
      const { data: pings } = await supabase
        .from("location_pings")
        .select("user_id, battery_pct, lat, lng, accuracy_m, is_mocked, recorded_at")
        .gte("recorded_at", startOfDay.toISOString());

      // Fetch today's visits
      const { count: visitsCount } = await supabase
        .from("customer_visits")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfDay.toISOString());

      // Fetch profiles for names
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name");

      const profileMap = new Map(
        (profiles || []).map((p) => [p.user_id, p.full_name]),
      );

      let activeAgentsCount = 0;
      let avgBatteryValue = 0;
      let distanceSum = 0;
      const latestPings: Point[] = [];

      if (pings && pings.length > 0) {
        // Unique agents
        const uniqueUsers = new Set(pings.map((p) => p.user_id));
        activeAgentsCount = uniqueUsers.size;

        // Average battery
        const validBatteries = pings.filter((p) => p.battery_pct !== null);
        if (validBatteries.length > 0) {
          const sum = validBatteries.reduce(
            (acc, curr) => acc + (curr.battery_pct || 0),
            0,
          );
          avgBatteryValue = Math.round(sum / validBatteries.length);
        }

        // Calculate distance + get latest ping per user for map
        const pingsByUser: Record<string, typeof pings> = {};
        pings.forEach((p) => {
          if (!pingsByUser[p.user_id]) pingsByUser[p.user_id] = [];
          pingsByUser[p.user_id].push(p);
        });

        const now = Date.now();

        Object.entries(pingsByUser).forEach(([userId, userPings]) => {
          // Sort by time
          userPings.sort(
            (a, b) =>
              new Date(a.recorded_at).getTime() -
              new Date(b.recorded_at).getTime(),
          );

          // Trustworthy distance — filters low-accuracy pings + impossible jumps.
          distanceSum += computeFilteredDistanceKm(userPings);

          // Latest ping for map
          const latest = userPings[userPings.length - 1];
          if (latest.lat && latest.lng) {
            const minutesAgo = Math.round(
              (now - new Date(latest.recorded_at).getTime()) / 60000,
            );
            const lastSeen =
              minutesAgo < 1
                ? "just now"
                : minutesAgo < 60
                  ? `${minutesAgo} min ago`
                  : `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago`;
            latestPings.push({
              lat: latest.lat,
              lng: latest.lng,
              type: "current",
              time: new Date(latest.recorded_at).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              label: profileMap.get(userId) || "Agent",
              battery: latest.battery_pct,
              mocked: !!latest.is_mocked,
              stale: minutesAgo > STALE_AFTER_MIN,
              lastSeen,
            });
          }
        });
      }

      setAgentPoints(latestPings);
      setMetrics({
        activeAgents: activeAgentsCount,
        totalVisits: visitsCount || 0,
        avgBattery: avgBatteryValue,
        totalDistance: distanceSum.toFixed(2),
      });
      setLoading(false);
    }

    loadMetrics();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Location Tracking Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live overview of your field team&apos;s activity and device health for
          today.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Active Field Agents"
              value={metrics.activeAgents.toString()}
              icon={Users}
              subtitle="Agents tracked today"
            />
            <MetricCard
              title="Total Visits Logged"
              value={metrics.totalVisits.toString()}
              icon={MapPin}
              subtitle="Customer check-ins today"
            />
            <MetricCard
              title="Total Distance Tracked"
              value={`${metrics.totalDistance} km`}
              icon={Activity}
              subtitle="Cumulative travel today"
            />
            <MetricCard
              title="Average Battery Health"
              value={`${metrics.avgBattery}%`}
              icon={Battery}
              subtitle="Across active devices"
            />
          </>
        )}
      </div>

      {/* Real Live Map */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Live Agent Positions
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Latest known position for each active field agent
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            {agentPoints.length} active
          </div>
        </div>
        <div className="h-[400px]">
          {agentPoints.length > 0 ? (
            <MapView
              points={agentPoints}
              layerType="standard"
              showStraightLine={false}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <MapPin className="h-12 w-12 opacity-20 mb-4" />
              <h3 className="text-lg font-semibold text-foreground">
                No Active Agents
              </h3>
              <p className="text-sm mt-2 max-w-sm text-center">
                Agent positions will appear here when field staff punch in and
                start tracking.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

