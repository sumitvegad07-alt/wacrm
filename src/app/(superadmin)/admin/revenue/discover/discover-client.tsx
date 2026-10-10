"use client";

// ============================================================
// Lead Discovery UI.
//
// This page does not harvest anything. It fills in a form, asks the server to
// start a harvest, and then watches.
//
// IT USED TO RUN THE LOOP ITSELF, AND THAT WAS THE BUG
//
// One Google search per request, rows held in React state, and a line of text
// asking the founder to keep the tab open. The reasoning was that ~163 searches
// cannot fit in one serverless invocation — true — but the conclusion did not
// follow. Nobody watches a progress bar for ten minutes. He starts a harvest
// and goes to do other work, which is exactly when Chrome discards the tab and
// the loop dies with it. Saving rows as they arrived made that recoverable, and
// resuming automatically made the recovery invisible, but both were treatments
// for something that should never have been the browser's job.
//
// So the server owns it now (see discovery-runner.ts). Everything below is a
// view of a job: start it, see how far it has got, stop it, take the CSV. Close
// the tab whenever you like.
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
  X,
} from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  hasAreaCoverage,
  listAreas,
  listDistricts,
  listStates,
} from "@/lib/revenue/discovery-geography";
import { DISCOVERY_CATEGORIES, DISCOVERY_INDUSTRIES } from "@/lib/revenue/discovery-taxonomy";
import { estimateCalls, toCsv, type DiscoveryRow } from "@/lib/revenue/discovery-query";
import {
  clearDraft,
  readDraft,
  writeDraft,
  type DiscoveryDraft,
} from "@/lib/revenue/discovery-draft";

interface Usage {
  callsToday: number;
  callsThisMonth: number;
  dailyCap: number;
  monthlyFree: number;
  dailyRemaining: number;
  monthlyRemaining: number;
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
  /** Rows still held server-side, so this harvest's CSV can be saved again. */
  leads_stored: number;
  status: string;
  started_at: string;
}

/** A harvest the server is working on, or has paused. */
interface ActiveRun {
  id: string;
  status: string;
  industry: string;
  industry_label: string;
  category: string;
  state: string;
  districts: string[] | null;
  queries_planned: number;
  queries_done: number;
  next_index: number;
  calls_used: number;
  rows_new: number;
  leads_stored: number;
  stop_reason: string | null;
  last_error: string | null;
  cancel_requested: boolean;
  heartbeat_at: string | null;
  started_at: string;
}

interface SearchLogRow {
  query_text: string;
  district: string | null;
  area: string | null;
  results_count: number;
  new_count: number;
  error: string | null;
  created_at: string;
}

/** How often the page asks how the harvest is getting on. */
const POLL_MS = 4000;

export default function DiscoverClient() {
  const router = useRouter();

  // ── form ──
  //
  // Everything starts empty. The page used to open on Seeds / Manufacturer /
  // Karnataka, which looks like a decision already taken and is wrong for most
  // harvests — a preset that has to be noticed and undone is worse than a blank.
  const [industry, setIndustry] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState("");
  const [districts, setDistricts] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [pincode, setPincode] = useState("");
  const [includeWithoutPhone, setIncludeWithoutPhone] = useState(false);
  const [ignoreSeen, setIgnoreSeen] = useState(false);

  /**
   * False until the saved draft has been read back.
   *
   * Without this the first render would immediately save its own empty form
   * over the draft it is about to restore — the bug would be invisible and
   * would eat exactly the work this is here to protect.
   */
  const [hydrated, setHydrated] = useState(false);

  // ── server state ──
  const [usage, setUsage] = useState<Usage | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [envNames, setEnvNames] = useState<string[]>([]);
  const [already, setAlready] = useState<{
    total: number;
    alreadyDone: number;
    lastRunAt: string | null;
    storedRows: number;
  } | null>(null);
  const [pastRuns, setPastRuns] = useState<RunRow[]>([]);
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [recent, setRecent] = useState<SearchLogRow[]>([]);
  const [justFinished, setJustFinished] = useState<ActiveRun | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The harvest the page was last watching, so it can tell when it ends. */
  const watching = useRef<ActiveRun | null>(null);

  const industryOptions = useMemo(
    () => DISCOVERY_INDUSTRIES.map((i) => ({ value: i.value, label: i.label })),
    [],
  );
  const stateOptions = useMemo(() => listStates(), []);
  const districtOptions = useMemo(() => listDistricts(state), [state]);
  const areaOptions = useMemo(() => listAreas(state, districts), [state, districts]);

  const loadAll = useCallback(async () => {
    const res = await fetch("/api/admin/revenue/discover");
    if (!res.ok) return;
    const payload = await res.json().catch(() => null);
    if (!payload) return;

    setUsage(payload.usage ?? null);
    setHasApiKey(payload.hasApiKey !== false);
    setEnvNames(payload.envNames ?? []);
    setPastRuns(payload.runs ?? []);
    setActive(payload.active ?? null);
    setRecent(payload.recent ?? []);
    watching.current = payload.active ?? null;
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── the form remembers itself ──

  /**
   * Restore what was typed last time, once, before anything is saved over it.
   *
   * In an effect rather than in the useState initialisers because this page is
   * still server-rendered: reading localStorage during the first render would
   * give the server an empty form and the browser a full one, which is a
   * hydration mismatch. Reading it after mount is the supported way round that.
   */
  useEffect(() => {
    const draft = readDraft();
    setIndustry(draft.industry);
    setCategory(draft.category);
    setState(draft.state);
    setDistricts(draft.districts);
    setAreas(draft.areas);
    setPincode(draft.pincode);
    setIncludeWithoutPhone(draft.includeWithoutPhone);
    setIgnoreSeen(draft.ignoreSeen);
    setHydrated(true);
  }, []);

  const draft: DiscoveryDraft = useMemo(
    () => ({ industry, category, state, districts, areas, pincode, includeWithoutPhone, ignoreSeen }),
    [industry, category, state, districts, areas, pincode, includeWithoutPhone, ignoreSeen],
  );

  useEffect(() => {
    if (hydrated) writeDraft(draft);
  }, [hydrated, draft]);

  function resetForm() {
    setIndustry("");
    setCategory("");
    setState("");
    setDistricts([]);
    setAreas([]);
    setPincode("");
    setIncludeWithoutPhone(false);
    setIgnoreSeen(false);
    clearDraft();
  }

  const formTouched =
    industry !== "" ||
    category !== "" ||
    state !== "" ||
    districts.length > 0 ||
    pincode !== "" ||
    includeWithoutPhone ||
    ignoreSeen;

  /**
   * Areas belonging to districts that are no longer selected, dropped here at
   * render instead of being pruned into state. The server cannot attribute such
   * an area to a district and would skip it silently, so what the UI counts and
   * what it sends must both come from this filtered list, never from raw
   * `areas`.
   */
  const activeAreas = useMemo(() => {
    const allowed = new Set(areaOptions.map((o) => o.value));
    return areas.filter((a) => allowed.has(a));
  }, [areas, areaOptions]);

  const running = active !== null;

  // ── watching the harvest ──
  //
  // Polling, not a subscription: the only thing being watched is a row that
  // changes every second or two, the page is open for minutes at a time, and a
  // realtime channel for one row is more to keep working than it is worth.
  useEffect(() => {
    if (!active) return;

    let live = true;
    const timer = setInterval(async () => {
      const res = await fetch("/api/admin/revenue/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      if (!live || !res.ok) return;

      const payload = await res.json().catch(() => null);
      if (!live || !payload) return;

      setUsage(payload.usage ?? null);
      setRecent(payload.recent ?? []);

      const next: ActiveRun | null = payload.active ?? null;

      // It has ended. Keep the last thing we knew about it on screen, so the
      // page says what happened and offers the CSV instead of going blank.
      if (!next && watching.current) {
        setJustFinished(watching.current);
        watching.current = null;
        void loadAll();
      } else {
        watching.current = next;
      }

      setActive(next);
    }, POLL_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, loadAll]);

  // What the plan will look like, computed the same way the server will.
  const plannedQueries = useMemo(() => {
    // Nothing is planned until every required choice is made. With the presets
    // gone, an industry or a state left blank is the normal state of the form,
    // not an error to shout about.
    if (!industry || !category || !state) return 0;
    if (districts.length === 0) return 0;

    const coveredByArea = new Set(
      areaOptions.filter((o) => activeAreas.includes(o.value)).map((o) => o.district),
    );
    const districtQueries = districts.filter((d) => !coveredByArea.has(d)).length;
    const pin = /^\d{6}$/.test(pincode.trim()) ? 1 : 0;
    return activeAreas.length + districtQueries + pin;
  }, [industry, category, state, districts, activeAreas, areaOptions, pincode]);

  const estimate = useMemo(() => estimateCalls(plannedQueries), [plannedQueries]);

  /**
   * Checks the chosen combination against past harvests. Debounced because it
   * fires on every tick of a district or area box, and delayed work is dropped
   * on cleanup so a slow answer cannot overwrite a newer one.
   */
  useEffect(() => {
    if (running || plannedQueries === 0) {
      setAlready(null);
      return;
    }

    let live = true;
    const timer = setTimeout(async () => {
      const res = await fetch("/api/admin/revenue/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          industry,
          category,
          state,
          districts,
          areas: activeAreas,
          pincode: pincode.trim() || null,
        }),
      });
      if (!live || !res.ok) return;
      const payload = await res.json().catch(() => null);
      if (live && payload) setAlready(payload);
    }, 400);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [running, plannedQueries, industry, category, state, districts, activeAreas, pincode]);

  const overDailyCap = usage ? estimate.expectedCalls > usage.dailyRemaining : false;

  /**
   * Hands the harvest to the server and stops thinking about it.
   *
   * `force` is the "search Google again anyway" path: it overrides the
   * Ignore-my-previous-harvests tick for this one run, so a combination already
   * pulled is fetched again, companies and all, instead of being a dead end.
   */
  async function startHarvest(force = false) {
    setBusy("start");
    setError(null);
    setJustFinished(null);

    const res = await fetch("/api/admin/revenue/discover", {
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
        ignoreSeen: ignoreSeen || force,
        includeWithoutPhone,
      }),
    });

    const payload = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(payload.error ?? "Could not start the harvest");
      if (payload.activeRunId) void loadAll();
      return;
    }

    setRecent([]);
    watching.current = payload.active ?? null;
    setActive(payload.active ?? null);
  }

  /** Asks it to stop after the search in flight. */
  async function stopHarvest() {
    if (!active) return;
    setBusy("stop");

    await fetch("/api/admin/revenue/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", runId: active.id }),
    });

    setBusy(null);
    void loadAll();
  }

  /**
   * Hands back a harvest's CSV without touching Google.
   *
   * This is why the rows are stored: a CSV saved to the wrong folder, or opened
   * and closed without saving, used to mean paying the quota again.
   */
  async function downloadRun(runId: string) {
    setBusy(runId);
    setError(null);

    const res = await fetch("/api/admin/revenue/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rows", runId }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(payload.error ?? "Could not read that harvest back");
      return;
    }
    if ((payload.rows ?? []).length === 0) {
      setError(
        "That harvest's rows are no longer stored — they are kept for 90 days, and harvests from before this feature existed kept none at all.",
      );
      return;
    }

    saveCsv(payload.rows, payload.source, `${payload.industry || "leads"}-${payload.state || "india"}`);
  }

  /** Last time's rows for exactly what is on the form, free of quota. */
  async function downloadPriorRows() {
    setBusy("prior");
    setError(null);

    const res = await fetch("/api/admin/revenue/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "priorRows",
        industry,
        category,
        state,
        districts,
        areas: activeAreas,
        pincode: pincode.trim() || null,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(payload.error ?? "Could not read back what that search found last time");
      return;
    }
    if ((payload.rows ?? []).length === 0) {
      setError(
        "Nothing stored for that search. It was run more than 90 days ago, or before harvested rows were kept at all — search Google again to get the companies.",
      );
      return;
    }

    saveCsv(payload.rows, payload.source, `${industry || "leads"}-${state || "india"}`);
  }

  /**
   * What is still missing before a cost can be quoted. Names the one next thing
   * to do rather than listing everything — with no presets, an empty form is
   * where every harvest starts.
   */
  const missingChoice =
    industry === ""
      ? "Pick an industry to see the cost."
      : category === ""
        ? "Pick a customer category to see the cost."
        : state === ""
          ? "Pick a state to see the cost."
          : "Pick at least one district to see the cost.";

  /** Every search in this selection has already been run and nothing is new. */
  const fullyHarvested = already !== null && already.total > 0 && already.alreadyDone === already.total;

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

      {/* ── The harvest the server is working on ── */}
      {active && <ActivePanel run={active} onStop={() => void stopHarvest()} busy={busy === "stop"} />}

      {/* ── The one that just ended ── */}
      {!active && justFinished && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex flex-wrap items-center gap-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 min-w-[16rem]">
            <b>
              {justFinished.industry_label} · {justFinished.state}
            </b>{" "}
            has finished — {justFinished.queries_planned} searches,{" "}
            {justFinished.calls_used.toLocaleString("en-IN")} calls spent.
          </span>
          <button
            onClick={() => void downloadRun(justFinished.id)}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {busy === justFinished.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download the CSV
          </button>
          <button
            onClick={() => setJustFinished(null)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
            Dismiss
          </button>
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
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            What you pick here is kept in this browser, so leaving the page or switching tabs does
            not lose it.
          </p>
          {formTouched && !running && (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              Clear the form
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Industry">
            <SearchableSelect
              options={industryOptions}
              value={industry}
              onChange={setIndustry}
              disabled={running}
              placeholder="Pick an industry"
              searchPlaceholder="Type to find an industry…"
            />
          </Field>

          <Field label="Customer category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={running}
              className={`w-full h-10 rounded-md border border-input bg-background px-3 text-sm ${
                category === "" ? "text-muted-foreground" : ""
              }`}
            >
              <option value="">Pick a category</option>
              {DISCOVERY_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="State">
            <SearchableSelect
              options={stateOptions}
              value={state}
              onChange={(next) => {
                setState(next);
                // Districts and areas belong to the old state; keeping them would
                // build a plan for places that are not in the state any more.
                setDistricts([]);
                setAreas([]);
              }}
              disabled={running}
              placeholder="Pick a state"
              searchPlaceholder="Type to find a state…"
            />
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
            disabled={running || state === ""}
            searchable
            placeholder={state === "" ? "Pick a state first…" : "Pick districts…"}
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
            <span className="text-muted-foreground">{missingChoice}</span>
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
                    ? `That is more than today's ${usage.dailyRemaining} remaining calls. It will run until the cap, pause, and carry on by itself tomorrow.`
                    : `You have ${usage.dailyRemaining} calls left today.`}
                </p>
              )}

              {already && already.alreadyDone > 0 && (
                <p className="mt-2 text-amber-600 dark:text-amber-400">
                  {already.alreadyDone === already.total ? (
                    <>
                      <b>You have already done this exact search.</b> All {already.total} of these
                      searches were run
                      {already.lastRunAt ? ` on ${whenShort(already.lastRunAt)}` : " recently"}, so
                      starting again would find nothing new — the companies it would return are the
                      ones you already have.
                      <span className="block mt-1 text-foreground">
                        {already.storedRows > 0
                          ? `Take last time's ${already.storedRows.toLocaleString("en-IN")} companies again below for free, or search Google anyway if you think the listings have changed.`
                          : "Nothing of that harvest is stored any more, so getting the companies again means searching Google again."}
                      </span>
                    </>
                  ) : (
                    <>
                      <b>Partly done already.</b> {already.alreadyDone} of these {already.total}{" "}
                      searches were run
                      {already.lastRunAt ? ` on ${whenShort(already.lastRunAt)}` : " recently"} and
                      will be skipped free of charge. Only{" "}
                      <b>{already.total - already.alreadyDone}</b> will actually be searched.
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {/*
            An already-harvested selection is not a dead end. It used to disable
            Start, which left the only two useful answers — "give me last time's
            rows" and "look again anyway" — unreachable.
          */}
          {fullyHarvested && !running ? (
            <>
              {already.storedRows > 0 && (
                <button
                  onClick={() => void downloadPriorRows()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                >
                  {busy === "prior" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Download last time&apos;s {already.storedRows.toLocaleString("en-IN")} leads — free
                </button>
              )}
              <button
                onClick={() => void startHarvest(true)}
                disabled={!hasApiKey || busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber-500/40 text-amber-700 dark:text-amber-300 text-sm font-semibold hover:bg-amber-500/10 disabled:opacity-60"
              >
                <Play className="h-4 w-4" />
                Search Google again anyway — about {estimate.expectedCalls} calls
              </button>
            </>
          ) : (
            <button
              onClick={() => void startHarvest()}
              disabled={running || plannedQueries === 0 || !hasApiKey || busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {busy === "start" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {running ? "A harvest is already going" : "Start crawling Google Maps"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* ── What it has been searching ── */}
      {recent.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Last searches</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Newest first. &ldquo;Kept&rdquo; is what survived the filters and the duplicate check.
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
                {recent.map((entry, i) => (
                  <tr key={`${entry.query_text}-${i}`} className="border-t border-border">
                    <td className="px-5 py-2 text-foreground">
                      {entry.area ?? entry.district ?? entry.query_text}
                      {entry.error && (
                        <span className="block text-xs text-red-600 dark:text-red-400">
                          {entry.error}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right text-muted-foreground">
                      {entry.results_count}
                    </td>
                    <td className="px-5 py-2 text-right text-foreground font-medium">
                      {entry.new_count}
                    </td>
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
            <p className="text-xs text-muted-foreground mt-0.5">
              Rows are kept for 90 days, so a CSV can be saved again without spending the quota a
              second time. Harvests older than that — and any run from before this was added — keep
              only their counts.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">When</th>
                <th className="px-5 py-2 text-left font-medium">What</th>
                <th className="px-5 py-2 text-right font-medium">Calls</th>
                <th className="px-5 py-2 text-right font-medium">New leads</th>
                <th className="px-5 py-2 text-right font-medium">CSV</th>
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
                  <td className="px-5 py-2 text-right whitespace-nowrap">
                    {run.leads_stored > 0 ? (
                      <button
                        onClick={() => void downloadRun(run.id)}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 text-primary hover:underline disabled:opacity-50"
                      >
                        {busy === run.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {run.leads_stored.toLocaleString("en-IN")}
                      </button>
                    ) : (
                      <span className="text-muted-foreground" title="Rows are kept for 90 days">
                        —
                      </span>
                    )}
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

/** The harvest in flight: what it is doing, and the one button that matters. */
function ActivePanel({ run, onStop, busy }: { run: ActiveRun; onStop: () => void; busy: boolean }) {
  const planned = Math.max(run.queries_planned, 1);
  const percent = Math.min(100, Math.round((run.next_index / planned) * 100));
  // Paused means waiting for a cap to lift. Nothing is wrong and nothing needs
  // doing — saying "running" would be a lie, and "stopped" would invite a
  // restart that is not needed.
  const paused = run.stop_reason !== null && run.status === "queued";

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {paused ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        )}
        <span className="flex-1 min-w-[16rem] text-sm">
          <b>
            {run.industry_label} · {run.state}
          </b>{" "}
          — {run.next_index} of {run.queries_planned} searches ·{" "}
          {run.leads_stored.toLocaleString("en-IN")} companies saved ·{" "}
          {run.calls_used.toLocaleString("en-IN")} calls spent
          <span className="block text-xs text-muted-foreground mt-1">
            {run.cancel_requested
              ? "Stopping after the search in flight…"
              : paused
                ? run.stop_reason
                : "Running on the server. Close this tab, switch browsers, shut the laptop — it carries on, and the companies are saved as they are found."}
          </span>
        </span>
        <button
          onClick={onStop}
          disabled={busy || run.cancel_requested}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
          Stop
        </button>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${paused ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {run.last_error && <p className="text-xs text-red-600 dark:text-red-400">{run.last_error}</p>}
    </div>
  );
}

/**
 * Writes rows out as a CSV download.
 *
 * The BOM makes Excel on Windows read the file as UTF-8, so Kannada names and
 * the rupee sign survive the round trip.
 */
function saveCsv(rows: DiscoveryRow[], source: string, label: string): void {
  const blob = new Blob(["﻿", toCsv(rows, source)], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);

  link.href = URL.createObjectURL(blob);
  link.download = `ozzo-leads-${slug(label)}-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function whenShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
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
