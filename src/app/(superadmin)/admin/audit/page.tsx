"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ScrollText,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Info,
  Filter,
} from "lucide-react";

interface AuditEntry {
  id: string;
  actor_user_id: string;
  actor_email: string | null;
  action: string;
  table_name: string | null;
  target_account_id: string | null;
  filters: Record<string, unknown>;
  row_count: number | null;
  created_at: string;
}

interface AuditAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  kind: string;
  message: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-500 border-red-500/30",
  warning: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  info: "bg-sky-500/10 text-sky-600 border-sky-500/30",
};

const RANGES = [
  { label: "Last hour", hours: 1 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "All time", hours: 0 },
];

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <ShieldAlert className="h-4 w-4 shrink-0" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 shrink-0" />;
  return <Info className="h-4 w-4 shrink-0" />;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [alerts, setAlerts] = useState<AuditAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rangeHours, setRangeHours] = useState(24);
  const [tableFilter, setTableFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 100;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (rangeHours > 0) {
        qs.set("since", new Date(Date.now() - rangeHours * 3600_000).toISOString());
      }
      if (tableFilter) qs.set("table", tableFilter);

      const res = await fetch(`/api/admin/audit?${qs}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load audit log");

      setEntries(payload.entries);
      setAlerts(payload.alerts);
      setTotal(payload.total);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, rangeHours, tableFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const alertsById = new Map<string, AuditAlert[]>();
  for (const a of alerts) {
    alertsById.set(a.id, [...(alertsById.get(a.id) ?? []), a]);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="h-6 w-6 text-primary" />
            Audit Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every cross-tenant read performed through the superadmin panel.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={rangeHours}
            onChange={(e) => {
              setRangeHours(Number(e.target.value));
              setPage(1);
            }}
            className="text-sm bg-muted rounded-md px-2 py-1.5 outline-none"
          >
            {RANGES.map((r) => (
              <option key={r.label} value={r.hours}>
                {r.label}
              </option>
            ))}
          </select>
          <div className="relative">
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={tableFilter}
              onChange={(e) => {
                setTableFilter(e.target.value);
                setPage(1);
              }}
              placeholder="Filter by table…"
              className="pl-7 pr-2 py-1.5 text-sm bg-muted rounded-md outline-none w-44"
            />
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.slice(0, 8).map((a, i) => (
            <div
              key={`${a.id}-${a.kind}-${i}`}
              className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${SEVERITY_STYLES[a.severity]}`}
            >
              <SeverityIcon severity={a.severity} />
              <span>{a.message}</span>
              <span className="ml-auto text-xs uppercase tracking-wide opacity-70">
                {a.severity}
              </span>
            </div>
          ))}
          {alerts.length > 8 && (
            <p className="text-xs text-muted-foreground">
              +{alerts.length - 8} more alerts on this page
            </p>
          )}
        </div>
      )}

      {/* Entries */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {error ? (
          <div className="p-4 text-sm text-red-500">{error}</div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No access recorded in this period. The log fills as the Data Browser
            is used.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  {["When", "Who", "Action", "Table", "Tenant", "Rows", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const rowAlerts = alertsById.get(e.id) ?? [];
                  const worst = rowAlerts.some((a) => a.severity === "critical")
                    ? "critical"
                    : rowAlerts.some((a) => a.severity === "warning")
                      ? "warning"
                      : null;
                  return (
                    <tr
                      key={e.id}
                      className={`border-t border-border ${
                        worst === "critical"
                          ? "bg-red-500/5"
                          : worst === "warning"
                            ? "bg-amber-500/5"
                            : ""
                      }`}
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        {new Date(e.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {e.actor_email ?? e.actor_user_id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                        {e.action}
                      </td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                        {e.table_name ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {e.target_account_id ? (
                          <span className="font-mono">
                            {e.target_account_id.slice(0, 8)}
                          </span>
                        ) : (
                          <span className="text-amber-600">all tenants</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {e.row_count ?? "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        {worst && (
                          <SeverityIcon severity={worst} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-3 p-2 border-t border-border text-xs">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-2 py-1 rounded-md hover:bg-muted disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {page} of {totalPages} · {total.toLocaleString()} entries
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-2 py-1 rounded-md hover:bg-muted disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
