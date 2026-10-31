import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Calling the dashboard aggregate RPCs, with the old code path as a safety net.
 *
 * WHY THESE RPCs EXIST. Every money figure on the dashboard used to be a
 * `.select()` of rows that JavaScript then added up. PostgREST caps an
 * unbounded select at 1,000 rows and says nothing about it — no error, no
 * flag — so any tenant past 1,000 matching rows was shown a wrong number with
 * no way to tell. On the live "Satyam Ceramics & Sanitary" account the
 * Outstanding tile was not merely low: it read NEGATIVE, because the orders
 * side of the subtraction lost 1,126 rows while the payments side lost 68.
 *
 * Server-side aggregates are disabled on this Supabase project
 * (`select=total_amount.sum()` answers PGRST123), so the sum has to happen
 * inside a function. See supabase/migrations/20261031120000_dashboard_aggregate_rpcs.sql.
 *
 * WHY THE FALLBACK. The migration is applied by hand in the Supabase SQL
 * editor, so there is a window where this code is live and the functions do
 * not exist yet. Shipping without a fallback would blank every money tile
 * during that window. Instead each caller keeps its original row-fetching
 * implementation and uses it when the RPC is unavailable — the dashboard shows
 * the old (truncated) figure until the migration runs, and the correct one
 * immediately after, with nothing to redeploy.
 *
 * The fallback is deliberately taken on ANY failure, not only on "function
 * not found": a transient error should leave a tile showing an approximate
 * number rather than nothing. Every fallback warns to the console so the
 * window is visible to anyone looking, instead of being silent the way the
 * truncation was.
 */

/** Postgres/PostgREST codes that mean "this function is not there (yet)". */
const MISSING_FUNCTION_CODES = new Set([
  "PGRST202", // Could not find the function in the schema cache
  "PGRST203", // Could not choose the best candidate function
  "42883", // undefined_function
]);

export type AggregateResult<T> = { ok: true; data: T } | { ok: false; missing: boolean };

/**
 * Call an aggregate RPC. `ok: false` means the caller should run its own
 * fallback; `missing` distinguishes "migration not applied" from a real error,
 * purely so the console message is useful.
 *
 * A null/undefined payload counts as a failure. None of these functions
 * returns null — they return 0, {} or [] for an empty account — so a null can
 * only mean the call did not really happen (which is also what the unit-test
 * stubs produce, keeping them on the fallback path they were written for).
 */
export async function callAggregateRpc<T>(
  db: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<AggregateResult<T>> {
  try {
    const { data, error } = await db.rpc(fn, args);
    if (error) {
      const missing = MISSING_FUNCTION_CODES.has(String(error.code));
      warn(fn, missing, error.message);
      return { ok: false, missing };
    }
    if (data === null || data === undefined) {
      return { ok: false, missing: true };
    }
    return { ok: true, data: data as T };
  } catch (e) {
    warn(fn, false, (e as Error)?.message ?? String(e));
    return { ok: false, missing: false };
  }
}

function warn(fn: string, missing: boolean, message: string): void {
  if (missing) {
    console.warn(
      `[dashboard] ${fn} is not in the database yet — falling back to the old ` +
        `row-by-row totals, which truncate at 1,000 rows. Apply ` +
        `supabase/migrations/20261031120000_dashboard_aggregate_rpcs.sql to fix the figures.`,
    );
    return;
  }
  console.warn(`[dashboard] ${fn} failed (${message}) — falling back to row-by-row totals.`);
}

/** Numbers cross the wire as strings when Postgres returns `numeric`. */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
