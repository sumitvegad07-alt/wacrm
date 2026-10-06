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
// Call counts, and Google Place IDs for deduplication. Never a prospect's name,
// phone or address — see the migration header for why.
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

    const [usage, runs] = await Promise.all([
      readUsage(admin),
      admin
        .from("re_discovery_runs")
        .select(
          "id, industry_label, category, state, districts, areas, queries_planned, queries_done, calls_used, rows_found, rows_new, status, started_at",
        )
        .order("started_at", { ascending: false })
        .limit(15),
    ]);

    return NextResponse.json({
      usage,
      hasApiKey: Boolean(placesApiKey()),
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
      case "start":
        return await startRun(admin, ctx.userId, body);
      case "search":
        return await runSearch(admin, ctx.userId, body);
      case "finish":
        return await finishRun(admin, ctx.userId, body);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
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
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const alreadyDone =
    body.ignoreSeen === true ? new Set<string>() : await readRecentSearches(admin, plan.map((p) => p.text));

  return NextResponse.json({
    runId: data.id,
    // The browser gets the plan so it can show progress by name; the server
    // rebuilds it independently on every search and trusts only the index.
    plan: plan.map((spec, index) => ({
      index,
      text: spec.text,
      district: spec.district,
      area: spec.area,
      // Already paid for recently: the browser skips these without a call.
      done: alreadyDone.has(spec.text),
    })),
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
  if (final.rows.length > 0) {
    await admin.from("re_discovery_seen_places").upsert(
      final.rows.map((row) => ({ place_id: row.placeId, run_id: runId })),
      { onConflict: "place_id", ignoreDuplicates: true },
    );
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}
