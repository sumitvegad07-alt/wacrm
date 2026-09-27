"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, Play, Trash2 } from "lucide-react";
import { RETENTION_RULES } from "@/lib/retention/policy";
import type { RetentionResult } from "@/lib/retention/run";

interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  mode: string;
  summarised_days: number;
  rows_affected: number;
  detail: Record<string, number> | null;
  error: string | null;
}

const LABELS = new Map(RETENTION_RULES.map((r) => [r.table, r.label]));

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RetentionClient() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [result, setResult] = useState<RetentionResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "delete" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/admin/retention");
    const payload = await res.json().catch(() => ({}));
    if (res.ok) setRuns(payload.runs ?? []);
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  async function run(dryRun: boolean) {
    if (!dryRun) {
      const ok = window.confirm(
        "This permanently deletes data and cannot be undone.\n\n" +
          "GPS points are summarised into a daily row first, and only the points " +
          "that were summarised are removed. Technical logs older than 90 days are " +
          "deleted outright.\n\n" +
          "Have you read a preview and checked the numbers look right?",
      );
      if (!ok) return;
    }

    setBusy(dryRun ? "preview" : "delete");
    setErr(null);

    const res = await fetch("/api/admin/retention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) setErr(payload?.error || "The run failed");
    else setResult(payload as RetentionResult);

    setBusy(null);
    void loadRuns();
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <button
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => router.push("/admin")}
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </button>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2 mt-2">
          <Trash2 className="h-5 w-5" />
          Data Retention
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Runs automatically every night at 1:30 AM IST. Preview here any time — preview changes
          nothing.
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          The nightly job only <b>previews</b> until <code>RETENTION_DELETE_ENABLED=true</code> is
          set in the environment. Read a few nights of previews before switching it on.
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => run(true)}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {busy === "preview" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Preview — change nothing
        </button>
        <button
          onClick={() => run(false)}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-500/10 disabled:opacity-60"
        >
          {busy === "delete" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Run for real
        </button>
      </div>

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      {result && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">
              {result.mode === "preview" ? "Preview — nothing was changed" : "Completed"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {result.accountsProcessed} accounts · {result.summarisedDays} rep-days summarised ·{" "}
              {result.rowsAffected.toLocaleString("en-IN")} rows{" "}
              {result.mode === "preview" ? "would be removed" : "removed"}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">What</th>
                <th className="px-5 py-2 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(result.detail).length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-5 py-4 text-muted-foreground">
                    Nothing is old enough to remove yet.
                  </td>
                </tr>
              ) : (
                Object.entries(result.detail).map(([table, rows]) => (
                  <tr key={table}>
                    <td className="px-5 py-2.5 text-foreground">{LABELS.get(table) ?? table}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                      {rows.toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {result.errors.length > 0 && (
            <div className="px-5 py-3 border-t border-border text-sm text-red-600 dark:text-red-400">
              {result.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Recent runs</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-left font-medium">Mode</th>
              <th className="px-3 py-2 text-right font-medium">Days</th>
              <th className="px-5 py-2 text-right font-medium">Rows</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-4 text-muted-foreground">
                  No runs yet.
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id} className={r.error ? "bg-red-500/5" : undefined}>
                  <td className="px-5 py-2.5 text-foreground">{when(r.started_at)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={
                        r.mode === "delete"
                          ? "text-red-600 dark:text-red-400 font-medium"
                          : "text-muted-foreground"
                      }
                    >
                      {r.mode}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {r.summarised_days}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                    {r.rows_affected.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
