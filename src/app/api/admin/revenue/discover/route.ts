// ============================================================
// Lead Discovery API — founder-only, like every route under /api/admin.
//
// WHY THE BROWSER DRIVES THE LOOP
//
// One harvest is ~130 Google searches, several minutes of wall clock. That does
// not fit in a serverless function's lifetime, so the page asks for ONE search
// per request and keeps the rows in browser memory. Each request here is a
// second or two, nothing runs in the background, and there is no job queue to
// get stuck. The cost is that the tab has to stay open, which the UI says.
//
// WHAT NEVER LEAVES THIS FILE
//
// The Google API key. It is read from the server environment and used here; the
// browser only ever sees the rows that come back.
//
// WHAT IS WRITTEN TO THE DATABASE
//
// Call counts, Google Place IDs for deduplication, and — since
// 20261010100000 — the harvested rows themselves for 90 DAYS, so a CSV can be
// downloaded again without paying the quota twice. The rows are then deleted
// and only the Place IDs remain. See that migration's header for the trade.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { localRangeToUtc, resolvePeriod } from "@/lib/mcp/periods";
import { listAreas } from "@/lib/revenue/discovery-geography";
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
} from "@/lib/revenue/discovery-query";
import { findCategory, findIndustry } from "@/lib/revenue/discovery-taxonomy";
import { placesApiKey, searchText } from "@/lib/revenue/places-client";

/**
 * The daily cap is a self-imposed brake, so its day boundary only has to be
 * predictable to the founder — India time. (Google's own quota resets on Pacific
 * time; that one is enforced in the Cloud console, independently.)
 */
const CAP_TIMEZONE = "Asia/Kolkata";

/**
 * How long a completed search counts as "already done".
 *
 * A full Karnataka sweep is ~163 searches and ~294 calls, which is more than one
 * day's cap allows — so a sweep normally spans two days. Without this, starting
 * again tomorrow would re-run and re-pay for every search finished today. Google
 * Maps listings do not change meaningfully inside a month, so a search run in the
 * last 45 days is treated as done and skipped for free.
 *
 * The "Ignore my previous harvests" tick overrides it.
 */
const SEARCH_REUSE_DAYS = 45;

/**
 * How long the harvested rows themselves are kept, so a CSV can be downloaded
 * again. Place IDs are kept forever (deduplication); names, phones and
 * addresses are not. Ninety days is the figure the founder chose and the
 * migration header explains why it is bounded at all.
 */
const LEADS_RETENTION_DAYS = 90;

/**
 * The service-role client's type, taken from the factory rather than imported
 * from @supabase/supabase-js: everything under src/app is barred from importing
 * that package directly (see eslint.config.mjs), and this needs no exception.
 */
type Admin = ReturnType<typeof serviceClient>;

export const dynamic = "force-dynamic";

interface Usage {
  callsToday: number;
  callsThisMonth: number;
  dailyCap: number;
  monthlyFree: number;
  dailyRemaining: number;
  monthlyRemaining: number;
}

async function readUsage(admin: Admin): Promise<Usage> {
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

export async function GET() {
  try {
    await requireFounder();
    const admin = serviceClient();

    await purgeOldLeads(admin);

    const [usage, runs] = await Promise.all([
      readUsage(admin),
      admin
        .from("re_discovery_runs")
        .select(
          "id, industry_label, category, state, districts, areas, queries_planned, queries_done, calls_used, rows_found, rows_new, leads_stored, status, started_at",
        )
        .order("started_at", { ascending: false })
        .limit(15),
    ]);

    return NextResponse.json({
      usage,
      hasApiKey: Boolean(placesApiKey()),
      // Founder-only diagnostic, NAMES only and never values. Setting this key
      // cost two deploys of guessing at whether Vercel was passing it through
      // and under what name; the server can answer that in one reload.
      envNames: Object.keys(process.env)
        .filter((name) => /GOOGLE|PLACES|MAPS/i.test(name))
        .sort(),
      runs: runs.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const admin = serviceClient();

    switch (body.action) {
      case "preview":
        return await previewPlan(admin, body);
      case "start":
        return await startRun(admin, ctx.userId, body);
      case "resume":
        return await resumeRun(admin, ctx.userId, body);
      case "search":
        return await runSearch(admin, ctx.userId, body);
      case "finish":
        return await finishRun(admin, ctx.userId, body);
      case "rows":
        return await rowsForRun(admin, ctx.userId, body);
      case "priorRows":
        return await rowsForSelection(admin, body);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ── preview ─────────────────────────────────────────────────

/**
 * Answers "have I already done this?" before a single call is spent.
 *
 * The harvest already skips a search it ran recently, but the founder only
 * learned that after pressing Start and watching nothing happen. Asking the same
 * question up front turns a silent no-op into an answer he can act on: change
 * the industry, the category, or the area.
 */
async function previewPlan(admin: Admin, body: Record<string, unknown>) {
  const plan = planFromBody(body);
  if (plan.length === 0) {
    return NextResponse.json({ total: 0, alreadyDone: 0, lastRunAt: null });
  }

  const texts = plan.map((spec) => spec.text);
  const since = new Date(Date.now() - SEARCH_REUSE_DAYS * 86_400_000).toISOString();

  const [{ data }, stored] = await Promise.all([
    admin
      .from("re_discovery_queries")
      .select("query_text, created_at")
      .in("query_text", texts)
      .gte("created_at", since)
      .is("error", null)
      .gt("calls_used", 0)
      .order("created_at", { ascending: false }),
    // How many of last time's rows are still downloadable. This is what turns
    // "you have already done this" from a dead end into an offer: the rows are
    // right here, free, instead of a second trip to Google.
    admin
      .from("re_discovery_leads")
      .select("id", { count: "exact", head: true })
      .in("query_text", texts),
  ]);

  const done = new Set((data ?? []).map((row: { query_text: string }) => row.query_text));

  return NextResponse.json({
    total: plan.length,
    alreadyDone: done.size,
    lastRunAt: data?.[0]?.created_at ?? null,
    storedRows: stored.count ?? 0,
  });
}

// ── start ───────────────────────────────────────────────────

async function startRun(admin: Admin, userId: string, body: Record<string, unknown>) {
  const industry = findIndustry(String(body.industry ?? ""));
  const category = findCategory(String(body.category ?? ""));
  const state = String(body.state ?? "").trim();
  const districts = asStringArray(body.districts);
  const areas = asStringArray(body.areas);
  const pincode = typeof body.pincode === "string" ? body.pincode.trim() : null;

  // The taxonomy is checked here, not just in the dropdown: "dealers" and
  // "retailers" are not offered for a reason, and a hand-made request must not
  // get round that.
  if (!industry) return NextResponse.json({ error: "Pick an industry" }, { status: 400 });
  if (!category) return NextResponse.json({ error: "Pick a category" }, { status: 400 });
  if (!state) return NextResponse.json({ error: "Pick a state" }, { status: 400 });
  if (districts.length === 0) {
    return NextResponse.json({ error: "Pick at least one district" }, { status: 400 });
  }

  const plan = planFor({ industry: industry.value, category: category.value, state, districts, areas, pincode });
  if (plan.length === 0) {
    return NextResponse.json({ error: "Nothing to search with those choices" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("re_discovery_runs")
    .insert({
      owner_id: userId,
      industry: industry.value,
      industry_label: industry.label,
      category: category.value,
      state,
      districts,
      areas,
      pincode,
      queries_planned: plan.length,
      ignore_seen: body.ignoreSeen === true,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const alreadyDone =
    body.ignoreSeen === true ? new Set<string>() : await readRecentSearches(admin, plan.map((p) => p.text));

  return NextResponse.json({
    runId: data.id,
    plan: planPayload(plan, alreadyDone),
  });
}

/**
 * The plan as the browser needs it: names to show progress by, and a flag per
 * search saying "this one is free, skip it".
 *
 * The browser gets the plan only to narrate itself. The server rebuilds it
 * independently on every search and trusts nothing from the browser but an
 * index into it.
 */
function planPayload(plan: ReturnType<typeof planFor>, alreadyDone: Set<string>) {
  return plan.map((spec, index) => ({
    index,
    text: spec.text,
    district: spec.district,
    area: spec.area,
    done: alreadyDone.has(spec.text),
  }));
}

// ── resume ──────────────────────────────────────────────────

/**
 * Picks an interrupted harvest back up.
 *
 * The browser loses a harvest for ordinary reasons — Chrome discards the tab,
 * or a stray click leaves the page — and before this the quota spent was simply
 * gone along with the rows. Now the rows are on the server and the plan is
 * rebuilt from the run row, so resuming costs nothing: the searches already
 * done are marked done, and the rows already found come back with them.
 */
async function resumeRun(admin: Admin, userId: string, body: Record<string, unknown>) {
  const runId = String(body.runId ?? "");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const { data: run } = await admin
    .from("re_discovery_runs")
    .select(
      "id, owner_id, industry, industry_label, category, state, districts, areas, pincode, ignore_seen, queries_planned, started_at",
    )
    .eq("id", runId)
    .single();

  if (!run) return NextResponse.json({ error: "That harvest no longer exists" }, { status: 404 });
  if (run.owner_id !== userId) return NextResponse.json({ error: "Not your run" }, { status: 403 });

  const plan = planFor({
    industry: run.industry,
    category: run.category,
    state: run.state,
    districts: run.districts ?? [],
    areas: run.areas ?? [],
    pincode: run.pincode,
  });

  if (plan.length === 0) {
    return NextResponse.json({ error: "That harvest's choices no longer build a plan" }, { status: 400 });
  }

  // Searches this run itself finished. Counted separately from the reuse window
  // because a run started with "ignore my previous harvests" must still not
  // repeat its own completed searches — that would be paying twice inside one
  // harvest, which no setting asks for.
  const { data: ownQueries } = await admin
    .from("re_discovery_queries")
    .select("query_text")
    .eq("run_id", runId)
    .is("error", null)
    .gt("calls_used", 0);

  const done = new Set((ownQueries ?? []).map((row: { query_text: string }) => row.query_text));

  if (run.ignore_seen !== true) {
    for (const text of await readRecentSearches(admin, plan.map((p) => p.text))) done.add(text);
  }

  // A count, not the rows. This runs on every page load while an unfinished
  // harvest is remembered, and the rows can be several megabytes; they are
  // fetched by the "rows" action once the founder actually asks for them.
  const { count } = await admin
    .from("re_discovery_leads")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);

  return NextResponse.json({
    runId: run.id,
    plan: planPayload(plan, done),
    rowsStored: count ?? 0,
    ignoreSeen: run.ignore_seen === true,
    startedAt: run.started_at,
    industryLabel: run.industry_label,
    state: run.state,
  });
}

/**
 * Which of these exact searches already ran successfully inside the reuse window.
 * Only successful calls count — a search that errored cost a call but returned
 * nothing, so it is worth retrying.
 */
async function readRecentSearches(admin: Admin, texts: string[]): Promise<Set<string>> {
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

// ── search ──────────────────────────────────────────────────

interface SearchResponse {
  rows: DiscoveryRow[];
  callsUsed: number;
  resultsCount: number;
  duplicates: number;
  skipped: Record<SkipReason, number>;
  usage: Usage;
  /** Set when the harvest must stop: cap reached, key missing, quota refused. */
  stop: string | null;
  error: string | null;
}

async function runSearch(admin: Admin, userId: string, body: Record<string, unknown>) {
  const apiKey = placesApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_PLACES_API_KEY is not set on the server. Add it in Vercel, then redeploy." },
      { status: 400 },
    );
  }

  const runId = String(body.runId ?? "");
  const index = Number(body.index);
  if (!runId || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "runId and index are required" }, { status: 400 });
  }

  const { data: run, error: runError } = await admin
    .from("re_discovery_runs")
    .select("id, owner_id, industry, industry_label, category, state, districts, areas, pincode")
    .eq("id", runId)
    .single();

  if (runError || !run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.owner_id !== userId) return NextResponse.json({ error: "Not your run" }, { status: 403 });

  const plan = planFor({
    industry: run.industry,
    category: run.category,
    state: run.state,
    districts: run.districts ?? [],
    areas: run.areas ?? [],
    pincode: run.pincode,
  });

  const spec = plan[index];
  if (!spec) return NextResponse.json({ error: "No such search in this run" }, { status: 400 });

  const usageBefore = await readUsage(admin);
  const empty: Record<SkipReason, number> = { retail: 0, closed: 0, no_phone: 0, no_id: 0 };

  if (usageBefore.dailyRemaining <= 0) {
    return NextResponse.json<SearchResponse>({
      rows: [],
      callsUsed: 0,
      resultsCount: 0,
      duplicates: 0,
      skipped: empty,
      usage: usageBefore,
      stop: `Daily cap of ${DAILY_CALL_CAP} calls reached. This is the brake that keeps the tool free — carry on tomorrow.`,
      error: null,
    });
  }

  if (usageBefore.monthlyRemaining <= 0) {
    return NextResponse.json<SearchResponse>({
      rows: [],
      callsUsed: 0,
      resultsCount: 0,
      duplicates: 0,
      skipped: empty,
      usage: usageBefore,
      stop: `This month's ${MONTHLY_FREE_CALLS.toLocaleString("en-IN")} free calls are used up. Anything more would be billed, so the harvest stopped.`,
      error: null,
    });
  }

  // Never overshoot the cap: shorten the last search of the day rather than
  // spending three pages when one is left.
  const maxPages = Math.max(1, Math.min(MAX_PAGES, usageBefore.dailyRemaining, usageBefore.monthlyRemaining));

  const search = await searchText(apiKey, spec.text, maxPages);

  const includeWithoutPhone = body.includeWithoutPhone === true;
  const ignoreSeen = body.ignoreSeen === true;

  const skipped: Record<SkipReason, number> = { ...empty };
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
      { includeWithoutPhone },
    );
    if (result.row) mapped.push(result.row);
    else if (result.skip) skipped[result.skip]++;
  }

  // Deduplicate inside this page set first, then against every past harvest.
  const withinBatch = dedupeRows(mapped);
  const seen = ignoreSeen ? new Set<string>() : await readSeen(admin, withinBatch.rows.map((r) => r.placeId));
  const final = dedupeRows(withinBatch.rows, seen);

  // Record the place IDs BEFORE answering, so a lost response cannot leave the
  // same company eligible to be harvested again in a later run.
  //
  // The rows go down in the same breath, for the same reason: a response that
  // never arrives, or a tab that dies while it is in flight, must not throw
  // away companies the quota has already been spent on.
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

    // A failed save is not a failed search: the rows are already on their way
    // to the browser and the CSV it builds is still correct. All that is lost is
    // the ability to download this batch again, so it is logged, not thrown.
    if (stored.error) {
      console.error("[discover] could not store harvested rows", stored.error.message);
    } else if ((stored.data?.length ?? 0) > 0) {
      await admin.rpc("re_discovery_add_leads", { p_run_id: runId, p_count: stored.data.length });
    }
  }

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

  const usage = await readUsage(admin);

  let stop: string | null = null;
  if (search.quotaExhausted) {
    stop = "Google says the quota is exhausted. That is the Cloud-console cap doing its job — nothing has been billed.";
  } else if (usage.dailyRemaining <= 0) {
    stop = `Daily cap of ${DAILY_CALL_CAP} calls reached. Carry on tomorrow.`;
  } else if (usage.monthlyRemaining <= 0) {
    stop = `This month's free calls are used up. Carry on from the 1st.`;
  }

  return NextResponse.json<SearchResponse>({
    rows: final.rows,
    callsUsed: search.pagesFetched,
    resultsCount: search.results.length,
    duplicates: withinBatch.duplicates + final.duplicates,
    skipped,
    usage,
    stop,
    error: search.error,
  });
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

// ── finish ──────────────────────────────────────────────────

async function finishRun(admin: Admin, userId: string, body: Record<string, unknown>) {
  const runId = String(body.runId ?? "");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const { data: run } = await admin
    .from("re_discovery_runs")
    .select("id, owner_id")
    .eq("id", runId)
    .single();

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.owner_id !== userId) return NextResponse.json({ error: "Not your run" }, { status: 403 });

  // Totals are summed from the query log rather than counted up as the harvest
  // goes, so a tab that closed mid-run still ends with honest numbers.
  const { data: queries } = await admin
    .from("re_discovery_queries")
    .select("calls_used, results_count, new_count")
    .eq("run_id", runId);

  const totals = (queries ?? []).reduce(
    (acc, row: { calls_used: number; results_count: number; new_count: number }) => ({
      queries_done: acc.queries_done + 1,
      calls_used: acc.calls_used + (row.calls_used ?? 0),
      rows_found: acc.rows_found + (row.results_count ?? 0),
      rows_new: acc.rows_new + (row.new_count ?? 0),
    }),
    { queries_done: 0, calls_used: 0, rows_found: 0, rows_new: 0 },
  );

  const status = body.abandoned === true ? "abandoned" : "finished";

  const { error } = await admin
    .from("re_discovery_runs")
    .update({ ...totals, status, finished_at: new Date().toISOString() })
    .eq("id", runId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, totals, status });
}

// ── stored rows ─────────────────────────────────────────────

/** Every lead column, in one place so a select and an insert cannot drift. */
const LEAD_COLUMNS =
  "place_id, name, phone, website, address, area, city, district, state, pincode, searched_in, outside_searched_area, latitude, longitude, rating, reviews, primary_type, industry";

/**
 * Supabase caps a select at 1,000 rows. A Karnataka sweep is several thousand,
 * so stored rows are read in pages — a silent truncation here would hand back
 * a short CSV that looks complete.
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
async function readStoredRows(
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
function sourceLabel(state: string): string {
  return `Google Maps — ${state}`;
}

/** Rows of one past harvest, so its CSV can be saved again. */
async function rowsForRun(admin: Admin, userId: string, body: Record<string, unknown>) {
  const runId = String(body.runId ?? "");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const { data: run } = await admin
    .from("re_discovery_runs")
    .select("id, owner_id, state, industry, industry_label")
    .eq("id", runId)
    .single();

  if (!run) return NextResponse.json({ error: "Harvest not found" }, { status: 404 });
  if (run.owner_id !== userId) return NextResponse.json({ error: "Not your run" }, { status: 403 });

  const rows = await readStoredRows(admin, { runId });

  return NextResponse.json({
    rows,
    source: sourceLabel(run.state),
    industry: run.industry,
    state: run.state,
    // Zero is a real answer, not an error: harvests from before the rows were
    // stored, and anything past the 90 days, have nothing left to hand back.
    expired: rows.length === 0,
  });
}

/**
 * Rows the last harvest of this exact selection produced.
 *
 * Scoped by search text rather than by run, because a run may have covered
 * twenty districts and the question being asked is about the three on screen.
 */
async function rowsForSelection(admin: Admin, body: Record<string, unknown>) {
  const plan = planFromBody(body);
  if (plan.length === 0) {
    return NextResponse.json({ error: "Nothing to look up with those choices" }, { status: 400 });
  }

  const rows = await readStoredRows(admin, { queryTexts: plan.map((spec) => spec.text) });
  const state = String(body.state ?? "").trim();

  return NextResponse.json({ rows, source: sourceLabel(state), expired: rows.length === 0 });
}

/**
 * Deletes harvested rows past the retention window, and zeroes the counter that
 * advertised them.
 *
 * Runs on page load rather than from cron: this table is written by exactly one
 * tool, which cannot be used without loading this page, so a separate scheduled
 * job would only be a second thing to notice had stopped working.
 */
async function purgeOldLeads(admin: Admin) {
  const cutoff = new Date(Date.now() - LEADS_RETENTION_DAYS * 86_400_000).toISOString();

  const { error } = await admin.from("re_discovery_leads").delete().lt("created_at", cutoff);
  // Never fail the page over housekeeping — the quota figures above it matter
  // more than the purge, which will simply be retried on the next load.
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

// ── shared ──────────────────────────────────────────────────

/**
 * Rebuilds the search plan from what the run row stores. Deterministic, so the
 * server never has to trust a query string from the browser — only an index into
 * this plan.
 */
function planFor(input: {
  industry: string;
  category: string;
  state: string;
  districts: string[];
  areas: string[];
  pincode: string | null;
}) {
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

/** The plan a request body describes, or [] when it does not describe one. */
function planFromBody(body: Record<string, unknown>) {
  const industry = findIndustry(String(body.industry ?? ""));
  const category = findCategory(String(body.category ?? ""));
  const state = String(body.state ?? "").trim();
  const districts = asStringArray(body.districts);

  if (!industry || !category || !state || districts.length === 0) return [];

  return planFor({
    industry: industry.value,
    category: category.value,
    state,
    districts,
    areas: asStringArray(body.areas),
    pincode: typeof body.pincode === "string" ? body.pincode.trim() : null,
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}
