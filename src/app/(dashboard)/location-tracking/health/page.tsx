"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { ChevronRight, HeartPulse, AlertTriangle, UserCheck, MoonStar, Search } from "lucide-react";
import { computeAgentHealth, LOW_COVERAGE_PCT, type AgentHealth } from "@/lib/location/tracking-health";
import { ISSUE_CATALOG } from "@/lib/location/tracking-issues";
import { normalizeTrackingSettings } from "@/lib/location/tracking-window";
import { computeFilteredDistanceKm, isTrustworthyPing } from "@/lib/location/distance";
import { useAuth } from "@/hooks/use-auth";

/**
 * Tracking Health — the single location-quality report.
 *
 * This page absorbed the old Track Report: keeping two tables meant an admin chasing "why is
 * this rep's data wrong" had to read a diagnosis on one screen and the underlying counts on
 * another. Everything Track Report showed is here as a column; the ones an admin rarely needs
 * are hidden by default and can be switched on from Manage Columns.
 */

interface HealthRow extends AgentHealth {
  id: string;
  name: string;
  role: string;
  lastSeen: string;
  devicePending: boolean;
  /** Trustworthy distance travelled (low-accuracy pings and GPS jumps excluded). */
  distanceKm: number;
  /** Locations the app recorded that came from a mock-GPS provider. */
  mockCount: number;
  /** Share of recorded pings accurate enough to trust, 0–100. */
  accuracyPct: number | null;
  /** Average reported accuracy in metres. */
  avgAccuracyM: number | null;
  /** Times the rep turned location services off mid-shift (self-reported by the app). */
  gpsOffCount: number;
  /** Sessions that ended because the OS/user killed the app — phone switched off mid-shift. */
  switchedOffCount: number;
  /** Sessions that timed out — tracking stopped silently and never resumed. */
  criticalCount: number;
}

/**
 * An agent needs attention when we detected a high-severity problem OR when the day simply
 * isn't well covered. Coverage alone matters: a shift that recorded under LOW_COVERAGE_PCT of
 * its expected locations isn't a usable record even if no single gap could be attributed.
 */
function needsAttention(row: HealthRow): boolean {
  if (row.worstSeverity === "high") return true;
  return row.punchedIn && row.expectedPings > 0 && row.coveragePct < LOW_COVERAGE_PCT;
}

function statusBadge(row: HealthRow) {
  if (needsAttention(row)) return <Badge variant="destructive">Needs attention</Badge>;
  if (row.worstSeverity === "medium") return <Badge variant="warning">Check</Badge>;
  if (row.worstSeverity === "info") return <Badge variant="neutral">Info</Badge>;
  return <Badge variant="success">Healthy</Badge>;
}

const todayStr = () => new Date().toISOString().split("T")[0];

/** Right-aligned number cell; a dash when there is nothing to show. */
const num = (v: number | null | undefined, suffix = "") => (
  <span className="block text-right tabular-nums">
    {v === null || v === undefined ? "—" : `${v}${suffix}`}
  </span>
);

export default function TrackingHealthPage() {
  const { accountId } = useAuth();
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [notPunchedIn, setNotPunchedIn] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  const [filterState, setFilterState] = useState<FilterState>({});

  const supabase = createClient();

  useEffect(() => {
    fetchHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, accountId]);

  const fetchHealth = async () => {
    // accountId arrives asynchronously from useAuth; querying before it lands sends
    // `id=eq.null` and 400s.
    if (!accountId) return;
    setIsLoading(true);
    const rangeStart = new Date(fromDate);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(toDate);
    rangeEnd.setHours(23, 59, 59, 999);
    const isoStart = rangeStart.toISOString();
    const isoEnd = rangeEnd.toISOString();

    const [
      { data: profiles },
      { data: sessions },
      { data: pings },
      { data: events },
      { data: snaps },
      { data: devices },
    ] = await Promise.all([
      supabase.from("profiles").select("id, user_id, full_name, role"),
      supabase
        .from("tracking_sessions")
        .select("user_id, started_at, ended_at, end_reason")
        .gte("started_at", isoStart)
        .lte("started_at", isoEnd),
      supabase
        .from("location_pings")
        // lat/lng/accuracy_m are needed for distance and the accuracy score, which the old
        // Track Report computed separately.
        .select("user_id, recorded_at, battery_pct, is_mocked, lat, lng, accuracy_m")
        .gte("recorded_at", isoStart)
        .lte("recorded_at", isoEnd),
      supabase
        .from("tracking_events")
        .select("user_id, event_type, recorded_at")
        .gte("recorded_at", isoStart)
        .lte("recorded_at", isoEnd),
      supabase
        .from("device_health_snapshots")
        .select(
          "user_id, recorded_at, bg_location_permission, battery_optimization_on, low_power_mode, location_services_on, app_version",
        )
        .gte("recorded_at", isoStart)
        .lte("recorded_at", isoEnd)
        .order("recorded_at", { ascending: false }),
      supabase.from("employee_devices").select("profile_id, status"),
    ]);

    // The configured shift decides whether a missing punch-in is "hasn't started yet" (fine) or
    // "shift is underway and nothing is being tracked" (chase it). That judgement only makes
    // sense for today — on a historical range it would accuse everyone of being late.
    const { data: acct } = await supabase
      .from("accounts")
      .select("settings")
      .eq("id", accountId)
      .maybeSingle();
    const trackingSettings = normalizeTrackingSettings((acct as any)?.settings?.tracking_settings);
    const rangeIncludesToday = toDate >= todayStr();

    const byUser = (list: any[] | null): Record<string, any[]> => {
      const m: Record<string, any[]> = {};
      (list || []).forEach((r: any) => {
        (m[r.user_id] ||= []).push(r);
      });
      return m;
    };
    const sessById = byUser(sessions as any);
    const pingById = byUser(pings as any);
    const evById = byUser(events as any);
    const snapById = byUser(snaps as any); // already sorted desc, so [0] is latest

    // Device-pending by user_id (employee_devices scopes by profile_id).
    const pendingProfileIds = new Set(
      (devices || []).filter((d: any) => d.status === "pending").map((d: any) => d.profile_id),
    );
    const pendingUserIds = new Set(
      (profiles || []).filter((p: any) => pendingProfileIds.has(p.id)).map((p: any) => p.user_id),
    );

    const built: HealthRow[] = [];
    let notPunched = 0;

    (profiles || []).forEach((p: any) => {
      const userSessions = sessById[p.user_id] || [];
      const userPings = pingById[p.user_id] || [];
      const userEvents = evById[p.user_id] || [];
      const devicePending = pendingUserIds.has(p.user_id);

      const health = computeAgentHealth({
        sessions: userSessions,
        pings: userPings,
        events: userEvents,
        latestSnapshot: (snapById[p.user_id] || [])[0] || null,
        snapshotTimes: (snapById[p.user_id] || []).map((s: any) => s.recorded_at),
        devicePending,
        // Always pass the settings so coverage uses the configured interval, but only judge a
        // missing punch-in when the range actually reaches today.
        trackingSettings,
        evaluateMissingPunchIn: rangeIncludesToday,
      });

      if (!health.punchedIn) notPunched++;

      // Keep the list focused on people who actually did something in this range. A rep with no
      // session but with pings still belongs here — visit check-ins now record a location even
      // when nobody punched in, and dropping those rows would lose data the old Track Report showed.
      if (!health.punchedIn && !devicePending && userPings.length === 0) return;

      const lastPing = userPings.length
        ? userPings.reduce((a: any, b: any) =>
            new Date(a.recorded_at) > new Date(b.recorded_at) ? a : b,
          )
        : null;

      // Accuracy score: what share of recorded locations were good enough to trust. More useful
      // than a raw metre average, which one 1.2 km reading can wreck.
      const withAccuracy = userPings.filter((x: any) => x.accuracy_m != null);
      const trustworthy = userPings.filter(isTrustworthyPing).length;
      const avgAccuracyM = withAccuracy.length
        ? Math.round(
            withAccuracy.reduce((sum: number, x: any) => sum + x.accuracy_m, 0) /
              withAccuracy.length,
          )
        : null;

      built.push({
        ...health,
        id: p.user_id,
        name: p.full_name || "Unknown",
        role: p.role || "Field Staff",
        devicePending,
        distanceKm: computeFilteredDistanceKm(userPings as any),
        mockCount: userPings.filter((x: any) => x.is_mocked).length,
        accuracyPct: userPings.length
          ? Math.round((trustworthy / userPings.length) * 100)
          : null,
        avgAccuracyM,
        gpsOffCount: userEvents.filter((e: any) => e.event_type === "gps_disabled").length,
        switchedOffCount: userSessions.filter((s: any) => s.end_reason === "app_killed").length,
        criticalCount: userSessions.filter((s: any) => s.end_reason === "timeout").length,
        lastSeen: lastPing
          ? new Date(lastPing.recorded_at).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—",
      });
    });

    // Worst first: needs-attention → medium → info → healthy.
    const rank = (r: HealthRow) =>
      needsAttention(r) ? 0 : r.worstSeverity === "medium" ? 1 : r.worstSeverity === "info" ? 2 : 3;
    built.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    setRows(built);
    setNotPunchedIn(notPunched);
    setIsLoading(false);
  };

  const summary = useMemo(() => {
    const needAttention = rows.filter(needsAttention).length;
    const healthy = rows.filter((r) => !needsAttention(r) && r.worstSeverity === null).length;
    const onDuty = rows.filter((r) => r.punchedIn).length;
    return { needAttention, healthy, onDuty };
  }, [rows]);

  const columns: ColumnDef<HealthRow>[] = [
    {
      id: "name",
      label: "Agent",
      type: "text",
      render: (row) => (
        <Link href={`/location-tracking/health/${row.id}`} className="font-medium hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      id: "role",
      label: "User role",
      type: "text",
      visibleByDefault: false,
      render: (row) => <span className="text-muted-foreground">{row.role}</span>,
    },
    {
      id: "status",
      label: "Status",
      type: "text",
      render: (row) => statusBadge(row),
    },
    {
      id: "coverage",
      label: "Coverage",
      type: "text",
      render: (row) => (
        <span
          className={`block text-right tabular-nums ${
            row.coveragePct < LOW_COVERAGE_PCT
              ? "font-semibold text-destructive"
              : row.coveragePct < 80
                ? "font-semibold text-warning"
                : ""
          }`}
        >
          {row.punchedIn ? `${row.coveragePct}%` : "—"}
        </span>
      ),
    },
    {
      id: "issue",
      label: "Likely issue",
      type: "text",
      render: (row) =>
        row.issueCodes.length ? (
          <span className="text-muted-foreground">{ISSUE_CATALOG[row.issueCodes[0]].title}</span>
        ) : (
          <span className="text-muted-foreground">Tracking normally</span>
        ),
    },
    {
      id: "distanceKm",
      label: "Distance (km)",
      type: "text",
      render: (row) => num(row.distanceKm),
    },
    {
      id: "expectedPings",
      label: "Expected",
      type: "text",
      render: (row) => num(row.expectedPings),
    },
    {
      id: "regular",
      label: "Regular",
      type: "text",
      render: (row) => num(row.receivedPings),
    },
    {
      id: "accuracyPct",
      label: "Accuracy",
      type: "text",
      render: (row) => num(row.accuracyPct, "%"),
    },
    {
      id: "lastSeen",
      label: "Last seen",
      type: "text",
      render: (row) => <span className="text-muted-foreground">{row.lastSeen}</span>,
    },
    {
      id: "gpsOffCount",
      label: "GPS off",
      type: "text",
      visibleByDefault: false,
      render: (row) => num(row.gpsOffCount),
    },
    {
      id: "switchedOffCount",
      label: "Switched off",
      type: "text",
      visibleByDefault: false,
      render: (row) => num(row.switchedOffCount),
    },
    {
      id: "criticalCount",
      label: "Critical",
      type: "text",
      visibleByDefault: false,
      render: (row) => num(row.criticalCount),
    },
    {
      id: "mockCount",
      label: "Mock",
      type: "text",
      visibleByDefault: false,
      render: (row) =>
        row.mockCount > 0 ? (
          <span className="block text-right font-semibold text-destructive tabular-nums">
            {row.mockCount}
          </span>
        ) : (
          num(0)
        ),
    },
    {
      id: "avgAccuracyM",
      label: "Avg accuracy",
      type: "text",
      visibleByDefault: false,
      render: (row) => num(row.avgAccuracyM, " m"),
    },
    {
      id: "gaps",
      label: "Gaps",
      type: "text",
      visibleByDefault: false,
      render: (row) => num(row.gaps.length),
    },
    {
      id: "activeHours",
      label: "Time on duty",
      type: "text",
      visibleByDefault: false,
      render: (row) => (
        <span className="block text-right tabular-nums">
          {row.activeSeconds > 0 ? `${(row.activeSeconds / 3600).toFixed(1)} h` : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      label: "",
      type: "text",
      render: (row) => (
        <Link
          href={`/location-tracking/health/${row.id}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Details <ChevronRight className="size-4" />
        </Link>
      ),
    },
  ];

  const filtered = useMemo(
    () =>
      rows.filter((r) => !globalSearch || r.name.toLowerCase().includes(globalSearch.toLowerCase())),
    [rows, globalSearch],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <HeartPulse className="size-6 text-primary" /> Tracking Health
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who&apos;s tracking correctly, who isn&apos;t, and exactly what to tell them to fix it.{" "}
          <span className="text-muted-foreground/80">
            &ldquo;Expected&rdquo; is how many locations the app should have recorded (time on duty
            ÷ the configured interval); &ldquo;Regular&rdquo; is how many it actually did. Use
            Manage Columns for GPS off, switched off, critical, mock and accuracy detail.
          </span>
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end">
        <div className="w-full max-w-sm space-y-1.5">
          <label className="block text-xs font-semibold uppercase text-muted-foreground">
            Agent
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search agent..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="h-9 border-border bg-background pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase text-muted-foreground">
            From date
          </label>
          <Input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 w-auto border-border bg-background"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase text-muted-foreground">
            To date
          </label>
          <Input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 w-auto border-border bg-background"
          />
        </div>

        <Button
          variant="outline"
          className="h-9"
          onClick={() => {
            setFromDate(todayStr());
            setToDate(todayStr());
          }}
        >
          Today
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Needs Attention" value={summary.needAttention.toString()} icon={AlertTriangle} subtitle="Agents with a tracking problem" />
        <MetricCard title="Tracking Normally" value={summary.healthy.toString()} icon={UserCheck} subtitle="Healthy on-duty agents" />
        <MetricCard title="On Duty" value={summary.onDuty.toString()} icon={HeartPulse} subtitle="Punched in during this range" />
        <MetricCard title="Not Punched In" value={notPunchedIn.toString()} icon={MoonStar} subtitle="No shift started" />
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((prev) => ({ ...prev, [id]: val }))}
        storageKey="wacrm_tracking_health_table"
        isLoading={isLoading}
        rowKey={(row) => row.id}
      />
    </div>
  );
}
