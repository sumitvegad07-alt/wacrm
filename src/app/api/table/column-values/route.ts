import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toErrorResponse, UnauthorizedError } from "@/lib/auth/account";
import { resolveAllowed } from "./allowlist";

/**
 * The different values present in one column, to fill a table filter dropdown.
 *
 * For columns with a master list behind them — Lead Status, Source, Industry —
 * the filter uses that list and never calls here. This is for the free-text
 * columns people still filter by: City, Area, State, Company.
 *
 * Runs through the caller's own client, so RLS decides which rows they may
 * see. No service role: a value list is still tenant data.
 */

/**
 * The caller's verified auth id.
 *
 * `getClaims` verifies the JWT against the project's signing key, which it
 * caches — so on a project with asymmetric keys there is no network call at
 * all, where `getUser()` always made one. It falls back to `getUser()` itself
 * on a legacy shared-secret project, so this is never less safe, only faster
 * where it can be.
 */
async function currentUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (typeof sub === "string" && sub) return sub;
  } catch {
    // Fall through to getUser below.
  }
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

/** How many rows the scan may look at. Bounds the cost, not just the result. */
const SCAN_LIMIT = 2000;
/** How many values come back. The search box reaches the rest. */
const MAX_VALUES = 100;

export async function GET(req: NextRequest) {
  try {
    /**
     * The caller's account, in ONE round trip.
     *
     * This used to call `getCurrentAccount`, which authenticates the user, reads
     * their profile and then loads the account row — three sequential trips to
     * Mumbai before the scan below even starts, which is most of why opening a
     * filter dropdown took seconds. Nothing here needs the account's name or the
     * caller's role; only `account_id`, and the profiles row carries it.
     *
     * `profiles_select` is account-scoped RLS, so an unauthenticated or
     * unlinked caller reads no row at all — which is exactly the 401 the old
     * `auth.getUser()` check produced, without the extra trip.
     */
    const supabase = await createClient();

    const params = req.nextUrl.searchParams;
    const target = resolveAllowed(params.get("module") ?? "", params.get("column") ?? "");
    if (!target) {
      return NextResponse.json({ error: "Unknown column" }, { status: 400 });
    }

    const userId = await currentUserId(supabase);
    if (!userId) throw new UnauthorizedError();

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", userId)
      .maybeSingle();

    const accountId = (profile as { account_id?: string } | null)?.account_id;
    if (!accountId) throw new UnauthorizedError();

    const search = (params.get("q") ?? "").trim();

    /**
     * `account_id` is filtered in the QUERY, not afterwards on the rows.
     *
     * It reads like belt-and-braces next to RLS, which already restricts these
     * tables to the caller's account — and it was briefly moved to a post-check
     * so the scan could run in parallel with the account lookup. That made the
     * endpoint three times SLOWER (≈0.9s → ≈3.1s against production). Without
     * the explicit filter Postgres cannot use the account_id index, so instead
     * of an index scan stopping at the limit it sequentially scans the table
     * and evaluates the RLS `is_account_member` test on every row. The filter
     * is what makes the query fast; the parallelism was worth far less.
     */
    let query = supabase
      .from(target.table)
      .select(target.column)
      .eq("account_id", accountId)
      .not(target.column, "is", null)
      .neq(target.column, "");

    if (search) {
      // Escape the wildcards PostgREST would otherwise treat as pattern
      // syntax, so a search for "50%" means the characters "50%".
      const escaped = search.replace(/[%_]/g, (ch) => `\\${ch}`);
      query = query.ilike(target.column, `%${escaped}%`);
    }

    const { data, error } = await query.limit(SCAN_LIMIT);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Count as we go, so the list leads with the values that actually come up
    // rather than whatever sorts first alphabetically.
    const counts = new Map<string, number>();
    // `data` is typed loosely because the column name is only known at
    // runtime; the allowlist above is what makes it safe, not the type.
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const raw = row[target.column];
      if (typeof raw !== "string") continue;
      const value = raw.trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    const values = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_VALUES)
      .map(([value]) => value);

    return NextResponse.json({
      values,
      // Either more distinct values than fit, or the scan hit its ceiling and
      // there may be values it never saw. Both mean "offer the search box".
      truncated: counts.size > MAX_VALUES || (data?.length ?? 0) >= SCAN_LIMIT,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
