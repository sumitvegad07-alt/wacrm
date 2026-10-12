// ============================================================
// Keep the demo tenants' "today" alive.
//
// Every headline tile on the dashboard is scoped to the local day: the live
// agent map, Active Field Agents, Visits Logged Today, Distance Tracked,
// Average Battery, Orders Today. A tenant seeded once looks superb in the
// history charts and reads zero across the top row on every later day — and the
// top row is the first thing a prospect looks at.
//
// So this regenerates today, idempotently: it clears whatever it wrote for
// today and writes it again. Running it twice in a row is a no-op, which is
// what makes it safe both as a nightly cron and as an on-demand command.
//
// It also keeps the tenants from growing without bound: raw GPS older than the
// ping window is dropped once its day has been summarised (the same order the
// retention job uses), and the approval queues are topped up so the two
// "awaiting approval" tiles are never empty.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateHistory, type Counts } from "./history";
import { addDays, istInstant, istMinutesOfDay, istToday, ymd, type IstDay } from "./ist";
import type { DemoTenant } from "./profiles";
import { clearSeedNoise, loadTenant, type Logger } from "./tenant";

type DB = SupabaseClient<any, any, any>;

/** Raw pings are kept for this many days; older days survive as summaries. */
export const PING_DAYS = 7;

export interface RefreshOptions {
  /**
   * Cut today off at this many minutes past IST midnight, or null for the whole
   * working day.
   *
   * The nightly cron passes null: it runs once, so it must leave the dashboard
   * complete for the rest of the day, which means part of the day is briefly
   * timestamped ahead of the clock. `--refresh-now` passes the real clock, for
   * an exact picture before a meeting.
   */
  cutoffMinutes: number | null;
  log: Logger;
}

export async function refreshTenantToday(
  db: DB,
  tenant: DemoTenant,
  opts: RefreshOptions,
): Promise<Counts> {
  const { log } = opts;
  const built = await loadTenant(db, tenant);
  const accountId = built.accountId;
  const today = istToday();
  const dayStart = istInstant(today, 0, 0).toISOString();
  const todayYmd = ymd(today);

  log(`  ${tenant.key} → ${tenant.company} (${accountId})`);

  // ── Clear what a previous run wrote for today ─────────────
  // Children cascade: deleting orders removes their items and dispatches,
  // deleting tracking_sessions removes that session's pings, deleting leaves
  // removes its leave_days. Verified against the live foreign keys.
  await del(db, "orders", (q) => q.eq("account_id", accountId).gte("created_at", dayStart), log);
  await del(db, "payments", (q) => q.eq("account_id", accountId).gte("created_at", dayStart), log);
  await del(db, "site_visits", (q) => q.eq("account_id", accountId).gte("check_in_at", dayStart), log);
  await del(db, "expenses", (q) => q.eq("account_id", accountId).eq("expense_date", todayYmd), log);
  await del(db, "device_health_snapshots", (q) => q.eq("account_id", accountId).gte("recorded_at", dayStart), log);
  // Pings are removed via their session, but a ping whose session was already
  // gone would survive, so sweep today's directly first.
  await del(db, "location_pings", (q) => q.eq("account_id", accountId).gte("recorded_at", dayStart), log);
  await del(db, "tracking_sessions", (q) => q.eq("account_id", accountId).gte("started_at", dayStart), log);
  await del(db, "tasks", (q) => q.eq("account_id", accountId).gte("created_at", dayStart), log);
  // CRM rows too, on the plans that have them — quotation_items and messages
  // cascade from their parents.
  await del(db, "quotations", (q) => q.eq("account_id", accountId).gte("created_at", dayStart), log);
  await del(db, "deals", (q) => q.eq("account_id", accountId).gte("created_at", dayStart), log);
  await del(db, "leads", (q) => q.eq("account_id", accountId).gte("created_at", dayStart), log);
  await del(db, "conversations", (q) => q.eq("account_id", accountId).gte("created_at", dayStart), log);

  // ── Regenerate today ──────────────────────────────────────
  const counts = await generateHistory(db, built, {
    window: { firstDay: today, lastDay: today },
    pingDays: PING_DAYS,
    cutoffMinutes: opts.cutoffMinutes,
    // Not a backfill: one day's worth of leads/tasks, and no new leave requests.
    backfill: false,
    // A blank dashboard because the meeting fell on a Sunday is worse than a
    // calendar that is slightly too busy.
    ignoreCalendar: true,
    log: () => {},
  });

  // ── Prune raw GPS past the ping window ────────────────────
  // Only for days that already have a summary row, so a failed roll-up can
  // never lose a day's distance — the rule the retention policy encodes as
  // `requiresSummary`.
  const pruned = await prunePings(db, accountId, today, log);

  // ── Keep the approval queues non-empty ────────────────────
  await topUpPending(db, built, log);

  // ── Clear the notification noise this run generated ───────
  await clearSeedNoise(db, accountId);

  log(
    `    wrote ${Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}${pruned ? `; pruned ${pruned} old pings` : ""}`,
  );
  return counts;
}

// ── Helpers ─────────────────────────────────────────────────

async function del(
  db: DB,
  table: string,
  build: (q: any) => any,
  log: Logger,
): Promise<void> {
  const { error } = await build(db.from(table).delete());
  if (error) log(`    ! could not clear today's ${table}: ${error.message}`);
}

async function prunePings(
  db: DB,
  accountId: string,
  today: IstDay,
  log: Logger,
): Promise<number> {
  const keepFrom = addDays(today, -(PING_DAYS - 1));
  const cutoff = istInstant(keepFrom, 0, 0);

  // Which older days are already summarised? Only those may be pruned.
  const { data: summarised } = await db
    .from("location_daily_summary")
    .select("day")
    .eq("account_id", accountId)
    .lt("day", ymd(keepFrom));
  const safeDays = new Set(((summarised ?? []) as any[]).map((r) => String(r.day).slice(0, 10)));
  if (safeDays.size === 0) return 0;

  const { data: stale } = await db
    .from("location_pings")
    .select("id, recorded_at")
    .eq("account_id", accountId)
    .lt("recorded_at", cutoff.toISOString())
    .limit(20000);

  const doomed = ((stale ?? []) as any[]).filter((p) => {
    // Compare on the IST day the ping belongs to, not the UTC date, so a ping
    // recorded at 01:00 IST is not attributed to the previous day.
    const d = new Date(p.recorded_at);
    const shifted = new Date(d.getTime() + 330 * 60_000);
    const key = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
    return safeDays.has(key);
  });
  if (doomed.length === 0) return 0;

  for (let i = 0; i < doomed.length; i += 500) {
    const ids = doomed.slice(i, i + 500).map((p) => p.id);
    const { error } = await db.from("location_pings").delete().in("id", ids);
    if (error) {
      log(`    ! could not prune pings: ${error.message}`);
      return i;
    }
  }
  return doomed.length;
}

/**
 * The dashboard's two approval tiles read `expenses.status = 'Pending'` and
 * `leaves.status = 'Pending'` with no date filter, so they only go empty if the
 * queues genuinely drain. Today's generated expenses include a few Pending
 * already; this is the floor underneath that, in case a run produced none.
 */
async function topUpPending(db: DB, built: Awaited<ReturnType<typeof loadTenant>>, log: Logger) {
  const { accountId, reps, masters, rng } = built;
  const today = istToday();

  const { count: pendingExpenses } = await db
    .from("expenses")
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("status", "Pending");

  if ((pendingExpenses ?? 0) < 3 && masters.expenseTypeIds.length) {
    const rows = [];
    for (let i = (pendingExpenses ?? 0); i < 3; i++) {
      const rep = reps[i % reps.length];
      const type = rng.pick(masters.expenseTypeIds);
      const km = type.travelling ? rng.between(18, 70) : null;
      const rate = type.travelling ? (type.name.includes("Car") ? 9 : 4) : null;
      rows.push({
        account_id: accountId,
        employee_id: rep.profileId, // profiles.id
        expense_type_id: type.id,
        expense_date: ymd(addDays(today, -rng.between(0, 2))),
        amount: km && rate ? km * rate : rng.messyAmount(200, 1200),
        travel_km: km,
        rate_per_km: rate,
        remarks: "Field visit expenses",
        status: "Pending",
        is_active: true,
      });
    }
    const { error } = await db.from("expenses").insert(rows);
    if (error) log(`    ! could not top up pending expenses: ${error.message}`);
  }

  const { count: pendingLeaves } = await db
    .from("leaves")
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("status", "Pending");

  if ((pendingLeaves ?? 0) < 2 && masters.leaveTypeIds.length) {
    const rows = [];
    for (let i = (pendingLeaves ?? 0); i < 2; i++) {
      const rep = reps[(i + 2) % reps.length];
      const start = addDays(today, rng.between(3, 20));
      rows.push({
        account_id: accountId,
        employee_id: rep.profileId, // profiles.id
        leave_type_id: rng.pick(masters.leaveTypeIds).id,
        from_date: ymd(start),
        to_date: ymd(start),
        total_days: 1,
        reason: "Personal work",
        status: "Pending",
        applied_by: rep.profileId, // profiles.id
        is_backdated: false,
      });
    }
    const { error } = await db.from("leaves").insert(rows);
    if (error) log(`    ! could not top up pending leaves: ${error.message}`);
  }
}

/** The IST clock, as a cutoff. Used by `--refresh-now`. */
export function nowCutoff(): number {
  return istMinutesOfDay(new Date());
}
