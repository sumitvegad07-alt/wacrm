"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TableViewApi } from "@/hooks/use-table-view";
import { pageRange, type ServerTableQuery } from "@/lib/table/server-query";

/**
 * One page of rows from the server, instead of the whole table in the browser.
 *
 * Every list screen used to `.select('*')` with no limit and then search,
 * filter and paginate in JavaScript. That is fine at 200 rows and fatal at
 * 200,000 — see docs/engineering/WEB_PERFORMANCE_RESEARCH_2026-10-12.md.
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
  /** Hold off querying until the screen knows its account. */
  enabled?: boolean;
  /** Extra values that should re-run the query when they change. */
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
   * Only the newest request may write state. Without this, typing fast lets an
   * earlier, slower response land last, and the screen shows results for a
   * search the user has already moved on from.
   */
  const requestId = useRef(0);

  /**
   * Hold the latest `buildQuery` without making it a dependency: screens define
   * it inline, so it is a new function identity on every render and would
   * re-fetch forever.
   */
  const queryRef = useRef(buildQuery);
  queryRef.current = buildQuery;

  const setSearch = useCallback((next: string) => setSearchRaw(next), []);
  const setPage = useCallback((next: number) => setPageRaw(Math.max(1, next)), []);

  /**
   * Debounce the text, and send every change back to page 1 — results for a new
   * search have nothing to do with the page number of the old one.
   *
   * `skipFirst` keeps the initial mount from counting as a change, which would
   * otherwise fire a second query before the first had returned.
   */
  const firstSearchRun = useRef(true);
  useEffect(() => {
    if (firstSearchRun.current) {
      firstSearchRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPageRaw(1);
    }, searchDebounceMs);
    return () => clearTimeout(timer);
  }, [search, searchDebounceMs]);

  // A filter change is the same story: back to page 1.
  const filterKey = useMemo(() => JSON.stringify(filterState ?? {}), [filterState]);
  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    setPageRaw(1);
  }, [filterKey]);

  const [reloadToken, setReloadToken] = useState(0);
  /** Re-run the current query — call after a save or delete on this screen. */
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
    // filterState is covered by filterKey; buildQuery is held in a ref on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, page, pageSize, debouncedSearch, filterKey, reloadToken, ...deps]);

  /**
   * Deleting the last row of the last page must not strand the user on an empty
   * page with no way back.
   */
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
