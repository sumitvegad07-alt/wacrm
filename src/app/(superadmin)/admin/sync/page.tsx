"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Loader2,
  RefreshCw,
  AlertTriangle,
  PauseCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SyncHealth {
  account_id: string;
  name: string;
  events_pending: number;
  events_failed: number;
  events_done: number;
  events_stuck: number;
  last_event_at: string | null;
  last_processed_at: string | null;
  pending_steps: number;
  orders_in_review: number;
  deliveries_failed: number;
}

interface SyncEvent {
  id: string;
  account_id: string;
  module: string;
  event_type: string;
  record_id: string | null;
  status: string;
  attempts: number | null;
  last_error: string | null;
  skip_reason: string | null;
  occurred_at: string;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const d = Math.floor(ms / 86_400_000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(ms / 3_600_000);
  if (h > 0) return `${h}h ago`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
}

export default function SyncInspectorPage() {
  const [health, setHealth] = useState<SyncHealth[]>([]);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sync");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load");
      setHealth(payload.health);
      setEvents(payload.events);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: "retry" | "force_reprocess") => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, eventIds: [...selected] }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed");
      toast.success(`${payload.requeued} event(s) requeued`);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const totalStuck = health.reduce((n, h) => n + h.events_stuck, 0);
  const totalFailed = health.reduce((n, h) => n + h.events_failed, 0);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Sync &amp; Error Inspector
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Where “it didn’t sync” gets an answer.
          </p>
        </div>
        <Button variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* A stalled queue produces no errors anywhere — it deserves the loudest
          treatment on the page. */}
      {totalStuck > 0 && (
        <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 p-4">
          <p className="flex items-center gap-2 font-semibold text-red-600">
            <PauseCircle className="h-5 w-5" />
            Queue is not moving
          </p>
          <p className="text-sm text-red-600/90 mt-1">
            {totalStuck} event(s) were enqueued over an hour ago and have never
            been attempted. This means nothing is consuming the automation
            queue — not that individual events are failing. Retrying will not
            help until the worker runs.
          </p>
        </div>
      )}

      {/* Per-tenant */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Per-tenant queue health</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                {[
                  "Tenant",
                  "Pending",
                  "Stuck",
                  "Failed",
                  "Processed",
                  "Steps queued",
                  "Orders in review",
                  "Failed sends",
                  "Last event",
                  "Last processed",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {health
                .filter(
                  (h) =>
                    h.events_pending + h.events_failed + h.events_done +
                      h.pending_steps + h.orders_in_review >
                    0,
                )
                .map((h) => (
                  <tr key={h.account_id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {h.name}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{h.events_pending}</td>
                    <td
                      className={`px-3 py-2 tabular-nums font-semibold ${h.events_stuck > 0 ? "text-red-500" : ""}`}
                    >
                      {h.events_stuck}
                    </td>
                    <td
                      className={`px-3 py-2 tabular-nums ${h.events_failed > 0 ? "text-amber-600" : ""}`}
                    >
                      {h.events_failed}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {h.events_done}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{h.pending_steps}</td>
                    <td
                      className={`px-3 py-2 tabular-nums ${h.orders_in_review > 0 ? "text-amber-600" : ""}`}
                    >
                      {h.orders_in_review}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {h.deliveries_failed}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {ago(h.last_event_at)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {ago(h.last_processed_at)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Individual records */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold">
            Unprocessed &amp; failed records
          </h2>
          <span className="text-xs text-muted-foreground">
            {events.length} shown{totalFailed > 0 && ` · ${totalFailed} failed`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {selected.size} selected
            </span>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={selected.size === 0 || busy}
              onClick={() => act("retry")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={selected.size === 0 || busy}
              title="Also resets the attempt counter"
              onClick={() => act("force_reprocess")}
            >
              <Zap className="h-3.5 w-3.5" />
              Force reprocess
            </Button>
          </div>
        </div>

        {events.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            Nothing pending or failed. Queues are clear.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[36rem]">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={selected.size === events.length && events.length > 0}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? new Set(events.map((v) => v.id))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  {[
                    "Module",
                    "Event",
                    "Record",
                    "Status",
                    "Attempts",
                    "Reason",
                    "When",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className={`border-t border-border ${
                      e.status === "failed" ? "bg-amber-500/5" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                      />
                    </td>
                    <td className="px-3 py-1.5 font-mono">{e.module}</td>
                    <td className="px-3 py-1.5 font-mono">{e.event_type}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {e.record_id?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          e.status === "failed"
                            ? "text-amber-600"
                            : (e.attempts ?? 0) === 0
                              ? "text-red-500"
                              : "text-muted-foreground"
                        }
                      >
                        {e.status}
                        {e.status === "pending" && (e.attempts ?? 0) === 0 && (
                          <span className="ml-1 opacity-70">(never tried)</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{e.attempts ?? 0}</td>
                    <td
                      className="px-3 py-1.5 max-w-xs truncate"
                      title={e.last_error ?? e.skip_reason ?? ""}
                    >
                      {e.last_error ?? e.skip_reason ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                      {ago(e.occurred_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalFailed === 0 && totalStuck === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4" />
          Note: this inspects server-side queues. Records still unsynced on a
          rep’s phone are not visible here — nothing has reached the server yet.
        </p>
      )}
    </div>
  );
}
