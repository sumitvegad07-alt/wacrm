"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  ArrowLeft,
  Activity,
  Gauge,
  Clock,
  BatteryMedium,
  Copy,
  Check,
  X,
  Smartphone,
} from "lucide-react";
import {
  computeAgentHealth,
  type AgentHealth,
  type HealthSnapshot,
} from "@/lib/location/tracking-health";
import { ISSUE_CATALOG, type Severity } from "@/lib/location/tracking-issues";
import { normalizeTrackingSettings } from "@/lib/location/tracking-window";

function sevBadge(sev: Severity) {
  if (sev === "high") return <Badge variant="destructive">High</Badge>;
  if (sev === "medium") return <Badge variant="warning">Medium</Badge>;
  return <Badge variant="neutral">Info</Badge>;
}

function fmtDuration(seconds: number) {
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/** One label/value row in the device snapshot card. `ok` drives the check/cross tint. */
function SnapshotRow({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {ok === true && <Check className="size-4 text-success" />}
        {ok === false && <X className="size-4 text-destructive" />}
        {value}
      </span>
    </div>
  );
}

export default function AgentHealthDetailPage() {
  const params = useParams();
  const userId = params.userId as string;
  const supabase = createClient();

  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [name, setName] = useState("Agent");
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [snapshot, setSnapshot] = useState<HealthSnapshot & { manufacturer?: string | null; model?: string | null; os_version?: string | null; battery_pct?: number | null; is_charging?: boolean | null } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedDate]);

  const load = async () => {
    setIsLoading(true);
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);
    const isoStart = startOfDay.toISOString();
    const isoEnd = endOfDay.toISOString();

    const [{ data: profile }, { data: sessions }, { data: pings }, { data: events }, { data: snaps }, { data: acct }] =
      await Promise.all([
        supabase.from("profiles").select("full_name").eq("user_id", userId).maybeSingle(),
        supabase
          .from("tracking_sessions")
          .select("user_id, started_at, ended_at, end_reason")
          .eq("user_id", userId)
          .gte("started_at", isoStart)
          .lte("started_at", isoEnd),
        supabase
          .from("location_pings")
          .select("user_id, recorded_at, battery_pct, is_mocked")
          .eq("user_id", userId)
          .gte("recorded_at", isoStart)
          .lte("recorded_at", isoEnd),
        supabase
          .from("tracking_events")
          .select("user_id, event_type, recorded_at")
          .eq("user_id", userId)
          .gte("recorded_at", isoStart)
          .lte("recorded_at", isoEnd),
        supabase
          .from("device_health_snapshots")
          .select("*")
          .eq("user_id", userId)
          .gte("recorded_at", isoStart)
          .lte("recorded_at", isoEnd)
          .order("recorded_at", { ascending: false })
          .limit(1),
        // Working window — decides whether a missing punch-in counts as "late" (RLS scopes
        // this to the viewer's own account, so no explicit filter is needed).
        supabase.from("accounts").select("settings").limit(1).maybeSingle(),
      ]);

    setName((profile as any)?.full_name || "Agent");
    const latest = (snaps || [])[0] || null;
    setSnapshot(latest as any);
    setHealth(
      computeAgentHealth({
        sessions: (sessions as any) || [],
        pings: (pings as any) || [],
        events: (events as any) || [],
        latestSnapshot: latest as any,
        trackingSettings: normalizeTrackingSettings((acct as any)?.settings?.tracking_settings),
      }),
    );
    setIsLoading(false);
  };

  const copyFix = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Fix copied — paste it to the agent"),
      () => toast.error("Could not copy"),
    );
  }, []);

  const coverageColor =
    !health || !health.punchedIn
      ? "bg-muted"
      : health.coveragePct >= 80
        ? "bg-success"
        : health.coveragePct >= 50
          ? "bg-warning"
          : "bg-destructive";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/location-tracking/health"
            className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{name}</h1>
            <p className="text-sm text-muted-foreground">Tracking diagnostics for the selected day</p>
          </div>
        </div>
        <Input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-auto h-9 bg-background border-border"
        />
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
          Loading diagnostics…
        </div>
      ) : !health?.punchedIn ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-lg font-semibold text-foreground">No shift on this day</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This agent didn&apos;t punch in, so no location was expected.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Coverage" value={`${health.coveragePct}%`} icon={Gauge} subtitle="of expected location updates" />
            <MetricCard title="Updates" value={`${health.receivedPings} / ${health.expectedPings}`} icon={Activity} subtitle="received / expected" />
            <MetricCard title="On Duty" value={fmtDuration(health.activeSeconds)} icon={Clock} subtitle="tracked time today" />
            <MetricCard
              title="Device Battery"
              value={snapshot?.battery_pct != null ? `${snapshot.battery_pct}%` : "—"}
              icon={BatteryMedium}
              subtitle={snapshot?.is_charging ? "charging" : "last reported"}
            />
          </div>

          {/* Coverage bar */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Location coverage</h3>
              <span className="text-sm text-muted-foreground">
                {health.receivedPings} of {health.expectedPings} expected updates
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full ${coverageColor}`} style={{ width: `${health.coveragePct}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Issues & fixes */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 text-sm font-semibold text-foreground">Issues &amp; fixes</h3>
              {health.issueCodes.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success">
                  <Check className="size-4" /> Tracking looks healthy for this day.
                </div>
              ) : (
                <div className="space-y-4">
                  {health.issueCodes.map((code) => {
                    const meta = ISSUE_CATALOG[code];
                    return (
                      <div key={code} className="rounded-lg border border-border p-3">
                        <div className="mb-1 flex items-center gap-2">
                          {sevBadge(meta.severity)}
                          <span className="text-sm font-semibold text-foreground">{meta.title}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{meta.cause}</p>
                        <div className="mt-2 flex items-start justify-between gap-2 rounded-md bg-muted/50 p-2.5">
                          <p className="text-xs text-foreground">{meta.fix}</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 px-2 text-xs"
                            onClick={() => copyFix(meta.fix)}
                          >
                            <Copy className="mr-1 size-3" /> Copy
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Device snapshot + gaps */}
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Smartphone className="size-4" /> Device snapshot
                </h3>
                {snapshot ? (
                  <div>
                    <SnapshotRow label="Model" value={[snapshot.manufacturer, snapshot.model].filter(Boolean).join(" ") || "—"} />
                    <SnapshotRow label="Android" value={snapshot.os_version || "—"} />
                    <SnapshotRow label="App version" value={snapshot.app_version || "—"} />
                    <SnapshotRow label="Location services" value={snapshot.location_services_on ? "On" : "Off"} ok={snapshot.location_services_on} />
                    <SnapshotRow label="Background location" value={snapshot.bg_location_permission || "—"} ok={snapshot.bg_location_permission == null ? null : snapshot.bg_location_permission === "granted"} />
                    <SnapshotRow label="Battery optimization" value={snapshot.battery_optimization_on == null ? "Unknown" : snapshot.battery_optimization_on ? "On (bad)" : "Off (good)"} ok={snapshot.battery_optimization_on == null ? null : !snapshot.battery_optimization_on} />
                    <SnapshotRow label="Battery saver" value={snapshot.low_power_mode == null ? "—" : snapshot.low_power_mode ? "On" : "Off"} ok={snapshot.low_power_mode == null ? null : !snapshot.low_power_mode} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No device-health report yet — this usually means the agent is on an older app build.
                    Ask them to update the app for full diagnostics.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Tracking gaps</h3>
                {health.gaps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No significant gaps — updates arrived steadily.</p>
                ) : (
                  <div className="space-y-2">
                    {health.gaps.map((g, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                        <span className="text-sm text-foreground">
                          {fmtTime(g.fromIso)} → {fmtTime(g.toIso)}
                          <span className="ml-2 text-xs text-muted-foreground">({g.minutes} min)</span>
                        </span>
                        <Badge variant="outline">{ISSUE_CATALOG[g.issueCode].title}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
