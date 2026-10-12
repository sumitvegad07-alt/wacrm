# Server-Side Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: Stages 1–3 COMPLETE** (2026-10-12). All eleven growing list screens
page on the server; setup data is capped; the deals board is capped pending
per-stage paging. Stage 4 (SQL aggregates for the dashboard and the
report/stock/attendance screens) is still open — that is what makes today's
small screens faster, as opposed to stopping them breaking at scale.

**Goal:** Stop every list screen downloading its whole table, so the app stays
fast when an account holds hundreds of thousands of rows instead of hundreds.

**Architecture:** Pages stay client components. One shared `useServerTable`
hook owns page / page-size / debounced search / filters, builds a PostgREST
query through a per-page `buildQuery` callback, asks for one page with
`.range()` and `{ count: 'exact' }`, and hands `DataTable` the
`serverPagination` prop it already supports. Free-text search moves into the
database against a maintained `search_text` column with a `pg_trgm` GIN index,
so searching a joined customer or salesman name is one indexed `ilike` instead
of a full download plus a JavaScript scan.

**Tech Stack:** Next.js 16 (App Router, client components), React 19,
supabase-js v2 / PostgREST, Postgres 15 + `pg_trgm`, Tailwind v4, vitest,
Playwright.

**Spec:** `docs/engineering/WEB_PERFORMANCE_RESEARCH_2026-10-12.md`

## Global Constraints

- **Every change is global.** Fixes apply to all tenants unless the founder
  says otherwise.
- **Push straight to `main`.** No branches, no PRs — Vercel deploys `main`.
- **Not done until pushed and deployed**, and the commit hash is reported.
- **Dates and reports are account-local.** Any date filter that moves into SQL
  must convert `AT TIME ZONE` the account's timezone. Never `toISOString()`.
- **RLS stays authoritative.** Moving a filter into the query must never be the
  only thing stopping a user seeing another user's rows. Row visibility is the
  database's job and must keep working with the filter removed.
- **No feature may silently disappear.** CSV export, select-all and
  custom-field search all exist today. Each either keeps working or gets an
  explicit, agreed replacement in its own task.
- **Reference tables are out of scope** (see "What is deliberately not changed").
- Postgres identifiers: migrations live in `supabase/migrations/`, numbered
  continuing the existing sequence.

---

## Why these pages and not others

Live row counts from prod (`pg_stat_user_tables`, 2026-10-12). This is the
priority order — tables that already have thousands of rows and grow with every
working day come first.

| Table | Rows today | Grows with |
|---|---|---|
| site_visits | 24,308 | every visit, every rep, every day |
| location_pings | 13,785 | every GPS ping — fastest growing table we have |
| tracking_sessions | 5,974 | one per punch-in |
| orders | 5,874 | every order |
| order_dispatches | 5,312 | every dispatch |
| expenses | 3,267 | every expense claim |
| payments | 2,326 | every payment |
| leads | 1,574 | every lead |
| tasks | 1,438 | every task |
| contacts | 1,159 | every customer |
| deals | 571 | every deal |
| quotations | 467 | every quotation |
| products | 256 | catalogue size — grows slowly |
| profiles | 50 | headcount |
| product_units / product_categories / employee_roles | 12–30 | setup data |

### The four shapes of screen

The 26 screens are not 26 different problems. They are four:

- **Family A — reference tables that do not grow** (catalog/categories,
  catalog/units, team/roles, announcements, broadcasts). 2–30 rows. Server
  paging here adds moving parts and buys nothing.
- **Family B — big tables searched only on their own columns** (leads,
  products, expenses, team/employees). Straight migration.
- **Family C — big tables searched across a joined name** (contacts, orders,
  payments, quotations, dispatches, pending-dispatch, tasks, pipelines/deals,
  visits). These are the ones that need `search_text`, because PostgREST cannot
  express "customer name OR my own order number" in one `.or()`.
- **Family D — screens that are not row lists at all** (reports/payments,
  stock, location-tracking health, all-locations, attendance). They read whole
  tables to compute totals. Pagination is the wrong tool; they need SQL
  aggregates. Stage 4.

---

## What is deliberately not changed

**Family A keeps client-side paging.** `product_categories` (27 rows),
`product_units` (30), `employee_roles` (12), `tenant_announcements` (2),
`broadcasts` (0). These are setup data with a natural ceiling in the dozens.
Downloading 30 rows is cheaper than a round-trip per page.

They still get one safety change in Task 4: a `.limit(500)` cap and a visible
notice if it is hit, so a table nobody expected to grow cannot silently become
a 50 MB download.

**Sorting stays as-is.** `ColumnDef` has a `sortable` flag but
`data-table-header.tsx` implements no sorting — no screen sorts by column
today. Each query keeps its current fixed `.order()`. Adding sortable columns
is a separate piece of work; doing it here would mean every task carried an
untested feature.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `src/hooks/use-server-table.ts` | The hook: paging, debounced search, filter state, stale-response guard, count. The only place this logic exists. |
| `src/hooks/use-server-table.test.ts` | Its tests. |
| `src/lib/table/server-query.ts` | `ServerTableQuery` type + `applyRange` helper shared by the hook and the exporter. |
| `src/lib/table/export-all-pages.ts` | Chunked export that walks every page of a server query so Export CSV keeps working. |
| `src/lib/table/export-all-pages.test.ts` | Its tests. |
| `supabase/migrations/1NN_search_text_<table>.sql` | One per Family C table: column, backfill, trigger, GIN index. |

**Modified**

| File | Change |
|---|---|
| `src/components/ui/data-table/data-table.tsx` | Keep Export CSV in server mode, wired to the chunked exporter. Label select-all honestly. |
| `src/hooks/use-data-export.ts` | Accept an async row supplier, not just an array. |
| 24 page files | Swap the download-everything `useEffect` for `useServerTable`. |

---

## The page migration recipe

Every Family B and C task performs exactly these edits. The code below is the
full recipe; each task states only its own `buildQuery`, columns searched, and
filters, because that is genuinely all that differs between them.

**Before** (what every page looks like today):

```tsx
const [rows, setRows] = useState<Row[]>([]);
const [loading, setLoading] = useState(true);
const [search, setSearch] = useState("");

useEffect(() => { fetchData(); }, [accountId]);

async function fetchData() {
  const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
  setRows(data ?? []);
  setLoading(false);
}

const filtered = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

<DataTable data={filtered} tableView={tableView} isLoading={loading} … />
```

**After:**

```tsx
const table = useServerTable<Row>({
  tableView,
  enabled: Boolean(accountId),
  deps: [accountId],
  buildQuery: (supabase, { search, filters, from, to }) => {
    let q = supabase
      .from("leads")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (search) q = q.ilike("search_text", `%${search.toLowerCase()}%`);
    if (filters.status) q = q.eq("status", filters.status);
    return q;
  },
});

<DataTable
  data={table.rows}
  tableView={tableView}
  isLoading={table.loading}
  serverPagination={table.serverPagination}
  …
/>
```

and the page's own search box becomes `value={table.search}
onChange={e => table.setSearch(e.target.value)}`.

**Deleted in each task:** the `rows`/`loading` state, the `fetchData`
`useEffect`, and the `.filter(...)` chain. Anything that used `rows` for a
count or a summary must move to `table.total` or to its own query — grep the
file for the old state variable before finishing.

---

# Stage 1 — Foundation

### Task 1: `useServerTable` hook

**Files:**
- Create: `src/lib/table/server-query.ts`
- Create: `src/hooks/use-server-table.ts`
- Test: `src/hooks/use-server-table.test.ts`

**Interfaces:**
- Consumes: `TableViewApi` from `src/hooks/use-table-view.ts` (gives
  `filterState`, `pageSize`, `setPageSize`, `storageKey`).
- Produces:
  ```ts
  export type ServerTableArgs = {
    search: string;
    filters: FilterState;
    from: number;
    to: number;
  };
  export type ServerTableQuery<T> = (
    supabase: SupabaseClient,
    args: ServerTableArgs,
  ) => PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }>;

  export function useServerTable<T>(opts: {
    tableView: TableViewApi;
    buildQuery: ServerTableQuery<T>;
    enabled?: boolean;
    deps?: unknown[];
    searchDebounceMs?: number;   // default 300
  }): {
    rows: T[];
    total: number;
    loading: boolean;
    error: string | null;
    search: string;
    setSearch: (s: string) => void;
    page: number;
    setPage: (n: number) => void;
    reload: () => void;
    serverPagination: {
      total: number; page: number; pageSize: number;
      onPageChange: (p: number) => void;
      onPageSizeChange: (n: number) => void;
    };
  };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/hooks/use-server-table.test.ts
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useServerTable } from "./use-server-table";

function fakeTableView(overrides = {}) {
  return { storageKey: "k", filterState: {}, pageSize: 20, setPageSize: vi.fn(), ...overrides } as any;
}

describe("useServerTable", () => {
  it("asks for the first page and reports the total", async () => {
    const buildQuery = vi.fn(async () => ({ data: [{ id: "a" }], count: 137, error: null }));
    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([{ id: "a" }]);
    expect(result.current.total).toBe(137);
    expect(buildQuery.mock.calls[0][1]).toMatchObject({ from: 0, to: 19, search: "" });
  });

  it("debounces search and goes back to page 1", async () => {
    vi.useFakeTimers();
    const buildQuery = vi.fn(async () => ({ data: [], count: 0, error: null }));
    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));

    act(() => { result.current.setPage(3); });
    act(() => { result.current.setSearch("ab"); });
    act(() => { result.current.setSearch("abc"); });
    await act(async () => { vi.advanceTimersByTime(299); });
    const before = buildQuery.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(2); });

    expect(buildQuery.mock.calls.length).toBe(before + 1);
    const args = buildQuery.mock.calls.at(-1)![1];
    expect(args.search).toBe("abc");
    expect(args.from).toBe(0); // page reset
    vi.useRealTimers();
  });

  it("ignores a slow response that a newer one has already overtaken", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const buildQuery = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(async () => ({ data: [{ id: "new" }], count: 1, error: null }));

    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));
    act(() => { result.current.setPage(2); });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: "new" }]));

    await act(async () => { resolveFirst({ data: [{ id: "stale" }], count: 99, error: null }); });
    expect(result.current.rows).toEqual([{ id: "new" }]);
    expect(result.current.total).toBe(1);
  });

  it("does not query at all while disabled", async () => {
    const buildQuery = vi.fn(async () => ({ data: [], count: 0, error: null }));
    renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery, enabled: false }));
    await new Promise((r) => setTimeout(r, 20));
    expect(buildQuery).not.toHaveBeenCalled();
  });

  it("clamps to the last page when the total shrinks under it", async () => {
    const buildQuery = vi.fn(async () => ({ data: [], count: 5, error: null }));
    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.setPage(9) });
    await waitFor(() => expect(result.current.page).toBe(1));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/hooks/use-server-table.test.ts`
Expected: FAIL — `Failed to resolve import "./use-server-table"`.

- [ ] **Step 3: Write `src/lib/table/server-query.ts`**

```ts
import type { FilterState } from "@/components/ui/data-table/data-table-types";

/** What the hook hands a page's buildQuery for one page of rows. */
export type ServerTableArgs = {
  /** Debounced, trimmed. Empty string means "no search". */
  search: string;
  /** The screen's filter state, straight from useTableView. */
  filters: FilterState;
  /** Inclusive row offsets for `.range(from, to)`. */
  from: number;
  to: number;
};

/**
 * A page's query. Deliberately typed on the RESULT rather than on
 * PostgrestFilterBuilder: the builder is thenable, so a real supabase chain
 * satisfies this, and a test can pass a plain async function.
 */
export type ServerTableResult<T> = {
  data: T[] | null;
  count: number | null;
  error: { message: string } | null;
};

export type ServerTableQuery<T> = (
  supabase: ReturnType<typeof import("@/lib/supabase/client").createClient>,
  args: ServerTableArgs,
) => PromiseLike<ServerTableResult<T>>;

/** 1-based page + size -> inclusive offsets for PostgREST `.range()`. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = Math.max(0, (page - 1) * pageSize);
  return { from, to: from + pageSize - 1 };
}
```

- [ ] **Step 4: Write `src/hooks/use-server-table.ts`**

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TableViewApi } from "@/hooks/use-table-view";
import { pageRange, type ServerTableQuery } from "@/lib/table/server-query";

/**
 * One page of rows from the server, instead of the whole table in the browser.
 *
 * Every list screen used to run `.select('*')` with no limit and then filter,
 * search and paginate the result in JavaScript. That is fine at 200 rows and
 * fatal at 200,000 — see docs/engineering/WEB_PERFORMANCE_RESEARCH_2026-10-12.md.
 *
 * The hook owns the paging and search state; the screen owns the query. It
 * deliberately does NOT cache: these are per-user, per-account, RLS-filtered
 * rows that change constantly, and a stale list of orders is worse than a
 * round-trip.
 */
export function useServerTable<T>({
  tableView,
  buildQuery,
  enabled = true,
  deps = [],
  searchDebounceMs = 300,
}: {
  tableView: TableViewApi;
  buildQuery: ServerTableQuery<T>;
  enabled?: boolean;
  deps?: unknown[];
  searchDebounceMs?: number;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [page, setPageRaw] = useState(1);

  const [search, setSearchRaw] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { pageSize, setPageSize, filterState } = tableView;

  /**
   * Only the newest request may write state. Without this, typing fast makes
   * an earlier, slower response land last and the screen shows results for a
   * search the user has already moved on from.
   */
  const requestId = useRef(0);

  // Keep the latest buildQuery without making it a dependency - pages define
  // it inline, so it is a new function on every render and would re-fetch
  // forever.
  const queryRef = useRef(buildQuery);
  queryRef.current = buildQuery;

  const setSearch = useCallback((next: string) => {
    setSearchRaw(next);
  }, []);

  const setPage = useCallback((next: number) => {
    setPageRaw(Math.max(1, next));
  }, []);

  // Debounce the text, and send every change back to page 1: results for a new
  // search have nothing to do with the page number of the old one.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPageRaw(1);
    }, searchDebounceMs);
    return () => clearTimeout(t);
  }, [search, searchDebounceMs]);

  // A filter change is the same story.
  const filterKey = useMemo(() => JSON.stringify(filterState ?? {}), [filterState]);
  useEffect(() => {
    setPageRaw(1);
  }, [filterKey]);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      const supabase = createClient();
      const { from, to } = pageRange(page, pageSize);
      try {
        const res = await queryRef.current(supabase, {
          search: debouncedSearch,
          filters: filterState ?? {},
          from,
          to,
        });
        if (cancelled || id !== requestId.current) return;
        if (res.error) {
          setError(res.error.message);
          setRows([]);
          setTotal(0);
        } else {
          setError(null);
          setRows(res.data ?? []);
          setTotal(res.count ?? 0);
        }
      } catch (err) {
        if (cancelled || id !== requestId.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setRows([]);
        setTotal(0);
      } finally {
        if (!cancelled && id === requestId.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, page, pageSize, debouncedSearch, filterKey, reloadToken, ...deps]);

  // Deleting the last row of the last page must not strand the user on an
  // empty page with no way back.
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > lastPage) setPageRaw(lastPage);
  }, [total, pageSize, page]);

  const serverPagination = useMemo(
    () => ({
      total,
      page,
      pageSize,
      onPageChange: setPage,
      onPageSizeChange: (n: number) => {
        setPageSize(n);
        setPageRaw(1);
      },
    }),
    [total, page, pageSize, setPage, setPageSize],
  );

  return {
    rows,
    total,
    loading,
    error,
    search,
    setSearch,
    page,
    setPage,
    reload,
    serverPagination,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/hooks/use-server-table.test.ts`
Expected: PASS, 5 tests.

If `renderHook` is missing, add it: `npm i -D @testing-library/react` and
check `vitest.config.ts` sets `environment: "jsdom"` for this path.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/hooks/use-server-table.ts src/hooks/use-server-table.test.ts src/lib/table/server-query.ts
git commit -m "feat(table): useServerTable - one page of rows from the server"
git push origin main
```

---

### Task 2: Export CSV must survive server paging

Today `DataTable` hides Export CSV whenever `serverPagination` is set, because
it could only export the rows on screen. Migrating 24 screens would therefore
quietly remove export from all of them. It has to walk the query instead.

**Files:**
- Create: `src/lib/table/export-all-pages.ts`
- Test: `src/lib/table/export-all-pages.test.ts`
- Modify: `src/components/ui/data-table/data-table.tsx` (the `serverPagination`
  branch that drops the Export button)
- Modify: `src/hooks/use-data-export.ts`

**Interfaces:**
- Consumes: `ServerTableQuery<T>`, `pageRange` from Task 1.
- Produces:
  ```ts
  export const EXPORT_CHUNK = 1000;
  export const EXPORT_MAX_ROWS = 50_000;
  export async function fetchAllPages<T>(
    supabase: Parameters<ServerTableQuery<T>>[0],
    query: ServerTableQuery<T>,
    args: { search: string; filters: FilterState },
    onProgress?: (fetched: number, total: number) => void,
  ): Promise<{ rows: T[]; truncated: boolean }>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, EXPORT_CHUNK, EXPORT_MAX_ROWS } from "./export-all-pages";

const supa = {} as never;

describe("fetchAllPages", () => {
  it("walks every chunk until it has the whole result", async () => {
    const total = 2500;
    const query = vi.fn(async (_s: never, { from, to }: { from: number; to: number }) => ({
      data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ id: from + i })),
      count: total,
      error: null,
    }));

    const { rows, truncated } = await fetchAllPages(supa, query as never, { search: "", filters: {} });

    expect(rows).toHaveLength(total);
    expect(truncated).toBe(false);
    expect(query).toHaveBeenCalledTimes(Math.ceil(total / EXPORT_CHUNK));
  });

  it("stops at the safety cap and says it was truncated", async () => {
    const total = EXPORT_MAX_ROWS + 5000;
    const query = vi.fn(async (_s: never, { from, to }: { from: number; to: number }) => ({
      data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })),
      count: total,
      error: null,
    }));

    const { rows, truncated } = await fetchAllPages(supa, query as never, { search: "", filters: {} });

    expect(rows).toHaveLength(EXPORT_MAX_ROWS);
    expect(truncated).toBe(true);
  });

  it("throws on a failed chunk rather than exporting a half file", async () => {
    const query = vi.fn(async () => ({ data: null, count: 10, error: { message: "boom" } }));
    await expect(fetchAllPages(supa, query as never, { search: "", filters: {} })).rejects.toThrow("boom");
  });

  it("reports progress", async () => {
    const query = vi.fn(async (_s: never, { from, to }: { from: number; to: number }) => ({
      data: Array.from({ length: Math.max(0, Math.min(to, 1499) - from + 1) }, (_, i) => ({ id: from + i })),
      count: 1500,
      error: null,
    }));
    const onProgress = vi.fn();
    await fetchAllPages(supa, query as never, { search: "", filters: {} }, onProgress);
    expect(onProgress).toHaveBeenCalledWith(1000, 1500);
    expect(onProgress).toHaveBeenCalledWith(1500, 1500);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/table/export-all-pages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { FilterState } from "@/components/ui/data-table/data-table-types";
import type { ServerTableQuery } from "./server-query";

/** Rows per round-trip. Large enough to be few trips, small enough not to time out. */
export const EXPORT_CHUNK = 1000;

/**
 * Hard ceiling. An export is a browser-memory operation and a CSV of more than
 * this is not something anyone opens in a spreadsheet - it is a report, and
 * reports have their own screen.
 */
export const EXPORT_MAX_ROWS = 50_000;

/**
 * Walk a server-paged query to the end so Export CSV still exports the whole
 * filtered result, not just the page on screen.
 */
export async function fetchAllPages<T>(
  supabase: Parameters<ServerTableQuery<T>>[0],
  query: ServerTableQuery<T>,
  args: { search: string; filters: FilterState },
  onProgress?: (fetched: number, total: number) => void,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let total = 0;
  let from = 0;

  for (;;) {
    const res = await query(supabase, { ...args, from, to: from + EXPORT_CHUNK - 1 });
    if (res.error) throw new Error(res.error.message);

    const batch = res.data ?? [];
    total = res.count ?? total;
    rows.push(...batch);
    onProgress?.(Math.min(rows.length, total || rows.length), total || rows.length);

    if (rows.length >= EXPORT_MAX_ROWS) {
      return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated: true };
    }
    if (batch.length < EXPORT_CHUNK) return { rows, truncated: false };
    if (total && rows.length >= total) return { rows, truncated: false };
    from += EXPORT_CHUNK;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/table/export-all-pages.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into DataTable**

In `src/components/ui/data-table/data-table.tsx`, extend the
`serverPagination` prop with an optional exporter and stop hiding the button:

```ts
  serverPagination?: {
    total: number;
    page: number;
    pageSize: number;
    pageSizeOptions?: number[];
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    /**
     * Fetches every row of the current search/filter for Export CSV. Omit and
     * the button exports only the page on screen, which is almost never what
     * the user means - supply it on any screen that offers export.
     */
    exportAll?: () => Promise<{ rows: unknown[]; truncated: boolean }>;
  };
```

Replace the branch that drops Export in server mode with: call
`serverPagination.exportAll()` when present, show a toast while it runs, and
warn when `truncated` is true ("Exported the first 50,000 rows. Narrow the
filter to export the rest."). Fall back to the on-screen rows when `exportAll`
is absent.

- [ ] **Step 6: Verify nothing else broke, then commit**

```bash
npx vitest run
npx tsc --noEmit -p tsconfig.json
git add src/lib/table src/components/ui/data-table/data-table.tsx src/hooks/use-data-export.ts
git commit -m "feat(table): Export CSV walks every page in server mode"
git push origin main
```

---

### Task 3: `search_text` + trigram index (Family C tables)

Family C screens search a joined name — "customer", "salesman", "assignee".
PostgREST cannot express "my own order number OR the customer's company name"
in one `.or()`, and `ilike '%x%'` cannot use a normal index anyway. Both are
solved by one maintained column per table.

Do **orders** first as the reference migration, then repeat the identical shape
for `contacts`, `payments`, `quotations`, `order_dispatches`, `tasks`, `deals`,
`site_visits`.

**Files:**
- Create: `supabase/migrations/1NN_search_text_orders.sql`

- [ ] **Step 1: Confirm pg_trgm is available**

```sql
select * from pg_available_extensions where name = 'pg_trgm';
```

- [ ] **Step 2: Write the migration**

```sql
-- Free-text search for the Orders list.
--
-- The screen searches order_number, the customer's company/name and the
-- salesman's name. Those last two live in other tables, and PostgREST cannot
-- OR across an embedded resource - which is why the page used to download
-- every order and search them in JavaScript.
--
-- One lowercase haystack on the row itself, kept current by a trigger, plus a
-- trigram index so `ilike '%x%'` is an index scan rather than a seq scan.
create extension if not exists pg_trgm;

alter table public.orders add column if not exists search_text text;

create or replace function public.orders_refresh_search_text()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer text;
  v_salesman text;
begin
  select lower(coalesce(c.company, '') || ' ' || coalesce(c.name, ''))
    into v_customer
    from public.contacts c where c.id = new.contact_id;

  select lower(coalesce(p.full_name, ''))
    into v_salesman
    from public.profiles p where p.id = new.salesman_id;

  new.search_text := trim(regexp_replace(
    lower(coalesce(new.order_number, '') || ' ' ||
          coalesce(v_customer, '') || ' ' ||
          coalesce(v_salesman, '')),
    '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists orders_search_text on public.orders;
create trigger orders_search_text
  before insert or update of order_number, contact_id, salesman_id
  on public.orders
  for each row execute function public.orders_refresh_search_text();

-- Backfill in batches so the migration does not hold one long lock.
update public.orders set order_number = order_number where search_text is null;

create index if not exists orders_search_text_trgm
  on public.orders using gin (search_text gin_trgm_ops);

create index if not exists orders_account_created_idx
  on public.orders (account_id, created_at desc);
```

- [ ] **Step 3: Apply it and prove the index is used**

```sql
explain analyze
select id from public.orders
where account_id = '<a real account>' and search_text ilike '%sharma%'
order by created_at desc limit 20;
```
Expected: a Bitmap Index Scan on `orders_search_text_trgm`, not a Seq Scan.

- [ ] **Step 4: Prove the trigger tracks a renamed customer**

```sql
-- rename a contact, then confirm its orders' search_text follows
```
**Known limitation to decide on, not to skip:** the trigger fires on the
*order*, so renaming a customer does not rewrite the orders already written.
Either add an `AFTER UPDATE ON contacts` trigger that refreshes its orders'
`search_text`, or accept that search uses the name as at order time. Pick one
explicitly and write the choice into the migration comment.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1NN_search_text_orders.sql
git commit -m "feat(db): search_text + trigram index on orders"
git push origin main
```

- [ ] **Step 6: Repeat for the other Family C tables**

Same shape, different haystack:

| Table | search_text is built from |
|---|---|
| contacts | name, company, email, phone, territory name |
| payments | payment_number, customer company/name, payment type name |
| quotations | quotation_number, contact name, lead name, creator name |
| order_dispatches | dispatch_number, invoice_no, order number, customer name |
| tasks | title, description, assignee name, linked contact/deal name |
| deals | title, contact name, assignee name |
| site_visits | customer name, visited-by name |

---

# Stage 2 — Family B pages (own-column search)

Each task is one page, follows **the page migration recipe** above, and ends
with its own commit and a manual check of: first page loads, search finds a row
on page 5, filters reset to page 1, Export CSV exports more than one page,
the row count in the footer matches the real total.

### Task 4: Reference-table safety cap (Family A)

**Files:** `catalog/categories/page.tsx`, `catalog/units/page.tsx`,
`team/roles/page.tsx`, `announcements/page.tsx`, `broadcasts/page.tsx`

- [ ] Add `.limit(500)` to each query and render a one-line notice when
      `data.length === 500`: "Showing the first 500. Contact support if you
      need more." These tables hold 0–30 rows; this is a tripwire, not a feature.
- [ ] Commit: `fix(tables): cap reference-table queries at 500 rows`

### Task 5: Leads (1,574 rows)

- [ ] `buildQuery`: `from("leads").select("*", { count: "exact" })`,
      `.order("created_at", { ascending: false })`, `.range(from, to)`;
      search → `.ilike("search_text", …)` (own columns: name, company, phone,
      email); filters → `.eq("status", …)`, `.eq("source", …)`.
- [ ] **Custom-field search is lost by this change.** `lead_custom_values` is a
      child table and the page searched it in JS. Either fold custom values
      into `search_text` with an `AFTER INSERT/UPDATE/DELETE ON
      lead_custom_values` trigger, or agree with the founder that lead search
      covers the standard fields only. Do not ship this task until that is
      decided.
- [ ] Commit: `perf(leads): server-side paging, search and filters`

### Task 6: Products (256 rows)
- [ ] `buildQuery`: `from("products").select("*, category_rel:product_categories(name), unit_rel:product_units(name, short_name)", { count: "exact" })`; search covers name, sku, category name → needs `search_text`.
- [ ] Commit: `perf(products): server-side paging, search and filters`

### Task 7: Expenses (3,267 rows)
- [ ] `buildQuery`: `from("expenses").select("*, expense_type:expense_types(*), employee:profiles!expenses_employee_id_fkey(*)", { count: "exact" })`; search covers employee name and expense type name → `search_text`; filters → status, date range (account-local, via `AT TIME ZONE`).
- [ ] Commit: `perf(expenses): server-side paging, search and filters`

### Task 8: Team / Employees (50 rows, but joins four tables)
- [ ] `buildQuery` on `profiles`; search → `.or("full_name.ilike.*q*,email.ilike.*q*,employee_code.ilike.*q*")` — all own columns, so no `search_text` needed here.
- [ ] Commit: `perf(employees): server-side paging and search`

# Stage 3 — Family C pages (joined-name search)

Each depends on its table's Task 3 migration being applied first.

### Task 9: Orders (5,874 rows) — do this one first, it is the reference
### Task 10: Contacts (1,159 rows)
### Task 11: Payments (2,326 rows)
### Task 12: Quotations (467 rows)
### Task 13: Dispatches (5,312 rows)
### Task 14: Pending Dispatch (orders subset)
### Task 15: Tasks (1,438 rows)
### Task 16: Pipelines / Deals (571 rows)
### Task 17: Location Tracking → Visits (24,308 rows — biggest list in the app)

Each: follow the recipe, `search` → `.ilike("search_text", …)`, filters → real
columns, keep the existing `.order()`, commit and push per page.

# Stage 4 — Family D screens (aggregate, not paginate)

These do not list rows; they read whole tables to produce totals, so paging
them would be the wrong fix. Each needs a Postgres function that returns the
finished numbers.

### Task 18: `reports/payments` — outstanding/ageing per customer
### Task 19: `stock` — closing stock per product
### Task 20: `location-tracking/health`, `all-locations`, `attendance`
### Task 21: Dashboard KPI aggregates — replace the download-and-sum functions in `src/lib/dashboard/payment-queries.ts` and its siblings

**These produce money and attendance figures.** Every RPC must be checked
against the current JavaScript result on a real account before it replaces it.
Write that comparison down in the task's commit message.

---

## Self-review notes

- **Spec coverage:** the research doc lists three open problems — unbounded
  list queries (Stages 1–3), dashboard sums in JS (Task 21), and no instant
  navigation feedback. The last is NOT in this plan: it is a `loading.tsx` per
  route group, unrelated to data shape, and belongs in its own small change.
- **Known gaps, written down rather than hidden:** custom-field search
  (Task 5), select-all meaning "this page" once paging is server-side, and the
  renamed-customer case in Task 3 Step 4. Each has a decision point.
- **Honest expectation:** Stages 1–3 remove the cliff — the app stops getting
  slower as a table grows. They do not make today's 1,000-row screens
  dramatically faster; Stage 4 and the search indexes are what make it fast.
