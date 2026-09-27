// ============================================================
// The retention job.
//
// Thin on purpose. Every decision — what is eligible, how old it must be, how a
// day of pings becomes one row — lives in policy.ts, summarise.ts and group.ts,
// which are pure and tested. This file only moves data.
//
// Two safety rules are enforced here and must not be relaxed:
//
//   1. A ping is deleted BY ID, and only an id that was just written into a
//      summary. Deleting by timestamp would remove rows that a failed or
//      partial roll-up never recorded, and the distance would be gone for good.
//
//   2. Nothing is deleted unless `dryRun` is false. The job runs in preview mode
//      until the founder is satisfied with what it reports.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { groupPingsByLocalDay, parseGroupKey, type UserPing } from "./group";
import { retentionPlan, type RetentionJob } from "./policy";
import { summariseDay } from "./summarise";

/** How many user-days to process per account per run. */
const DAY_BATCH = 200;

export interface RetentionResult {
  mode: "preview" | "delete";
  accountsProcessed: number;
  summarisedDays: number;
  rowsAffected: number;
  /** Rows removed (or, in preview, that would be removed) per table. */
  detail: Record<string, number>;
  errors: string[];
}

interface AccountRow {
  id: string;
  name: string | null;
  retention_days: number | null;
  settings: { timezone?: string } | null;
}

type Admin = SupabaseClient;

/** The account's own timezone, defaulting to IST. */
function zoneOf(account: AccountRow): string {
  const tz = account.settings?.timezone;
  return typeof tz === "string" && tz.length > 0 ? tz : "Asia/Kolkata";
}

export async function runRetention(
  admin: Admin,
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun !== false;

  const result: RetentionResult = {
    mode: dryRun ? "preview" : "delete",
    accountsProcessed: 0,
    summarisedDays: 0,
    rowsAffected: 0,
    detail: {},
    errors: [],
  };

  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id, name, retention_days, settings")
    .is("deleted_at", null);

  if (error) {
    result.errors.push(`accounts: ${error.message}`);
    return result;
  }

  for (const account of (accounts ?? []) as AccountRow[]) {
    result.accountsProcessed += 1;
    const plan = retentionPlan(now, account.retention_days ?? undefined);

    try {
      await rollUpLocationDays(admin, account, plan, dryRun, result);
      await deleteAged(admin, account, plan, dryRun, result);
    } catch (err) {
      result.errors.push(
        `${account.name ?? account.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

/**
 * Turn each pending user-day into one summary row, then delete exactly the
 * pings that went into it.
 */
async function rollUpLocationDays(
  admin: Admin,
  account: AccountRow,
  plan: RetentionJob[],
  dryRun: boolean,
  result: RetentionResult,
): Promise<void> {
  const pingRule = plan.find((j) => j.table === "location_pings");
  if (!pingRule) return;

  const tz = zoneOf(account);
  const cutoff = pingRule.cutoff.toISOString();

  const { data: pending, error: pendingErr } = await admin.rpc("retention_pending_days", {
    p_account: account.id,
    p_before: cutoff,
    p_tz: tz,
    p_limit: DAY_BATCH,
  });

  if (pendingErr) throw new Error(`pending days: ${pendingErr.message}`);
  if (!pending?.length) return;

  for (const { user_id } of pending as Array<{ user_id: string; day: string }>) {
    // Fetch the user's whole pre-cutoff window in one go, then group locally.
    // Selecting a single day would need timezone arithmetic in the query; the
    // grouping is already tested, so it is done here instead.
    const { data: pings, error: pingErr } = await admin
      .from("location_pings")
      .select("id, user_id, lat, lng, recorded_at, is_mocked")
      .eq("account_id", account.id)
      .eq("user_id", user_id)
      .lt("recorded_at", cutoff)
      .order("recorded_at", { ascending: true });

    if (pingErr) throw new Error(`pings: ${pingErr.message}`);
    if (!pings?.length) continue;

    const groups = groupPingsByLocalDay(pings as unknown as UserPing[], tz);

    for (const [key, dayPings] of groups) {
      const { day } = parseGroupKey(key);
      const summary = summariseDay(dayPings);
      if (!summary) continue;

      result.summarisedDays += 1;
      if (dryRun) continue;

      const { error: upsertErr } = await admin.from("location_daily_summary").upsert(
        {
          account_id: account.id,
          user_id,
          day,
          distance_km: summary.distanceKm,
          ping_count: summary.pingCount,
          mocked_count: summary.mockedCount,
          first_at: summary.firstAt,
          last_at: summary.lastAt,
          first_lat: summary.firstLat,
          first_lng: summary.firstLng,
          last_lat: summary.lastLat,
          last_lng: summary.lastLng,
        },
        { onConflict: "account_id,user_id,day" },
      );

      if (upsertErr) throw new Error(`summary ${day}: ${upsertErr.message}`);

      // Only now, and only these exact rows. The summary is written and
      // confirmed before anything is destroyed.
      const ids = (dayPings as unknown as Array<{ id: number }>).map((p) => p.id);
      const { error: delErr } = await admin.from("location_pings").delete().in("id", ids);
      if (delErr) throw new Error(`delete pings ${day}: ${delErr.message}`);

      bump(result, "location_pings", ids.length);
    }
  }
}

/** Everything that is simply aged out: no summary, no roll-up, just a cutoff. */
async function deleteAged(
  admin: Admin,
  account: AccountRow,
  plan: RetentionJob[],
  dryRun: boolean,
  result: RetentionResult,
): Promise<void> {
  for (const job of plan) {
    if (job.requiresSummary) continue; // handled by rollUpLocationDays

    const cutoff = job.cutoff.toISOString();

    if (dryRun) {
      const { count, error } = await admin
        .from(job.table)
        .select("*", { count: "exact", head: true })
        .eq("account_id", account.id)
        .lt(job.dateColumn, cutoff);

      if (error) throw new Error(`${job.table} count: ${error.message}`);
      bump(result, job.table, count ?? 0);
      continue;
    }

    const { data, error } = await admin
      .from(job.table)
      .delete()
      .eq("account_id", account.id)
      .lt(job.dateColumn, cutoff)
      .select("id");

    if (error) throw new Error(`${job.table} delete: ${error.message}`);
    bump(result, job.table, data?.length ?? 0);
  }
}

function bump(result: RetentionResult, table: string, rows: number): void {
  if (!rows) return;
  result.detail[table] = (result.detail[table] ?? 0) + rows;
  result.rowsAffected += rows;
}
