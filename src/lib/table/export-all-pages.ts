import type { FilterState } from "@/components/ui/data-table/data-table-types";
import type { ServerTableQuery, SupabaseBrowserClient } from "./server-query";

/**
 * Rows per round-trip. Large enough that an export is a handful of requests,
 * small enough that no single one times out or blows the PostgREST row cap.
 */
export const EXPORT_CHUNK = 1000;

/**
 * Hard ceiling on an export.
 *
 * The CSV is built in browser memory and handed to the user as a download. A
 * file larger than this is not something anyone opens in a spreadsheet — that
 * is a report, and reports have their own screen.
 */
export const EXPORT_MAX_ROWS = 50_000;

/**
 * Walk a server-paged query to the end.
 *
 * Without this, moving a screen to server pagination would quietly reduce
 * Export CSV to "the twenty rows currently on screen". The export must still
 * cover the whole filtered result, so it re-runs the same query chunk by chunk.
 */
export async function fetchAllPages<T>(
  supabase: SupabaseBrowserClient,
  query: ServerTableQuery<T>,
  args: { search: string; filters: FilterState },
  onProgress?: (fetched: number, total: number) => void,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let total = 0;
  let from = 0;

  for (;;) {
    const res = await query(supabase, { ...args, from, to: from + EXPORT_CHUNK - 1 });
    // Fail loudly. Half a spreadsheet looks complete and is worse than none.
    if (res.error) throw new Error(res.error.message);

    const batch = res.data ?? [];
    total = res.count ?? total;
    rows.push(...batch);
    onProgress?.(Math.min(rows.length, total || rows.length), total || rows.length);

    if (rows.length >= EXPORT_MAX_ROWS) {
      return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: true };
    }
    // A short batch means the server has no more rows for this filter.
    if (batch.length < EXPORT_CHUNK) return { rows, truncated: false };
    if (total && rows.length >= total) return { rows, truncated: false };

    from += EXPORT_CHUNK;
  }
}
