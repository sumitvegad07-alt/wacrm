// ============================================================
// Lead Discovery — the harvest engine, server side.
//
// This used to be a loop in the browser. One search per HTTP request, rows kept
// in React state, and a page that said "keep this tab open". The reasoning was
// sound — ~163 searches do not fit in one serverless invocation — but the
// conclusion was wrong: nobody watches a progress bar for ten minutes. The
// founder starts a harvest and goes to do other work, which is precisely when
// Chrome discards the tab.
//
// So the run row is the job now. `next_index` is where it has got to,
// `heartbeat_at` is proof a worker is still on it, and any invocation can pick
// up any run that has gone quiet. A worker harvests until it runs out of time,
// then hands on to a fresh one. If a hand-off is lost, the next worker to look
// carries it on — opening the page is enough — and nothing is lost either way,
// because every row was written to re_discovery_leads as it arrived.
//
// WHAT KEEPS THIS SAFE
//
// `re_discovery_claim_run`. Two workers must never harvest one run: the loser
// would re-run searches the winner is already paying Google for. The claim is a
// single statement with `for update skip locked`, so the race is a non-event
// rather than something to detect afterwards.
// ============================================================

import { serviceClient } from "@/lib/auth/superadmin";
import { localRangeToUtc, resolvePeriod } from "@/lib/mcp/periods";
import { listAreas } from "./discovery-geography";
import {
  DAILY_CALL_CAP,
  MAX_PAGES,
  MONTHLY_FREE_CALLS,
  buildQueries,
  dedupeRows,
  mapPlace,
  type AreaSelection,
  type DiscoveryRow,
  type SkipReason,
} from "./discovery-query";
import { placesApiKey, searchText } from "./places-client";

/**
 * The service-role client's type, taken from the factory rather than imported
 * from @supabase/supabase-js, which the lint config bars outside lib/supabase.
 */
export type Admin = ReturnType<typeof serviceClient>;

/**
 * The daily cap is a self-imposed brake, so its day boundary only has to be
 * predictable to the founder — India time. (Google's own quota resets on
 * Pacific time; that one is enforced in the Cloud console, independently.)
 */
const CAP_TIMEZONE = "Asia/Kolkata";

/**
 * How long a completed search counts as "already done".
 *
 * A full Karnataka sweep is ~163 searches and ~294 calls, more than one day's
 * cap allows, so a sweep normally spans two days. Without this, carrying on
 * tomorrow would re-run and re-pay for every search finished today. Google Maps
 * listings do not change meaningfully inside a month, so a search run in the
 * last 45 days is treated as done and skipped for free.
 *
 * The "Ignore my previous harvests" tick overrides it.
 */
export const SEARCH_REUSE_DAYS = 45;

/**
 * How long the harvested rows themselves are kept, so a CSV can be downloaded
 * again. Place IDs are kept forever (deduplication); names, phones and
 * addresses are not.
 */
export const LEADS_RETENTION_DAYS = 90;

/**
 * How long a worker may harvest before handing on.
 *
 * Under the 300s the route declares, with room for the hand-off and the
 * closing tidy-up.
 */
export const WORKER_BUDGET_MS = 240_000;

/**
 * Reserved for the search in flight when the budget is checked.
 *
 * One search is three pages, each with a 20s timeout, so the worst case really
 * is a minute. Starting one with less than this left is how an invocation gets
 * killed mid-search — which costs the call and banks nothing.
 */
const SEARCH_WORST_CASE_MS = 65_000;

/**
 * A run whose worker has been silent this long is treated as abandoned.
 *
 * Mirrors the default on `re_discovery_claim_run`, which is what actually
 * enforces it. This copy is used only to decide whether the page should prod a
 * run that has gone quiet; if the two ever drift, the database wins and the
 * worst case is a nudge that the claim politely refuses.
 */
export const HEARTBEAT_STALE_SECONDS = 90;

// ── quota ───────────────────────────────────────────────────

export interface Usage {
  callsToday: number;
  callsThisMonth: number;
  dailyCap: number;
  monthlyFree: number;
  dailyRemaining: number;
  monthlyRemaining: number;
}

export async function readUsage(admin: Admin): Promise<Usage> {
  const today = localRangeToUtc(resolvePeriod("today", CAP_TIMEZONE));
  const month = localRangeToUtc(resolvePeriod("this_month", CAP_TIMEZONE));

  const [todayRows, monthRows] = await Promise.all([
    admin
      .from("re_discovery_queries")
      .select("calls_used")
      .gte("created_at", today.from)
      .lt("created_at", today.to),
    admin
      .from("re_discovery_queries")
      .select("calls_used")
      .gte("created_at", month.from)
      .lt("created_at", month.to),
  ]);

  const sum = (rows: { calls_used: number }[] | null) =>
    (rows ?? []).reduce((total, row) => total + (row.calls_used ?? 0), 0);

  const callsToday = sum(todayRows.data);
  const callsThisMonth = sum(monthRows.data);

  return {
    callsToday,
    callsThisMonth,
    dailyCap: DAILY_CALL_CAP,
    monthlyFree: MONTHLY_FREE_CALLS,
    dailyRemaining: Math.max(0, DAILY_CALL_CAP - callsToday),
    monthlyRemaining: Math.max(0, MONTHLY_FREE_CALLS - callsThisMonth),
  };
}

// ── the plan ────────────────────────────────────────────────

export interface PlanInput {
  industry: string;
  category: string;
  state: string;
  districts: string[];
  areas: string[];
  pincode: string | null;
}

/**
 * Rebuilds the search plan from what the run row stores. Deterministic, so a
 * worker that has never seen the browser's version of it produces exactly the
 * same searches in exactly the same order — which is what makes an index a
 * meaningful place to resume from.
 */
export function planFor(input: PlanInput) {
  const areaOptions = listAreas(input.state, input.districts);
  const districtOf = new Map(areaOptions.map((option) => [option.value, option.district]));

  const areas: AreaSelection[] = input.areas
    .map((area) => ({ area, district: districtOf.get(area) ?? "" }))
    // An area whose district is no longer in the selection cannot be attributed,
    // and a row labelled with the wrong city is worse than a row not harvested.
    .filter((selection) => selection.district !== "");

  return buildQueries({
    industry: input.industry,
    category: input.category,
    state: input.state,
    districts: input.districts,
    areas,
    pincode: input.pincode,
  });
}

/**
 * Which of these exact searches already ran successfully inside the reuse
 * window. Only successful calls count — a search that errored cost a call but
 * returned nothing, so it is worth retrying.
 */
export async function readRecentSearches(admin: Admin, texts: string[]): Promise<Set<string>> {
  if (texts.length === 0) return new Set();

  const since = new Date(Date.now() - SEARCH_REUSE_DAYS * 86_400_000).toISOString();
  const { data } = await admin
    .from("re_discovery_queries")
    .select("query_text")
    .in("query_text", texts)
    .gte("created_at", since)
    .is("error", null)
    .gt("calls_used", 0);

  return new Set((data ?? []).map((row: { query_text: string }) => row.query_text));
}

/** Which of these place IDs an earlier harvest already produced. */
async function readSeen(admin: Admin, placeIds: string[]): Promise<Set<string>> {
  if (placeIds.length === 0) return new Set();
  const { data } = await admin
    .from("re_discovery_seen_places")
    .select("place_id")
    .in("place_id", placeIds);
  return new Set((data ?? []).map((row: { place_id: string }) => row.place_id));
}

// ── stored rows ─────────────────────────────────────────────

/** Every lead column, in one place so a select and an insert cannot drift. */
const LEAD_COLUMNS =
  "place_id, name, phone, website, address, area, city, district, state, pincode, searched_in, outside_searched_area, latitude, longitude, rating, reviews, primary_type, industry";

/**
 * Supabase caps a select at 1,000 rows. A Karnataka sweep is several thousand,
 * so stored rows are read in pages — a silent truncation here would hand back a
 * short CSV that looks complete.
 */
const PAGE = 1000;

/** A ceiling on one download, so a runaway selection cannot exhaust memory. */
const MAX_ROWS = 50_000;

interface LeadRecord {
  place_id: string;
  name: string;
  phone: string;
  website: string;
  address: string;
  area: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  searched_in: string;
  outside_searched_area: boolean;
  latitude: string;
  longitude: string;
  rating: string;
  reviews: string;
  primary_type: string;
  industry: string;
}

function toLeadInsert(row: DiscoveryRow, runId: string, queryText: string) {
  return {
    run_id: runId,
    query_text: queryText,
    place_id: row.placeId,
    name: row.name,
    phone: row.phone,
    website: row.website,
    address: row.address,
    area: row.area,
    city: row.city,
    district: row.district,
    state: row.state,
    pincode: row.pincode,
    searched_in: row.searchedIn,
    outside_searched_area: row.outsideSearchedArea,
    latitude: row.latitude,
    longitude: row.longitude,
    rating: row.rating,
    reviews: row.reviews,
    primary_type: row.primaryType,
    industry: row.industry,
  };
}

function fromLeadRow(record: LeadRecord): DiscoveryRow {
  return {
    placeId: record.place_id,
    name: record.name,
    phone: record.phone,
    website: record.website,
    address: record.address,
    area: record.area,
    city: record.city,
    district: record.district,
    state: record.state,
    pincode: record.pincode,
    searchedIn: record.searched_in,
    outsideSearchedArea: record.outside_searched_area,
    latitude: record.latitude,
    longitude: record.longitude,
    rating: record.rating,
    reviews: record.reviews,
    primaryType: record.primary_type,
    industry: record.industry,
  };
}

/**
 * Stored rows for one harvest, or for whichever harvests ran these exact
 * searches. Deduplicated by Place ID, newest kept: the same company can sit in
 * two runs of the same district, and a CSV must not list it twice.
 */
export async function readStoredRows(
  admin: Admin,
  scope: { runId: string } | { queryTexts: string[] },
): Promise<DiscoveryRow[]> {
  if ("queryTexts" in scope && scope.queryTexts.length === 0) return [];

  const byPlace = new Map<string, DiscoveryRow>();

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let query = admin
      .from("re_discovery_leads")
      .select(LEAD_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);

    query =
      "runId" in scope ? query.eq("run_id", scope.runId) : query.in("query_text", scope.queryTexts);

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;

    for (const record of data as unknown as LeadRecord[]) {
      if (!byPlace.has(record.place_id)) byPlace.set(record.place_id, fromLeadRow(record));
    }

    if (data.length < PAGE) break;
  }

  return [...byPlace.values()];
}

/** The CSV's Source column, built the same way wherever it is needed. */
export function sourceLabel(state: string): string {
  return `Google Maps — ${state}`;
}

/**
 * Deletes harvested rows past the retention window, and zeroes the counter that
 * advertised them.
 *
 * Runs on page load rather than from cron: this table is written by exactly one
 * tool, which cannot be used without loading that page, so a separate scheduled
 * job would only be a second thing to notice had stopped working.
 */
export async function purgeOldLeads(admin: Admin) {
  const cutoff = new Date(Date.now() - LEADS_RETENTION_DAYS * 86_400_000).toISOString();

  const { error } = await admin.from("re_discovery_leads").delete().lt("created_at", cutoff);
  // Never fail the page over housekeeping — the quota figures matter more than
  // the purge, which will simply be retried on the next load.
  if (error) {
    console.error("[discover] lead purge failed", error.message);
    return;
  }

  await admin
    .from("re_discovery_runs")
    .update({ leads_stored: 0 })
    .lt("started_at", cutoff)
    .gt("leads_stored", 0);
}

// ── the engine ──────────────────────────────────────────────

interface RunRecord {
  id: string;
  industry: string;
  industry_label: string;
  category: string;
  state: string;
  districts: string[] | null;
  areas: string[] | null;
  pincode: string | null;
  ignore_seen: boolean;
  include_without_phone: boolean;
  next_index: number;
  cancel_requested: boolean;
}

export interface HarvestOutcome {
  /** False when another worker already holds this run. Then: do nothing. */
  claimed: boolean;
  /** Searches this invocation got through, free skips included. */
  advanced: number;
  /** The status the run was left in. */
  status: "running" | "queued" | "finished" | "stopped" | "failed" | "busy";
  /** True when a further invocation is needed to carry it on. */
  handOff: boolean;
}

const NOT_CLAIMED: HarvestOutcome = { claimed: false, advanced: 0, status: "busy", handOff: true };

/**
 * Harvests one run until it finishes, is stopped, hits a cap, or runs out of
 * time.
 *
 * Returns `handOff: true` when it stopped for time, which is the caller's cue
 * to start another invocation. Every exit leaves the run claimable again, so a
 * caller that fails to hand on costs a delay, never a loss.
 */
export async function harvestRun(
  admin: Admin,
  runId: string,
  options: { budgetMs?: number } = {},
): Promise<HarvestOutcome> {
  // The staleness window is left to the function's own default rather than
  // passed as an interval. PostgREST would have to cast a JSON string into an
  // interval to send one, and a cast that fails here does not fail loudly — it
  // fails as a harvest that never starts.
  const { data: claimed } = await admin.rpc("re_discovery_claim_run", { p_run_id: runId });
  if (claimed !== true) return NOT_CLAIMED;

  const deadline = Date.now() + (options.budgetMs ?? WORKER_BUDGET_MS);

  try {
    return await harvest(admin, runId, deadline);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[discover] harvest failed", runId, message);
    // Left queued, not failed: the fault is far more likely to be this
    // invocation (a timeout, a cold database) than the harvest, and a run
    // marked failed would need a human to notice before it could continue.
    await release(admin, runId, { status: "queued", last_error: message });
    return { claimed: true, advanced: 0, status: "queued", handOff: true };
  }
}

async function harvest(admin: Admin, runId: string, deadline: number): Promise<HarvestOutcome> {
  const { data: run } = await admin
    .from("re_discovery_runs")
    .select(
      "id, industry, industry_label, category, state, districts, areas, pincode, ignore_seen, include_without_phone, next_index, cancel_requested",
    )
    .eq("id", runId)
    .single<RunRecord>();

  if (!run) return { claimed: true, advanced: 0, status: "failed", handOff: false };

  const apiKey = placesApiKey();
  if (!apiKey) {
    await release(admin, runId, {
      status: "failed",
      last_error: "GOOGLE_PLACES_API_KEY is not set on the server.",
    });
    return { claimed: true, advanced: 0, status: "failed", handOff: false };
  }

  const plan = planFor({
    industry: run.industry,
    category: run.category,
    state: run.state,
    districts: run.districts ?? [],
    areas: run.areas ?? [],
    pincode: run.pincode,
  });

  if (plan.length === 0) {
    await release(admin, runId, {
      status: "failed",
      last_error: "Those choices no longer build a plan.",
    });
    return { claimed: true, advanced: 0, status: "failed", handOff: false };
  }

  // Searches this run already finished, plus — unless he asked for a fresh pull
  // — anything harvested recently by any run. Both are skipped without a call.
  const done = await readOwnFinished(admin, runId);
  if (!run.ignore_seen) {
    for (const text of await readRecentSearches(admin, plan.map((spec) => spec.text))) {
      done.add(text);
    }
  }

  let index = Math.max(0, Math.min(run.next_index, plan.length));
  let advanced = 0;

  while (index < plan.length) {
    if (await cancelRequested(admin, runId)) {
      await release(admin, runId, { status: "stopped", next_index: index });
      return { claimed: true, advanced, status: "stopped", handOff: false };
    }

    const spec = plan[index];

    if (done.has(spec.text)) {
      // Paid for already and still inside the reuse window. Free, and what lets
      // a two-day sweep carry on where it stopped.
      index++;
      advanced++;
      continue;
    }

    const usage = await readUsage(admin);
    const stop = capReached(usage);
    if (stop) {
      // Queued rather than stopped: the cap is a pause, not an ending. The next
      // worker to look — tomorrow's first page load — carries it on.
      await release(admin, runId, { status: "queued", next_index: index, stop_reason: stop });
      await recountTotals(admin, runId);
      return { claimed: true, advanced, status: "queued", handOff: false };
    }

    // Out of time. Hand the rest to a fresh invocation rather than start a
    // search this one cannot finish — a search killed halfway costs the call
    // and banks nothing.
    if (Date.now() + SEARCH_WORST_CASE_MS > deadline) break;

    await runOneSearch(admin, { runId, apiKey, spec, run, usage });

    index++;
    advanced++;
    await admin
      .from("re_discovery_runs")
      .update({ next_index: index, heartbeat_at: new Date().toISOString() })
      .eq("id", runId);
  }

  await recountTotals(admin, runId);

  if (index >= plan.length) {
    await release(admin, runId, {
      status: "finished",
      next_index: index,
      finished_at: new Date().toISOString(),
      stop_reason: null,
    });
    return { claimed: true, advanced, status: "finished", handOff: false };
  }

  await release(admin, runId, { status: "queued", next_index: index });
  return { claimed: true, advanced, status: "queued", handOff: true };
}

/** One search, mapped, deduplicated, and written down before anything else. */
async function runOneSearch(
  admin: Admin,
  input: {
    runId: string;
    apiKey: string;
    spec: { text: string; district: string; area: string | null };
    run: RunRecord;
    usage: Usage;
  },
) {
  const { runId, apiKey, spec, run, usage } = input;

  // Never overshoot the cap: shorten the last search of the day rather than
  // spending three pages when one is left.
  const maxPages = Math.max(1, Math.min(MAX_PAGES, usage.dailyRemaining, usage.monthlyRemaining));
  const search = await searchText(apiKey, spec.text, maxPages);

  const skipped: Record<SkipReason, number> = { retail: 0, closed: 0, no_phone: 0, no_id: 0 };
  const mapped: DiscoveryRow[] = [];

  for (const place of search.results) {
    const result = mapPlace(
      place,
      {
        industryLabel: run.industry_label,
        state: run.state,
        district: spec.district,
        area: spec.area,
      },
      { includeWithoutPhone: run.include_without_phone },
    );
    if (result.row) mapped.push(result.row);
    else if (result.skip) skipped[result.skip]++;
  }

  // Deduplicate inside this page set first, then against every past harvest.
  const withinBatch = dedupeRows(mapped);
  const seen = run.ignore_seen
    ? new Set<string>()
    : await readSeen(admin, withinBatch.rows.map((row) => row.placeId));
  const final = dedupeRows(withinBatch.rows, seen);

  if (final.rows.length > 0) {
    await admin.from("re_discovery_seen_places").upsert(
      final.rows.map((row) => ({ place_id: row.placeId, run_id: runId })),
      { onConflict: "place_id", ignoreDuplicates: true },
    );

    const stored = await admin
      .from("re_discovery_leads")
      .upsert(
        final.rows.map((row) => toLeadInsert(row, runId, spec.text)),
        { onConflict: "run_id,place_id", ignoreDuplicates: true },
      )
      .select("id");

    if (stored.error) {
      console.error("[discover] could not store harvested rows", stored.error.message);
    } else if ((stored.data?.length ?? 0) > 0) {
      await admin.rpc("re_discovery_add_leads", { p_run_id: runId, p_count: stored.data.length });
    }
  }

  // The query log is the quota counter, so it is written whatever happened —
  // including for a search that errored, which still cost its call.
  await admin.from("re_discovery_queries").insert({
    run_id: runId,
    query_text: spec.text,
    district: spec.district,
    area: spec.area,
    pages_fetched: search.pagesFetched,
    calls_used: search.pagesFetched,
    results_count: search.results.length,
    new_count: final.rows.length,
    error: search.error,
  });

  if (search.quotaExhausted) {
    await admin
      .from("re_discovery_runs")
      .update({
        stop_reason:
          "Google says the quota is exhausted. That is the Cloud-console cap doing its job — nothing has been billed.",
      })
      .eq("id", runId);
  }
}

/** The founder's wording for why a harvest has to pause, or null to carry on. */
function capReached(usage: Usage): string | null {
  if (usage.dailyRemaining <= 0) {
    return `Daily cap of ${DAILY_CALL_CAP} calls reached. This is the brake that keeps the tool free — it will carry on by itself tomorrow.`;
  }
  if (usage.monthlyRemaining <= 0) {
    return `This month's ${MONTHLY_FREE_CALLS.toLocaleString("en-IN")} free calls are used up. Anything more would be billed, so the harvest paused — it carries on from the 1st.`;
  }
  return null;
}

/** Searches this run has already completed, successfully. */
async function readOwnFinished(admin: Admin, runId: string): Promise<Set<string>> {
  const { data } = await admin
    .from("re_discovery_queries")
    .select("query_text")
    .eq("run_id", runId)
    .is("error", null)
    .gt("calls_used", 0);

  return new Set((data ?? []).map((row: { query_text: string }) => row.query_text));
}

async function cancelRequested(admin: Admin, runId: string): Promise<boolean> {
  const { data } = await admin
    .from("re_discovery_runs")
    .select("cancel_requested")
    .eq("id", runId)
    .single<{ cancel_requested: boolean }>();

  return data?.cancel_requested === true;
}

/**
 * Lets go of the run.
 *
 * `heartbeat_at` is cleared on every exit on purpose: it is the lock, and a
 * worker that finished its turn must not keep a run locked for the ninety
 * seconds it would otherwise take to go stale. Clearing it means the hand-off
 * can be claimed immediately.
 */
async function release(
  admin: Admin,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("re_discovery_runs")
    .update({ heartbeat_at: null, ...patch })
    .eq("id", runId);
}

/**
 * Totals summed from the query log rather than counted up as the harvest goes,
 * so a worker that died mid-run still leaves honest numbers behind.
 */
async function recountTotals(admin: Admin, runId: string): Promise<void> {
  const { data } = await admin
    .from("re_discovery_queries")
    .select("calls_used, results_count, new_count")
    .eq("run_id", runId);

  const totals = (data ?? []).reduce(
    (acc, row: { calls_used: number; results_count: number; new_count: number }) => ({
      queries_done: acc.queries_done + 1,
      calls_used: acc.calls_used + (row.calls_used ?? 0),
      rows_found: acc.rows_found + (row.results_count ?? 0),
      rows_new: acc.rows_new + (row.new_count ?? 0),
    }),
    { queries_done: 0, calls_used: 0, rows_found: 0, rows_new: 0 },
  );

  await admin.from("re_discovery_runs").update(totals).eq("id", runId);
}
