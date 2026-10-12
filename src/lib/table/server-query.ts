import type { FilterState } from "@/components/ui/data-table/data-table-types";
import type { createClient } from "@/lib/supabase/client";

/**
 * Shared shapes for server-paged tables.
 *
 * Every list screen used to run `.select('*')` with no limit and then search,
 * filter and paginate in JavaScript. That is fine at 200 rows and fatal at
 * 200,000 — see docs/engineering/WEB_PERFORMANCE_RESEARCH_2026-10-12.md.
 */

export type SupabaseBrowserClient = ReturnType<typeof createClient>;

/** What `useServerTable` hands a screen's query for one page of rows. */
export type ServerTableArgs = {
  /** Debounced and trimmed. An empty string means "no search". */
  search: string;
  /** The screen's filter state, straight from `useTableView`. */
  filters: FilterState;
  /** Inclusive row offsets, ready for PostgREST `.range(from, to)`. */
  from: number;
  to: number;
};

export type ServerTableResult<T> = {
  data: T[] | null;
  /** Row count across ALL pages. Requires `{ count: "exact" }` on the select. */
  count: number | null;
  error: { message: string } | null;
};

/**
 * A screen's query.
 *
 * Typed on the RESULT rather than on `PostgrestFilterBuilder`: a real supabase
 * chain is thenable so it satisfies this, and a test can pass a plain async
 * function without building a fake query builder.
 */
export type ServerTableQuery<T> = (
  supabase: SupabaseBrowserClient,
  args: ServerTableArgs,
) => PromiseLike<ServerTableResult<T>>;

/** 1-based page + size to the inclusive offsets PostgREST wants. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = Math.max(0, (page - 1) * pageSize);
  return { from, to: from + pageSize - 1 };
}
