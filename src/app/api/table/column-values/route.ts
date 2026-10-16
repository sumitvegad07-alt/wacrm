import { NextRequest, NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
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

/** How many rows the scan may look at. Bounds the cost, not just the result. */
const SCAN_LIMIT = 2000;
/** How many values come back. The search box reaches the rest. */
const MAX_VALUES = 100;

export async function GET(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount();

    const params = req.nextUrl.searchParams;
    const target = resolveAllowed(params.get("module") ?? "", params.get("column") ?? "");
    if (!target) {
      return NextResponse.json({ error: "Unknown column" }, { status: 400 });
    }

    const search = (params.get("q") ?? "").trim();

    let query = ctx.supabase
      .from(target.table)
      .select(target.column)
      .eq("account_id", ctx.accountId)
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
