"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Info,
  CheckCircle2,
  UserX,
} from "lucide-react";
import {
  healthLevel,
  signalsFor,
  type FleetSummary,
  type SignalLevel,
  type TenantHealth,
} from "@/lib/admin/health";

const LEVEL_STYLES: Record<SignalLevel, string> = {
  critical: "text-red-500",
  warn: "text-amber-600",
  info: "text-sky-600",
  ok: "text-emerald-600",
};

const ROW_TINT: Record<SignalLevel, string> = {
  critical: "bg-red-500/5",
  warn: "bg-amber-500/5",
  info: "",
  ok: "",
};

function LevelIcon({ level }: { level: SignalLevel }) {
  const cls = `h-4 w-4 shrink-0 ${LEVEL_STYLES[level]}`;
  if (level === "critical") return <ShieldAlert className={cls} />;
  if (level === "warn") return <AlertTriangle className={cls} />;
  if (level === "info") return <Info className={cls} />;
  return <CheckCircle2 className={cls} />;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  return "just now";
}

function SummaryTile({
  label,
  value,
  tone = "",
  hint,
}: {
  label: string;
  value: number | string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export default function TenantHealthPage() {
  const [tenants, setTenants] = useState<TenantHealth[]>([]);
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/health");
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Failed to load health");
        setTenants(payload.tenants);
        setSummary(payload.summary);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Tenant Health
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every tenant, worst first. Signals surface the quietly-wrong states
          that never raise an error.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryTile label="Tenants" value={summary.total} />
          <SummaryTile
            label="Critical"
            value={summary.critical}
            tone={summary.critical > 0 ? "text-red-500" : ""}
          />
          <SummaryTile
            label="Warning"
            value={summary.warn}
            tone={summary.warn > 0 ? "text-amber-600" : ""}
          />
          <SummaryTile label="Healthy" value={summary.ok} tone="text-emerald-600" />
          <SummaryTile
            label="Never activated"
            value={summary.inactive}
            hint="Excluded from MRR"
          />
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                {[
                  "",
                  "Tenant",
                  "Plan",
                  "Users",
                  "Last login",
                  "Contacts",
                  "Orders",
                  "Payments",
                  "7d activity",
                  "Last GPS",
                  "Signals",
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
              {tenants.map((t) => {
                const signals = signalsFor(t);
                const level = healthLevel(signals);
                return (
                  <tr
                    key={t.account_id}
                    className={`border-t border-border align-top ${ROW_TINT[level]}`}
                  >
                    <td className="px-3 py-2">
                      <LevelIcon level={level} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/admin/companies/${t.account_id}`}
                        className="font-medium hover:text-primary"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {t.subscription_plan ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {t.user_count === 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <UserX className="h-3.5 w-3.5" />0
                        </span>
                      ) : (
                        t.user_count
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {ago(t.last_login_at)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{t.contacts}</td>
                    <td className="px-3 py-2 tabular-nums">{t.orders}</td>
                    <td className="px-3 py-2 tabular-nums">{t.payments}</td>
                    <td className="px-3 py-2 tabular-nums">{t.records_last_7d}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {ago(t.last_ping_at)}
                    </td>
                    <td className="px-3 py-2">
                      {signals.length === 0 ? (
                        <span className="text-emerald-600 text-xs">Healthy</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {signals.map((s) => (
                            <li
                              key={s.code}
                              className={`text-xs ${LEVEL_STYLES[s.level]}`}
                            >
                              {s.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
