"use client";

// ============================================================
// Lead Discovery UI.
//
// The harvest loop lives here, in the browser, on purpose: one Google search per
// request keeps every request short enough for a serverless function, and the
// founder watches it progress instead of staring at a spinner wondering whether
// a background job died. The trade is that the tab must stay open, which the page
// says out loud and guards with a beforeunload warning.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  Radar,
  Square,
} from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  hasAreaCoverage,
  listAreas,
  listDistricts,
  listStates,
} from "@/lib/revenue/discovery-geography";
import { DISCOVERY_CATEGORIES, DISCOVERY_INDUSTRIES } from "@/lib/revenue/discovery-taxonomy";
import {
  estimateCalls,
  toCsv,
  type DiscoveryRow,
  type SkipReason,
} from "@/lib/revenue/discovery-query";

interface Usage {
  callsToday: number;
  callsThisMonth: number;
  dailyCap: number;
  monthlyFree: number;
  dailyRemaining: number;
  monthlyRemaining: number;
}

interface PlanEntry {
  index: number;
  text: string;
  district: string;
  area: string | null;
  /** Already searched inside the reuse window — skipped without a Google call. */
  done: boolean;
}

interface RunRow {
  id: string;
  industry_label: string;
  category: string;
  state: string;
  districts: string[] | null;
  queries_planned: number;
  calls_used: number;
  rows_new: number;
  status: string;
  started_at: string;
}

interface LogEntry {
  place: string;
  found: number;
  kept: number;
  error: string | null;
}

const DEFAULT_STATE = "Karnataka";

export default function DiscoverClient() {
  const router = useRouter();

  // ── form ──
  const [industry, setIndustry] = useState(DISCOVERY_INDUSTRIES[0].value);
  const [category, setCategory] = useState("manufacturer");
  const [state, setState] = useState(DEFAULT_STATE);
  const [districts, setDistricts] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [pincode, setPincode] = useState("");
  const [includeWithoutPhone, setIncludeWithoutPhone] = useState(false);
  const [ignoreSeen, setIgnoreSeen] = useState(false);

  // ── server state ──
  const [usage, setUsage] = useState<Usage | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [envNames, setEnvNames] = useState<string[]>([]);
  const [pastRuns, setPastRuns] = useState<RunRow[]>([]);

  // ── harvest state ──
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [planLength, setPlanLength] = useState(0);
  const [rows, setRows] = useState<DiscoveryRow[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [skipped, setSkipped] = useState<Record<SkipReason, number>>({
    retail: 0,
    closed: 0,
    no_phone: 0,
    no_id: 0,
  });
  const [duplicates, setDuplicates] = useState(0);
  const [reused, setReused] = useState(0);
  const [stopMessage, setStopMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  // Set when the founder presses Stop, read inside the loop.
  const cancelled = useRef(false);

  const stateOptions = useMemo(() => listStates(), []);
  const districtOptions = useMemo(() => listDistricts(state), [state]);
  const areaOptions = useMemo(() => listAreas(state, districts), [state, districts]);

  const loadUsage = useCallback(async () => {
    const res = await fetch("/api/admin/revenue/discover");
    if (!res.ok) return;
    const payload = await res.json().catch(() => null);
    if (!payload) return;
    setUsage(payload.usage ?? null);
    setHasApiKey(payload.hasApiKey !== false);
    setEnvNames(payload.envNames ?? []);
    setPastRuns(payload.runs ?? []);
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  /**
   * Areas belonging to districts that are no longer selected, dropped here at
   * render instead of being pruned into state. The server cannot attribute such
   * an area to a district and would skip it silently, so what the UI counts and
   * what it sends must both come from this filtered list, never from raw `areas`.
   */
  const activeAreas = useMemo(() => {
    const allowed = new Set(areaOptions.map((o) => o.value));
    return areas.filter((a) => allowed.has(a));
  }, [areas, areaOptions]);

  // Rows live only in this tab until the CSV is saved. Losing them wastes the
  // quota they cost, which is the one thing here that cannot be bought back.
  useEffect(() => {
    const atRisk = running || (rows.length > 0 && !downloaded);
    if (!atRisk) return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, rows.length, downloaded]);

  const source = `Google Maps — ${state}`;

  // What the plan will look like, computed the same way the server will.
  const plannedQueries = useMemo(() => {
    if (districts.length === 0) return 0;
    const coveredByArea = new Set(
      areaOptions.filter((o) => activeAreas.includes(o.value)).map((o) => o.district),
    );
    const districtQueries = districts.filter((d) => !coveredByArea.has(d)).length;
    const pin = /^\d{6}$/.test(pincode.trim()) ? 1 : 0;
    return activeAreas.length + districtQueries + pin;
  }, [districts, activeAreas, areaOptions, pincode]);

  const estimate = useMemo(() => estimateCalls(plannedQueries), [plannedQueries]);

  const overDailyCap = usage ? estimate.expectedCalls > usage.dailyRemaining : false;

  async function startHarvest() {
    setError(null);
    setStopMessage(null);
    setRows([]);
    setLog([]);
    setDone(0);
    setDuplicates(0);
    setReused(0);
    setDownloaded(false);
    setSkipped({ retail: 0, closed: 0, no_phone: 0, no_id: 0 });
    cancelled.current = false;

    const startRes = await fetch("/api/admin/revenue/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        industry,
        category,
        state,
        districts,
        areas: activeAreas,
        pincode: pincode.trim() || null,
        ignoreSeen,
      }),
    });

    const startPayload = await startRes.json().catch(() => ({}));
    if (!startRes.ok) {
      setError(startPayload.error ?? "Could not start the harvest");
      return;
    }

    const runId: string = startPayload.runId;
    const plan: PlanEntry[] = startPayload.plan ?? [];
    setPlanLength(plan.length);
    setRunning(true);

    for (const entry of plan) {
      if (cancelled.current) break;

      if (entry.done) {
        // Paid for in an earlier run and still inside the reuse window. Skipping
        // costs nothing and is what lets a two-day sweep resume where it stopped.
        setReused((r) => r + 1);
        setDone((d) => d + 1);
        continue;
      }

      const res = await fetch("/api/admin/revenue/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "search",
          runId,
          index: entry.index,
          includeWithoutPhone,
          ignoreSeen,
        }),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        // One failed search is not a failed harvest: record it and carry on, so
        // a single bad response does not throw away the whole run.
        setLog((l) => [
          { place: entry.area ?? entry.district, found: 0, kept: 0, error: payload.error ?? "Request failed" },
          ...l,
        ]);
        setDone((d) => d + 1);
        continue;
      }

      const newRows: DiscoveryRow[] = payload.rows ?? [];
      setRows((current) => [...current, ...newRows]);
      setDone((d) => d + 1);
      setDuplicates((d) => d + (payload.duplicates ?? 0));
      setUsage(payload.usage ?? null);
      setSkipped((current) => {
        const next = { ...current };
        for (const key of Object.keys(next) as SkipReason[]) {
          next[key] += payload.skipped?.[key] ?? 0;
        }
        return next;
      });
      setLog((l) => [
        {
          place: entry.area ?? entry.district,
          found: payload.resultsCount ?? 0,
          kept: newRows.length,
          error: payload.error ?? null,
        },
        ...l,
      ]);

      if (payload.stop) {
        setStopMessage(payload.stop);
        break;
      }
    }

    await fetch("/api/admin/revenue/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finish", runId, abandoned: cancelled.current }),
    });

    setRunning(false);
    void loadUsage();
  }

  function downloadCsv() {
    const csv = toCsv(rows, source);
    // The BOM makes Excel on Windows read it as UTF-8, so Kannada names and the
    // rupee sign survive the round trip.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    link.href = URL.createObjectURL(blob);
    link.download = `ozzo-leads-${industry}-${state.toLowerCase().replace(/\s+/g, "-")}-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    setDownloaded(true);
  }

  const totalSkipped = skipped.retail + skipped.closed + skipped.no_phone + skipped.no_id;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <button
          onClick={() => router.push("/admin")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </button>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2 mt-2">
          <Radar className="h-5 w-5" />
          Lead Discovery
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Finds manufacturers and distributors on Google Maps and hands back a CSV for your own
          sales account. Nothing is written to any customer&apos;s data.
        </p>
      </div>

      {!hasApiKey && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <code>GOOGLE_PLACES_API_KEY</code> is not set on the server. Add it in Vercel and
            redeploy — until then the Start button will refuse.
            <span className="block mt-1.5">
              {envNames.length === 0 ? (
                <>
                  The server can see <b>no</b> setting whose name mentions Google, Places or Maps.
                  Vercel is not passing the variable to this project at all — check that it is on
                  the <b>wacrm project&apos;s own</b> Environment Variables, not the Shared tab, and
                  that <b>Production</b> is ticked.
                </>
              ) : (
                <>
                  The server can see these related settings:{" "}
                  {envNames.map((name, i) => (
                    <span key={name}>
                      {i > 0 && ", "}
                      <code>{name}</code>
                    </span>
                  ))}
                  . If the name you want is not in that list, the variable is misnamed; rename it
                  to exactly <code>GOOGLE_PLACES_API_KEY</code> and redeploy.
                </>
              )}
            </span>
          </span>
        </div>
      )}

      {/* ── Quota ── */}
      {usage && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Used today" value={`${usage.callsToday} / ${usage.dailyCap}`} />
          <Stat label="Left today" value={String(usage.dailyRemaining)} />
          <Stat
            label="Used this month"
            value={`${usage.callsThisMonth.toLocaleString("en-IN")} / ${usage.monthlyFree.toLocaleString("en-IN")}`}
          />
          <Stat label="Free calls left" value={usage.monthlyRemaining.toLocaleString("en-IN")} />
        </div>
      )}

      {/* ── Form ── */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Industry">
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              disabled={running}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {DISCOVERY_INDUSTRIES.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Customer category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={running}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {DISCOVERY_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="State">
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setDistricts([]);
                setAreas([]);
              }}
              disabled={running}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {stateOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Pincode (optional)">
            <input
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
              disabled={running}
              placeholder="e.g. 580020"
              inputMode="numeric"
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
        </div>

        <Field
          label={`Districts (${districts.length} of ${districtOptions.length})`}
          action={
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                disabled={running}
                onClick={() => setDistricts(districtOptions.map((d) => d.value))}
                className="text-primary hover:underline disabled:opacity-50"
              >
                Select all
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => setDistricts([])}
                className="text-muted-foreground hover:underline disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          }
        >
          <MultiSelect
            options={districtOptions}
            selectedValues={districts}
            onChange={setDistricts}
            disabled={running}
            searchable
            placeholder="Pick districts…"
          />
        </Field>

        <Field
          label={`Industrial areas (${activeAreas.length} of ${areaOptions.length})`}
          action={
            areaOptions.length > 0 ? (
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setAreas(areaOptions.map((a) => a.value))}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setAreas([])}
                  className="text-muted-foreground hover:underline disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            ) : null
          }
        >
          <MultiSelect
            options={areaOptions}
            selectedValues={activeAreas}
            onChange={setAreas}
            disabled={running || areaOptions.length === 0}
            searchable
            placeholder={
              districts.length === 0
                ? "Pick districts first…"
                : hasAreaCoverage(state)
                  ? "Optional — picking areas finds far more companies…"
                  : `${state} has no industrial-area list yet — districts only`
            }
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            A district searched whole stops at 60 results. Each industrial area is its own separate
            60, so picking areas is what turns a few hundred companies into a few thousand. A
            district with areas picked is <b>not</b> also searched whole.
          </p>
        </Field>

        <div className="flex flex-col gap-2 pt-1">
          <Check
            checked={includeWithoutPhone}
            onChange={setIncludeWithoutPhone}
            disabled={running}
            label="Keep businesses with no phone number"
            hint="Off by default — a lead you cannot ring is not worth a row."
          />
          <Check
            checked={ignoreSeen}
            onChange={setIgnoreSeen}
            disabled={running}
            label="Ignore my previous harvests"
            hint="Normally companies you have already pulled are hidden. Tick this to pull a district again from scratch."
          />
        </div>

        {/* ── Estimate ── */}
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          {plannedQueries === 0 ? (
            <span className="text-muted-foreground">Pick at least one district to see the cost.</span>
          ) : (
            <>
              <p className="text-foreground">
                <b>{plannedQueries}</b> searches · about <b>{estimate.expectedCalls}</b> calls
                (worst case {estimate.maxCalls}) · up to{" "}
                <b>{(plannedQueries * 60).toLocaleString("en-IN")}</b> companies before duplicates.
              </p>
              {usage && (
                <p className={`mt-1 ${overDailyCap ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {overDailyCap
                    ? `That is more than today's ${usage.dailyRemaining} remaining calls. It will run until the cap, then stop — finish the rest tomorrow.`
                    : `You have ${usage.dailyRemaining} calls left today.`}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => void startHarvest()}
            disabled={running || plannedQueries === 0 || !hasApiKey}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? `Searching… ${done} of ${planLength}` : "Start crawling Google Maps"}
          </button>

          {running && (
            <button
              onClick={() => {
                cancelled.current = true;
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted"
            >
              <Square className="h-4 w-4" />
              Stop
            </button>
          )}

          {rows.length > 0 && (
            <button
              onClick={downloadCsv}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/10"
            >
              <Download className="h-4 w-4" />
              Download {rows.length.toLocaleString("en-IN")} leads as CSV
            </button>
          )}
        </div>

        {running && (
          <p className="text-xs text-muted-foreground">
            Keep this tab open — the results live here until you download the CSV.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {stopMessage && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{stopMessage}</span>
        </div>
      )}

      {!running && rows.length === 0 && reused > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm flex gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <span>
            All {reused} of these searches were already done in the last 45 days, so nothing was
            fetched and no quota was spent. Tick <b>Ignore my previous harvests</b> to run them
            again, or pick different districts.
          </span>
        </div>
      )}

      {rows.length > 0 && !running && !downloaded && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>
            {rows.length.toLocaleString("en-IN")} companies found. Download the CSV before you leave
            this page — these rows are not saved anywhere else, and re-running costs quota.
          </span>
        </div>
      )}

      {/* ── Progress ── */}
      {log.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">
              {rows.length.toLocaleString("en-IN")} kept · {duplicates.toLocaleString("en-IN")}{" "}
              duplicates removed · {totalSkipped.toLocaleString("en-IN")} dropped
              {reused > 0 && ` · ${reused} searches reused free`}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Dropped: {skipped.retail} shops and consumer services · {skipped.no_phone} with no
              phone · {skipped.closed} closed down
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Place</th>
                  <th className="px-5 py-2 text-right font-medium">Found</th>
                  <th className="px-5 py-2 text-right font-medium">Kept</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry, i) => (
                  <tr key={`${entry.place}-${i}`} className="border-t border-border">
                    <td className="px-5 py-2 text-foreground">
                      {entry.place}
                      {entry.error && (
                        <span className="block text-xs text-red-600 dark:text-red-400">
                          {entry.error}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right text-muted-foreground">{entry.found}</td>
                    <td className="px-5 py-2 text-right text-foreground font-medium">{entry.kept}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── History ── */}
      {pastRuns.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Past harvests</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">When</th>
                <th className="px-5 py-2 text-left font-medium">What</th>
                <th className="px-5 py-2 text-right font-medium">Calls</th>
                <th className="px-5 py-2 text-right font-medium">New leads</th>
              </tr>
            </thead>
            <tbody>
              {pastRuns.map((run) => (
                <tr key={run.id} className="border-t border-border">
                  <td className="px-5 py-2 text-muted-foreground whitespace-nowrap">
                    {new Date(run.started_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-2 text-foreground">
                    {run.industry_label} · {run.category} · {run.state}
                    <span className="text-muted-foreground">
                      {" "}
                      ({(run.districts ?? []).length} districts)
                    </span>
                  </td>
                  <td className="px-5 py-2 text-right text-muted-foreground">{run.calls_used}</td>
                  <td className="px-5 py-2 text-right text-foreground font-medium">
                    {run.rows_new.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          <b>Google Maps lists businesses, not people</b> — the Contact Person and Email columns come
          out blank. You are calling a switchboard and asking who handles sales.
        </p>
        <p>
          Import the CSV into your own sales account through Leads → Import. Phone numbers are
          written as 91XXXXXXXXXX so WhatsApp and the duplicate check both read them correctly.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground mt-0.5">{value}</p>
    </div>
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-medium text-foreground">{label}</label>
        {action}
      </div>
      {children}
    </div>
  );
}

function Check({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
      />
      <span>
        <span className="text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
