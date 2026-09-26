"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, BarChart3, Info } from "lucide-react";
import { inr } from "@/lib/proposals/format";
import { MIN_DECIDED_FOR_WIN_RATE, summarise, type ForecastRow } from "@/lib/proposals/forecast";

/** "2026-09" → "Sep 26", for axis labels. */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${String(y).slice(2)}`;
}

export default function ForecastClient() {
  const router = useRouter();
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/proposals");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) setErr(payload.error || "Could not load proposals");
      setRows(payload.proposals ?? []);
      setLoading(false);
    })();
  }, []);

  const s = useMemo(() => summarise(rows, new Date()), [rows]);

  const monthlyData = useMemo(
    () => s.monthly.map((m) => ({ ...m, label: monthLabel(m.month) })),
    [s.monthly],
  );
  const renewalData = useMemo(
    () => s.renewals.map((r) => ({ ...r, label: monthLabel(r.month) })),
    [s.renewals],
  );

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-5">
      <div>
        <button
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => router.push("/admin/proposals")}
        >
          <ArrowLeft className="h-4 w-4" />
          All proposals
        </button>
        <h1 className="text-xl font-semibold flex items-center gap-2 mt-1">
          <BarChart3 className="h-5 w-5" />
          Business Forecast
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Built from your own proposals. A deal counts in the month you marked it won.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-700 text-sm px-3 py-2">
          {err}
        </div>
      )}

      {/* ── Headline numbers ───────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          label="Won this month"
          value={`₹${inr(s.wonThisMonth.value)}`}
          sub={`${s.wonThisMonth.count} ${s.wonThisMonth.count === 1 ? "deal" : "deals"}`}
          tone="emerald"
        />
        <Stat
          label="Open pipeline"
          value={`₹${inr(s.pipeline.value)}`}
          sub={`${s.pipeline.count} sent, awaiting a decision`}
          tone="blue"
        />
        <Stat
          label="Expected from pipeline"
          value={s.weightedPipeline === null ? "—" : `₹${inr(s.weightedPipeline)}`}
          sub={
            s.winRate === null
              ? `needs ${MIN_DECIDED_FOR_WIN_RATE - s.decidedCount} more decided`
              : `at your ${Math.round(s.winRate * 100)}% win rate`
          }
          tone="violet"
        />
        <Stat
          label="Renewals, next 12 months"
          value={`₹${inr(s.renewalTotal)}`}
          sub="won deals coming round again"
          tone="amber"
        />
      </div>

      {s.winRate === null && s.decidedCount > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 text-blue-800 text-sm px-3 py-2 flex gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Only {s.decidedCount} {s.decidedCount === 1 ? "proposal has" : "proposals have"} been
            won or lost so far. A win rate from that few is noise, so the expected-value figure
            stays hidden until {MIN_DECIDED_FOR_WIN_RATE} are decided — rather than showing you a
            number that looks precise and isn&apos;t.
          </span>
        </div>
      )}

      {/* ── Won by month ───────────────────────────────────── */}
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-semibold mb-1">Business won, last 12 months</h2>
        <p className="text-xs text-muted-foreground mb-4">
          By the month each deal was marked won, not the month the proposal was written.
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip
                formatter={(v, name) => [`₹${inr(Number(v) || 0)}`, name === "won" ? "Won" : "Lost"]}
                labelFormatter={(l) => `Month: ${l}`}
              />
              <Bar dataKey="won" radius={[4, 4, 0, 0]} fill="#0f9d6b" />
              <Bar dataKey="lost" radius={[4, 4, 0, 0]} fill="#e5e7eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── Renewals ───────────────────────────────────────── */}
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-semibold mb-1">Renewals due, next 12 months</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Every won deal is an annual subscription, so it comes round again a year after it closed.
          This is what is due for renewal, not a promise that it renews — treat it as the
          conversation calendar.
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={renewalData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip
                formatter={(v) => [`₹${inr(Number(v) || 0)}`, "Due for renewal"]}
                labelFormatter={(l) => `Month: ${l}`}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {renewalData.map((r) => (
                  <Cell key={r.month} fill={r.value > 0 ? "#7c3aed" : "#f3f4f6"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── Deal shape ─────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Won, all time" value={`₹${inr(s.wonTotal)}`} sub="every deal you have closed" />
        <Stat
          label="Win rate"
          value={s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`}
          sub={`${s.decidedCount} decided`}
        />
        <Stat label="Average deal" value={`₹${inr(s.avgWonValue)}`} sub="per won proposal" />
        <Stat label="Average team size" value={`${s.avgWonUsers}`} sub="users per won deal" />
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing to forecast yet. Create a proposal, mark it sent when it goes out, then won or
          lost when you hear back.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "emerald" | "blue" | "violet" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "blue"
        ? "text-blue-600"
        : tone === "violet"
          ? "text-violet-600"
          : tone === "amber"
            ? "text-amber-600"
            : "text-foreground";

  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}
