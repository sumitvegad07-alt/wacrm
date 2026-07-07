"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { MapPin, Users, Battery, Activity } from "lucide-react";

export default function LocationTrackingOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    activeAgents: 0,
    totalVisits: 0,
    avgBattery: 0,
    totalDistance: "0",
  });

  useEffect(() => {
    async function loadMetrics() {
      const supabase = createClient();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // Fetch today's pings for battery and agents
      const { data: pings } = await supabase
        .from("location_pings")
        .select("user_id, battery_pct, lat, lng")
        .gte("recorded_at", startOfDay.toISOString());

      // Fetch today's visits
      const { count: visitsCount } = await supabase
        .from("customer_visits")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfDay.toISOString());

      let activeAgentsCount = 0;
      let avgBatteryValue = 0;
      let distanceSum = 0;

      if (pings && pings.length > 0) {
        // Unique agents
        const uniqueUsers = new Set(pings.map((p) => p.user_id));
        activeAgentsCount = uniqueUsers.size;

        // Average battery
        const validBatteries = pings.filter((p) => p.battery_pct !== null);
        if (validBatteries.length > 0) {
          const sum = validBatteries.reduce((acc, curr) => acc + (curr.battery_pct || 0), 0);
          avgBatteryValue = Math.round(sum / validBatteries.length);
        }

        // Calculate simple distance by grouping by user
        const pingsByUser: Record<string, typeof pings> = {};
        pings.forEach((p) => {
          if (!pingsByUser[p.user_id]) pingsByUser[p.user_id] = [];
          pingsByUser[p.user_id].push(p);
        });

        const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
          const R = 6371;
          const dLat = (lat2 - lat1) * (Math.PI / 180);
          const dLon = (lon2 - lon1) * (Math.PI / 180);
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };

        Object.values(pingsByUser).forEach((userPings) => {
          for (let i = 1; i < userPings.length; i++) {
            const prev = userPings[i - 1];
            const curr = userPings[i];
            if (prev.lat && prev.lng && curr.lat && curr.lng) {
              distanceSum += getDistanceFromLatLonInKm(prev.lat, prev.lng, curr.lat, curr.lng);
            }
          }
        });
      }

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
        <h1 className="text-2xl font-bold text-foreground">Location Tracking Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live overview of your field team's activity and device health for today.
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

      <div className="rounded-xl border border-border bg-card p-8 text-center mt-8">
        <MapPin className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground">Live Tracking Map</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
          Want to see where your agents are right now? Switch over to the Live Feed module.
        </p>
      </div>
    </div>
  );
}
