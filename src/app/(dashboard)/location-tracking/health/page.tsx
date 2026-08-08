"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/dashboard/metric-card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { ChevronRight, HeartPulse, AlertTriangle, UserCheck, MoonStar } from "lucide-react";
import { computeAgentHealth, LOW_COVERAGE_PCT, type AgentHealth } from "@/lib/location/tracking-health";
import { ISSUE_CATALOG } from "@/lib/location/tracking-issues";
import { normalizeTrackingSettings } from "@/lib/location/tracking-window";
import { useAuth } from "@/hooks/use-auth";

interface HealthRow extends AgentHealth {
  id: string;
  name: string;
  lastSeen: string;
  devicePending: boolean;
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

export default function TrackingHealthPage() {
  const { accountId } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [notPunchedIn, setNotPunchedIn] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  const [filterState, setFilterState] = useState<FilterState>({});

  const supabase = createClient();

  useEffect(() => {
    fetchHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, accountId]);

  const fetchHealth = async () => {
    // accountId arrives asynchronously from useAuth; querying before it lands sends
    // `id=eq.null` and 400s.
    if (!accountId) return;
    setIsLoading(true);
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);
    const isoStart = startOfDay.toISOString();
    const isoEnd = endOfDay.toISOString();

    const [
      { data: profiles },
      { data: sessions },
      { data: pings },
      { data: events },
      { data: snaps },
      { data: devices },
    ] = await Promise.all([
      supabase.from("profiles").select("id, user_id, full_name"),
      supabase
        .from("tracking_sessions")
        .select("user_id, started_at, ended_at, end_reason")
        .gte("started_at", isoStart)
        .lte("started_at", isoEnd),
      supabase
        .from("location_pings")
        .select("user_id, recorded_at, battery_pct, is_mocked")
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

    // The configured working window decides whether a missing punch-in is "hasn't started yet"
    // (fine) or "shift is underway and nothing is being tracked" (chase it).
    const { data: acct } = await supabase
      .from("accounts")
      .select("settings")
      .eq("id", accountId)
      .maybeSingle();
    const trackingSettings = normalizeTrackingSettings((acct as any)?.settings?.tracking_settings);

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
      const devicePending = pendingUserIds.has(p.user_id);
      const health = computeAgentHealth({
        sessions: userSessions,
        pings: pingById[p.user_id] || [],
        events: evById[p.user_id] || [],
        latestSnapshot: (snapById[p.user_id] || [])[0] || null,
        snapshotTimes: (snapById[p.user_id] || []).map((s: any) => s.recorded_at),
        devicePending,
        trackingSettings,
      });

      if (!health.punchedIn && !devicePending) {
        notPunched++;
        return; // keep the triage list focused on people on duty (counted in the summary)
      }

      const userPings = pingById[p.user_id] || [];
      const lastPing = userPings.length
        ? userPings.reduce((a: any, b: any) =>
            new Date(a.recorded_at) > new Date(b.recorded_at) ? a : b,
          )
        : null;

      built.push({
        ...health,
        id: p.user_id,
        name: p.full_name || "Unknown",
        devicePending,
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
      id: "coverage",
      label: "Coverage",
      type: "text",
      render: (row) => (
        <span className={row.coveragePct < LOW_COVERAGE_PCT ? "font-semibold text-destructive" : row.coveragePct < 80 ? "font-semibold text-warning" : ""}>
          {row.punchedIn ? `${row.coveragePct}%` : "—"}
        </span>
      ),
    },
    {
      id: "status",
      label: "Status",
      type: "text",
      render: (row) => statusBadge(row),
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
      id: "lastSeen",
      label: "Last seen",
      type: "text",
      render: (row) => <span className="text-muted-foreground">{row.lastSeen}</span>,
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <HeartPulse className="size-6 text-primary" /> Tracking Health
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who&apos;s tracking correctly today, who isn&apos;t, and exactly what to tell them to fix it.
          </p>
        </div>
        <Input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-auto h-9 bg-background border-border"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Needs Attention" value={summary.needAttention.toString()} icon={AlertTriangle} subtitle="Agents with a tracking problem" />
        <MetricCard title="Tracking Normally" value={summary.healthy.toString()} icon={UserCheck} subtitle="Healthy on-duty agents" />
        <MetricCard title="On Duty" value={summary.onDuty.toString()} icon={HeartPulse} subtitle="Punched in today" />
        <MetricCard title="Not Punched In" value={notPunchedIn.toString()} icon={MoonStar} subtitle="No shift started today" />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 max-w-sm">
          <Input
            placeholder="Search agent..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="h-9 bg-background border-border"
          />
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
    </div>
  );
}
