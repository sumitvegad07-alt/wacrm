"use client";

// ============================================================
// Lead Discovery UI.
//
// The harvest loop lives here, in the browser, on purpose: one Google search per
// request keeps every request short enough for a serverless function, and the
// founder watches it progress instead of staring at a spinner wondering whether
// a background job died.
//
// WHAT THE TAB NO LONGER OWNS
//
// The trade used to be that the tab had to stay open or the harvest was lost —
// and Chrome discarding a background tab, or one click on another menu item,
// lost it. Two things fixed that, both of them outside React state:
//
//   * the form is written to localStorage as it is filled in, so nothing has to
//     be typed twice (see discovery-draft.ts);
//   * every row is saved server-side as its search finishes, and the harvest
//     records which search it is on, so an interrupted run is offered back as
//     "Resume" with its rows intact and no quota spent twice.
//
// The beforeunload warning stays, because leaving is still worth a prompt — it
// is now a nuisance rather than a loss.
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
  RotateCcw,
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
import {
  estimateCalls,
  toCsv,
  type DiscoveryRow,
  type SkipReason,
} from "@/lib/revenue/discovery-query";
import {
  canAutoResume,
  clearDraft,
  clearProgress,
  readDraft,
  readProgress,
  writeDraft,
  writeProgress,
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
  /** Rows still held server-side, so this harvest's CSV can be saved again. */
  leads_stored: number;
  status: string;
  started_at: string;
}

interface LogEntry {
  place: string;
  found: number;
  kept: number;
  error: string | null;
}

/** An unfinished harvest this browser remembers, confirmed by the server. */
interface Interrupted {
  runId: string;
  plan: PlanEntry[];
  nextIndex: number;
  rowsStored: number;
  ignoreSeen: boolean;
  startedAt: string;
  industryLabel: string;
  state: string;
  /** The browser killed this one recently — carry it on without being asked. */
  autoResume: boolean;
}

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
   * over the draft it is about to restore — the bug would be invisible and would
   * eat exactly the work this feature exists to protect.
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
  const [interrupted, setInterrupted] = useState<Interrupted | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** True when the page picked a harvest back up without being asked. */
  const [resumedAutomatically, setResumedAutomatically] = useState(false);

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

  /**
   * Guards against carrying a harvest on twice.
   *
   * React runs effects twice in development, and the probe that decides to
   * resume is one of them. Without this, a single interruption would start two
   * loops against the same run and spend the quota twice over.
   */
  const autoResumed = useRef(false);

  const industryOptions = useMemo(
    () => DISCOVERY_INDUSTRIES.map((i) => ({ value: i.value, label: i.label })),
    [],
  );
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

  // ── an interrupted harvest is offered back ──

  /**
   * Asks the server about the half-finished harvest this browser remembers.
   *
   * The stored note is only a run id and a position; the server owns the truth,
   * so it rebuilds the plan, works out which searches are still owed, and says
   * how many rows are waiting. A note for a run that has been deleted, or that
   * turns out to be finished, is thrown away rather than shown.
   */
  useEffect(() => {
    const progress = readProgress();
    if (!progress) return;

    let live = true;
    void (async () => {
      const res = await fetch("/api/admin/revenue/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume", runId: progress.runId }),
      });

      if (!res.ok) {
        clearProgress();
        return;
      }

      const payload = await res.json().catch(() => null);
      if (!live || !payload) return;

      const plan: PlanEntry[] = payload.plan ?? [];

      // A position only means something against the plan it was recorded in. If
      // a deploy changed the industrial-area lists the plan is a different
      // length and the saved index points at the wrong search, so start from the
      // top and let the per-search "done" flags skip what is already paid for —
      // which costs nothing and cannot mis-attribute a row to the wrong city.
      const from = plan.length === progress.planLength ? Math.min(progress.nextIndex, plan.length) : 0;

      const outstanding = plan.filter((entry, i) => i >= from && !entry.done).length;
      if (outstanding === 0) {
        clearProgress();
        return;
      }

      setInterrupted({
        runId: payload.runId,
        plan,
        nextIndex: from,
        rowsStored: payload.rowsStored ?? 0,
        ignoreSeen: payload.ignoreSeen === true,
        startedAt: payload.startedAt,
        industryLabel: payload.industryLabel ?? "",
        state: payload.state ?? "",
        // Decided here, where the stored note is in hand; acted on below, once
        // the function that does the resuming has been declared.
        autoResume: canAutoResume({ ...progress, nextIndex: from }),
      });
    })();

    return () => {
      live = false;
    };
  }, []);

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
   * The harvest loop: one Google search per request, rows accumulated here.
   *
   * Shared by Start and Resume so there is exactly one copy of the rules about
   * skipping, stopping and recording where it got to. `from` is the first search
   * still owed — zero for a fresh run.
   */
  async function runPlan(runId: string, plan: PlanEntry[], from: number, runIgnoreSeen: boolean) {
    cancelled.current = false;
    setPlanLength(plan.length);
    setRunning(true);

    // Written before the first search, not after it: the point of the note is to
    // survive the tab dying, and the tab can die on the very first request.
    const remember = (nextIndex: number, stoppedByUser = false) =>
      writeProgress({
        runId,
        nextIndex,
        planLength: plan.length,
        savedAt: new Date().toISOString(),
        stoppedByUser,
      });
    remember(from);

    // Stops the machine sleeping mid-harvest. It does not stop Chrome
    // discarding the tab — nothing in the browser can — but a laptop that
    // suspends during a two-hundred-search sweep is one real way these die, and
    // this costs nothing to prevent. Unsupported everywhere but Chromium, hence
    // the guard.
    const wakeLock = await requestWakeLock();

    let reachedEnd = true;

    for (const entry of plan.slice(from)) {
      if (cancelled.current) {
        // Keeps the note, flagged as deliberate: the rest is still offered on
        // the next visit, but the page will not start it again on its own.
        remember(entry.index, true);
        reachedEnd = false;
        break;
      }

      if (entry.done) {
        // Paid for in an earlier run and still inside the reuse window. Skipping
        // costs nothing and is what lets a two-day sweep resume where it stopped.
        setReused((r) => r + 1);
        setDone((d) => d + 1);
        remember(entry.index + 1);
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
          ignoreSeen: runIgnoreSeen,
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
        remember(entry.index + 1);
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

      remember(entry.index + 1);

      if (payload.stop) {
        // The daily cap, or Google's own quota. Keeping the note is the whole
        // point: a Karnataka sweep spans two days, and tomorrow this page offers
        // the rest back rather than asking him to rebuild the selection.
        setStopMessage(payload.stop);
        reachedEnd = false;
        break;
      }
    }

    await fetch("/api/admin/revenue/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finish", runId, abandoned: cancelled.current }),
    });

    // Only a harvest that ran out of plan has nothing left to resume.
    if (reachedEnd) clearProgress();

    await releaseWakeLock(wakeLock);
    setRunning(false);
    setResumedAutomatically(false);
    void loadUsage();
  }

  /**
   * Starts a fresh harvest.
   *
   * `force` is the "search Google again anyway" path: it overrides the
   * Ignore-my-previous-harvests tick for this one run, so a combination the
   * founder has already pulled is fetched again, companies and all, instead of
   * leaving him at a dead end.
   */
  async function startHarvest(force = false) {
    setError(null);
    setStopMessage(null);
    setRows([]);
    setLog([]);
    setDone(0);
    setDuplicates(0);
    setReused(0);
    setDownloaded(false);
    setSkipped({ retail: 0, closed: 0, no_phone: 0, no_id: 0 });
    setInterrupted(null);
    clearProgress();

    const useIgnoreSeen = ignoreSeen || force;

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
        ignoreSeen: useIgnoreSeen,
      }),
    });

    const startPayload = await startRes.json().catch(() => ({}));
    if (!startRes.ok) {
      setError(startPayload.error ?? "Could not start the harvest");
      return;
    }

    await runPlan(startPayload.runId, startPayload.plan ?? [], 0, useIgnoreSeen);
  }

  /**
   * Picks up the harvest this browser was in the middle of.
   *
   * The rows already paid for are fetched back first, so the CSV at the end is
   * the whole harvest and not just the part that ran after the interruption.
   */
  async function beginResume(run: Interrupted, automatic = false) {
    setBusy("resume");

    const res = await fetch("/api/admin/revenue/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rows", runId: run.runId }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(payload.error ?? "Could not read back what that harvest already found");
      return;
    }

    const recovered: DiscoveryRow[] = payload.rows ?? [];
    setResumedAutomatically(automatic);
    setError(null);
    setStopMessage(null);
    setRows(recovered);
    setLog([]);
    setDuplicates(0);
    setReused(0);
    setDownloaded(false);
    setSkipped({ retail: 0, closed: 0, no_phone: 0, no_id: 0 });
    setDone(run.nextIndex);

    setInterrupted(null);
    await runPlan(run.runId, run.plan, run.nextIndex, run.ignoreSeen);
  }

  /**
   * Carries an interrupted harvest on by itself.
   *
   * Offering a button was not enough. The banner sits above the form, the form
   * is where the eye already is, and the Start button next to it is the
   * familiar one — so an interrupted harvest got restarted by hand instead of
   * resumed. Carrying on costs nothing for the searches already done, so there
   * was never a decision here worth interrupting him for.
   *
   * Only ever for a harvest the browser killed within the last few hours:
   * `canAutoResume` refuses one that was stopped on purpose, and one old enough
   * that this page is probably open for something else.
   */
  useEffect(() => {
    if (!interrupted?.autoResume || autoResumed.current || running) return;
    autoResumed.current = true;
    void beginResume(interrupted, true);
    // beginResume is left out of the dependencies on purpose: it is rebuilt on
    // every render, and the ref above already makes this fire exactly once.
    // Listing it would restart the harvest mid-flight. Deliberately not
    // silenced with an eslint-disable — that directive makes the React compiler
    // stop analysing this whole component, which hides real findings elsewhere
    // in the file.
  }, [interrupted, running]);


  function downloadCsv() {
    saveCsv(rows, source, `${industry || "leads"}-${state || "india"}`);
    setDownloaded(true);
  }

  /**
   * Hands back a past harvest's CSV without touching Google.
   *
   * This is the other half of why the rows are now stored: a CSV saved to the
   * wrong folder, or opened and closed without saving, used to mean paying the
   * quota again.
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

  const totalSkipped = skipped.retail + skipped.closed + skipped.no_phone + skipped.no_id;

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

      {/* ── An unfinished harvest, offered back ── */}
      {interrupted && !running && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm space-y-3">
          <div className="flex gap-2">
            <RotateCcw className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <span>
              <b>A harvest was left unfinished.</b> {interrupted.industryLabel}
              {interrupted.state && ` · ${interrupted.state}`} — {interrupted.nextIndex} of{" "}
              {interrupted.plan.length} searches done
              {interrupted.startedAt && `, started ${whenShort(interrupted.startedAt)}`}.
              <span className="block text-xs text-muted-foreground mt-1">
                {interrupted.rowsStored > 0
                  ? `${interrupted.rowsStored.toLocaleString("en-IN")} companies are already saved. Carrying on costs nothing for the searches already done.`
                  : "Carrying on costs nothing for the searches already done."}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void beginResume(interrupted)}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {busy === "resume" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Carry on from search {interrupted.nextIndex + 1}
            </button>
            {interrupted.rowsStored > 0 && (
              <button
                onClick={() => void downloadRun(interrupted.runId)}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/10 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                Download the {interrupted.rowsStored.toLocaleString("en-IN")} found so far
              </button>
            )}
            <button
              onClick={() => {
                clearProgress();
                setInterrupted(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
              Forget it
            </button>
          </div>
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
        <div className="flex items-center justify-between">
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
                    ? `That is more than today's ${usage.dailyRemaining} remaining calls. It will run until the cap, then stop — finish the rest tomorrow.`
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
            An already-harvested selection is no longer a dead end. It used to
            disable Start, which left the only two useful answers — "give me
            last time's rows" and "look again anyway" — unreachable.
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
              disabled={running || plannedQueries === 0 || !hasApiKey}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? `Searching… ${done} of ${planLength}` : "Start crawling Google Maps"}
            </button>
          )}

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
            {resumedAutomatically
              ? "Carried on by itself — this harvest was interrupted, and the searches already done were skipped free of charge."
              : "Every company found is saved as it arrives. If this tab dies, open the page again and it picks up where it left off."}
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
            fetched and no quota was spent. Use <b>Download last time&apos;s leads</b> above to take
            those companies again, tick <b>Ignore my previous harvests</b> to fetch them fresh, or
            pick different districts.
          </span>
        </div>
      )}

      {rows.length > 0 && !running && !downloaded && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>
            {rows.length.toLocaleString("en-IN")} companies found. They are saved for 90 days, so
            you can take the CSV again from Past harvests below if you lose it — but download it now
            while it is in front of you.
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

/**
 * Asks the browser to keep the machine awake, if it can.
 *
 * Chromium only, and it throws outright when the page is not visible — both of
 * which are fine: a harvest without a wake lock is exactly as correct, just
 * more exposed to a laptop deciding to sleep.
 */
async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    return (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}

async function releaseWakeLock(lock: WakeLockSentinel | null): Promise<void> {
  try {
    await lock?.release();
  } catch {
    /* already gone — the browser released it when the tab lost visibility */
  }
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
