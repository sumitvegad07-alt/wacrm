// ============================================================
// Lead Discovery API — founder-only, like every route under /api/admin.
//
// WHAT CHANGED, AND WHY IT MATTERS
//
// This route used to drive the harvest one search at a time, because the
// browser was running the loop. It no longer does. The page starts a harvest
// and then only asks how it is getting on: the searching happens in the worker
// route, on the server, and carries on whether or not the tab is open.
//
// So the actions here are now about a job, not a loop:
//   preview    — have I already done this, and is there anything stored?
//   start      — create the job and set the first worker going
//   status     — how far has it got (polled while the page is open)
//   stop       — ask it to stop after the search in flight
//   rows       — one harvest's rows, as a CSV
//   priorRows  — what this exact selection found last time
//
// WHAT NEVER LEAVES THE SERVER
//
// The Google API key. The browser only ever sees rows that come back.
//
// WHAT IS WRITTEN TO THE DATABASE
//
// Call counts, Google Place IDs for deduplication, and the harvested rows
// themselves for 90 days so a CSV can be downloaded again. See the migrations
// 20261006100000 and 20261010100000 for the trade that was made there.
// ============================================================

import { NextRequest, NextResponse, after } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { issuerBaseUrl } from "@/lib/mcp/oauth/issuer";
import { harvestAndHandOn, kickWorker } from "@/lib/revenue/discovery-chain";
import {
  HEARTBEAT_STALE_SECONDS,
  SEARCH_REUSE_DAYS,
  planFor,
  purgeOldLeads,
  readStoredRows,
  readUsage,
  sourceLabel,
  type Admin,
  type Usage,
} from "@/lib/revenue/discovery-runner";
import { findCategory, findIndustry } from "@/lib/revenue/discovery-taxonomy";
import { placesApiKey } from "@/lib/revenue/places-client";

export const dynamic = "force-dynamic";

/** The columns the page needs to describe a harvest that is still going. */
const ACTIVE_COLUMNS =
  "id, status, industry, industry_label, category, state, districts, queries_planned, queries_done, next_index, calls_used, rows_new, leads_stored, stop_reason, last_error, cancel_requested, heartbeat_at, started_at";

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

export async function GET(req: NextRequest) {
  try {
    await requireFounder();
    const admin = serviceClient();

    await purgeOldLeads(admin);

    const [usage, runs, active] = await Promise.all([
      readUsage(admin),
      admin
        .from("re_discovery_runs")
        .select(
          "id, industry_label, category, state, districts, queries_planned, queries_done, calls_used, rows_found, rows_new, leads_stored, status, started_at",
        )
        .order("started_at", { ascending: false })
        .limit(15),
      readActiveRun(admin),
    ]);

    // Opening this page is also how a harvest that lost its hand-off gets going
    // again. Nothing happens if a worker already holds it — the claim refuses —
    // so this is safe to do on every load.
    if (active) await nudgeIfStalled(admin, req, active, usage);

    return NextResponse.json({
      usage,
      hasApiKey: Boolean(placesApiKey()),
      // Without it a harvest does its first few minutes and then cannot hand on
      // to a fresh invocation — it would only ever creep forward when this page
      // is opened. Worth saying out loud rather than looking like slowness.
      hasCronSecret: Boolean(process.env.CRON_SECRET),
      // Founder-only diagnostic, NAMES only and never values. Setting this key
      // cost two deploys of guessing at whether Vercel was passing it through
      // and under what name; the server can answer that in one reload.
      envNames: Object.keys(process.env)
        .filter((name) => /GOOGLE|PLACES|MAPS/i.test(name))
        .sort(),
      runs: runs.data ?? [],
      active,
      recent: active ? await readRecentSearchLog(admin, active.id) : [],
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
        return await startRun(admin, req, ctx.userId, body);
      case "status":
        return await readStatus(admin, req);
      case "stop":
        return await stopRun(admin, ctx.userId, body);
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

// ── the harvest that is still going ─────────────────────────

/** The one harvest still owed work, if there is one. */
async function readActiveRun(admin: Admin): Promise<ActiveRun | null> {
  const { data } = await admin
    .from("re_discovery_runs")
    .select(ACTIVE_COLUMNS)
    .in("status", ["queued", "running"])
    .order("started_at", { ascending: false })
    .limit(1);

  return (data?.[0] as ActiveRun | undefined) ?? null;
}

/**
 * Sets a worker going on a harvest that has gone quiet.
 *
 * A run is quiet when no worker has touched it for longer than the claim
 * window — a lost hand-off, or an invocation that died. Paused for a cap is not
 * quiet: it is waiting for tomorrow, and prodding it would only have it hit the
 * same cap and pause again.
 */
async function nudgeIfStalled(
  admin: Admin,
  req: NextRequest,
  active: ActiveRun,
  usage: Usage,
): Promise<void> {
  if (active.cancel_requested) return;
  if (usage.dailyRemaining <= 0 || usage.monthlyRemaining <= 0) return;

  const stale =
    active.heartbeat_at === null ||
    Date.now() - Date.parse(active.heartbeat_at) > HEARTBEAT_STALE_SECONDS * 1000;
  if (!stale) return;

  await kickWorker(issuerBaseUrl(req), active.id);
}

/** What the page polls for while a harvest is going. */
async function readStatus(admin: Admin, req: NextRequest) {
  const [usage, active] = await Promise.all([readUsage(admin), readActiveRun(admin)]);
  if (active) await nudgeIfStalled(admin, req, active, usage);

  return NextResponse.json({
    usage,
    active,
    recent: active ? await readRecentSearchLog(admin, active.id) : [],
  });
}

/**
 * The last few searches of a harvest, newest first.
 *
 * The page used to build this list as the rows arrived in the browser. Now that
 * the searching happens on the server it has to be read back, and it is worth
 * reading back: "Dahod GIDC — 47 found, 31 kept" is how he can tell a harvest
 * that is working from one that is finding nothing.
 */
async function readRecentSearchLog(admin: Admin, runId: string) {
  const { data } = await admin
    .from("re_discovery_queries")
    .select("query_text, district, area, results_count, new_count, error, created_at")
    .eq("run_id", runId)
    .order("id", { ascending: false })
    .limit(25);

  return data ?? [];
}

// ── preview ─────────────────────────────────────────────────

/**
 * Answers "have I already done this?" before a single call is spent.
 *
 * The harvest already skips a search it ran recently, but the founder only
 * learned that after pressing Start and watching nothing happen. Asking the
 * same question up front turns a silent no-op into an answer he can act on:
 * take last time's rows, search again anyway, or pick somewhere else.
 */
async function previewPlan(admin: Admin, body: Record<string, unknown>) {
  const plan = planFromBody(body);
  if (plan.length === 0) {
    return NextResponse.json({ total: 0, alreadyDone: 0, lastRunAt: null, storedRows: 0 });
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
    // "you have already done this" from a dead end into an offer.
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

async function startRun(
  admin: Admin,
  req: NextRequest,
  userId: string,
  body: Record<string, unknown>,
) {
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
  if (!placesApiKey()) {
    return NextResponse.json(
      { error: "GOOGLE_PLACES_API_KEY is not set on the server. Add it in Vercel, then redeploy." },
      { status: 400 },
    );
  }

  // One at a time. Two harvests running together would spend the same daily cap
  // from both ends and leave the page unable to say which one it is showing.
  const running = await readActiveRun(admin);
  if (running) {
    return NextResponse.json(
      {
        error:
          "A harvest is already going. Wait for it to finish, or stop it first — only one runs at a time so they cannot spend the same daily cap twice.",
        activeRunId: running.id,
      },
      { status: 409 },
    );
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
      include_without_phone: body.includeWithoutPhone === true,
      status: "queued",
      next_index: 0,
    })
    .select(ACTIVE_COLUMNS)
    .single<ActiveRun>();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not start" }, { status: 400 });
  }

  // Answer first, harvest after. `after` keeps this invocation alive once the
  // response has gone, so the first few minutes of searching happen here rather
  // than waiting on a separate round trip.
  const baseUrl = issuerBaseUrl(req);
  after(() => harvestAndHandOn(baseUrl, data.id));

  return NextResponse.json({ runId: data.id, active: data, queriesPlanned: plan.length });
}

// ── stop ────────────────────────────────────────────────────

/**
 * Asks the harvest to stop after the search in flight.
 *
 * The flag goes down before anything else, because `re_discovery_claim_run`
 * refuses a cancelled run: once it is set, no new worker can pick this up, and
 * the one holding it will see the flag between searches. A search already paid
 * for is always allowed to finish and be banked.
 */
async function stopRun(admin: Admin, userId: string, body: Record<string, unknown>) {
  const runId = String(body.runId ?? "");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const { data: run } = await admin
    .from("re_discovery_runs")
    .select("id, owner_id, status, heartbeat_at")
    .eq("id", runId)
    .single<{ id: string; owner_id: string; status: string; heartbeat_at: string | null }>();

  if (!run) return NextResponse.json({ error: "Harvest not found" }, { status: 404 });
  if (run.owner_id !== userId) return NextResponse.json({ error: "Not your run" }, { status: 403 });

  await admin.from("re_discovery_runs").update({ cancel_requested: true }).eq("id", runId);

  // Nothing is holding it, so nothing will ever read the flag. Close it here.
  if (run.heartbeat_at === null) {
    await admin
      .from("re_discovery_runs")
      .update({ status: "stopped", finished_at: new Date().toISOString() })
      .eq("id", runId)
      .in("status", ["queued", "running"]);
  }

  return NextResponse.json({ ok: true });
}

// ── stored rows ─────────────────────────────────────────────

/** Rows of one harvest, so its CSV can be saved again. */
async function rowsForRun(admin: Admin, userId: string, body: Record<string, unknown>) {
  const runId = String(body.runId ?? "");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const { data: run } = await admin
    .from("re_discovery_runs")
    .select("id, owner_id, state, industry, industry_label")
    .eq("id", runId)
    .single<{ id: string; owner_id: string; state: string; industry: string; industry_label: string }>();

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

// ── shared ──────────────────────────────────────────────────

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
