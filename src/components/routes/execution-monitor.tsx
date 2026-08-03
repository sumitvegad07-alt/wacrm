"use client";

// Execution Monitor (Phase 2d) — web is a MANAGEMENT CONSOLE, read-only. Answers: who started,
// who's running, who completed, who skipped. Execution itself happens on mobile. UI → hooks →
// SDK (read-only); no writes here. Enterprise scale: paginated, date/status filtered, head-count
// tiles, per-page stop tallies.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useExecutions, useExecutionSummary, useExecutionStops } from "@/hooks/route/use-routes";
import type { ExecutionStatus, RouteExecutionRow, StopStatus } from "@/lib/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  Loader2, Activity, PlayCircle, CheckCircle2, ChevronLeft, ChevronRight, AlertCircle,
  MapPin, SkipForward, Clock, ExternalLink,
} from "lucide-react";

const PAGE = 25;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";
}

const EXEC_STATUS: Record<ExecutionStatus, { label: string; className: string }> = {
  in_progress: { label: "Running", className: "text-amber-600 dark:text-amber-400" },
  completed: { label: "Completed", className: "text-green-600 dark:text-green-400" },
  abandoned: { label: "Abandoned", className: "text-muted-foreground" },
};
const STOP_STATUS: Record<StopStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-muted-foreground" },
  completed: { label: "Completed", className: "text-green-600 dark:text-green-400" },
  skipped: { label: "Skipped", className: "text-amber-600 dark:text-amber-400" },
};

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", tone)}>{icon}</div>
      <div>
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function ExecutionMonitor() {
  const router = useRouter();
  const { accountId } = useAuth();
  const [date, setDate] = useState(todayLocal);
  const [status, setStatus] = useState<"all" | ExecutionStatus>("all");
  const [page, setPage] = useState(0);
  const [openExec, setOpenExec] = useState<RouteExecutionRow | null>(null);

  const summary = useExecutionSummary(accountId, date);
  const statuses = status === "all" ? undefined : [status];
  const q = useExecutions(accountId ? { accountId, date, statuses, limit: PAGE, offset: page * PAGE } : null);

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Execution Monitor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live field visibility — who started, who&apos;s running, who completed, who skipped. Read-only;
          routes are run on the mobile app.
        </p>
      </div>

      {/* Tiles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon={<Activity className="h-5 w-5 text-primary" />} tone="bg-primary/10" label="Started" value={summary.data?.total ?? 0} />
        <Tile icon={<PlayCircle className="h-5 w-5 text-amber-500" />} tone="bg-amber-500/10" label="Currently running" value={summary.data?.running ?? 0} />
        <Tile icon={<CheckCircle2 className="h-5 w-5 text-green-500" />} tone="bg-green-500/10" label="Completed" value={summary.data?.completed ?? 0} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(0); }} className="w-auto" />
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(["all", "in_progress", "completed", "abandoned"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStatus(s); setPage(0); }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {s === "all" ? "All" : EXEC_STATUS[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Salesman</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Progress</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 w-24 rounded bg-muted" /></td>
                    ))}
                  </tr>
                ))
              ) : q.isError ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                    <AlertCircle className="h-8 w-8 text-red-500" />
                    <p className="text-sm text-muted-foreground">Failed to load executions.</p>
                    <Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button>
                  </div>
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                    <MapPin className="h-8 w-8 text-muted-foreground opacity-40" />
                    <p className="text-sm text-muted-foreground">No route runs on this date.</p>
                  </div>
                </td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} onClick={() => setOpenExec(r)} className="cursor-pointer transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium text-foreground">{r.user_name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.route_name ?? "—"}</td>
                    <td className={cn("px-4 py-3 font-medium", EXEC_STATUS[r.status]?.className)}>{EXEC_STATUS[r.status]?.label ?? r.status}</td>
                    <td className="px-4 py-3">
                      <span className="tabular-nums text-foreground">{r.stops_completed}/{r.stops_total}</span>
                      {r.stops_skipped > 0 && (
                        <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          {r.stops_skipped} skipped
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtTime(r.started_at)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtTime(r.completed_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!q.isLoading && !q.isError && total > PAGE && (
          <div className="flex items-center justify-between border-t border-border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
              {q.isFetching && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /> Prev</Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>

      {/* Stops detail sheet */}
      <ExecutionStopsSheet exec={openExec} onClose={() => setOpenExec(null)} onOpenRoute={(rid) => { setOpenExec(null); router.push(`/routes/${rid}`); }} />
    </div>
  );
}

function ExecutionStopsSheet({
  exec, onClose, onOpenRoute,
}: {
  exec: RouteExecutionRow | null;
  onClose: () => void;
  onOpenRoute: (routeId: string) => void;
}) {
  const stops = useExecutionStops(exec?.id ?? null);
  return (
    <Sheet open={!!exec} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        {exec && (
          <>
            <SheetHeader>
              <SheetTitle>{exec.route_name ?? "Route run"}</SheetTitle>
              <SheetDescription>
                {exec.user_name ?? "—"} · {new Date(exec.execution_date).toLocaleDateString()} · {EXEC_STATUS[exec.status]?.label}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {exec.stops_completed} completed · {exec.stops_skipped} skipped · {exec.stops_pending} pending
                </span>
                <Button size="sm" variant="ghost" onClick={() => onOpenRoute(exec.route_id)}>
                  Open route <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
              {stops.isLoading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading stops…</div>
              ) : (stops.data ?? []).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No stops recorded.</p>
              ) : (
                <ul className="overflow-hidden rounded-lg border border-border">
                  {(stops.data ?? []).map((s, i) => (
                    <li key={s.id} className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0">
                      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{s.actual_sequence ?? s.planned_sequence ?? i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{s.company || s.contact_name || "Unnamed"}</p>
                        {s.status === "skipped" && s.skip_reason && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">Reason: {s.skip_reason}</p>
                        )}
                        {s.visited_at && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> {fmtTime(s.visited_at)}</p>
                        )}
                      </div>
                      <span className={cn("shrink-0 text-xs font-medium", STOP_STATUS[s.status]?.className)}>
                        {s.status === "skipped" ? <SkipForward className="mr-1 inline h-3 w-3" /> : null}
                        {STOP_STATUS[s.status]?.label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
