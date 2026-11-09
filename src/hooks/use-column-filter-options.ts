"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ColumnDef, ColumnOption } from "@/components/ui/data-table/data-table-types";
import { errorMessage } from '@/lib/errors/message';

/**
 * The values a table filter dropdown offers.
 *
 * Three sources, in priority order:
 *
 *  1. `column.options` — a master list the screen already has. Free.
 *  2. `valueSource: { kind: "people" }` — the account's staff, for Owner,
 *     Collaborator and Assignee columns. Small, and shared across every column
 *     and screen for the life of the page.
 *  3. `valueSource: { kind: "distinct", … }` — a capped scan of the account's
 *     own rows, for free-text columns like City and Company.
 *
 * Nothing is fetched until the dropdown is actually opened, so a screen pays
 * nothing for filters nobody uses.
 */

/**
 * One in-flight request for the staff list, shared by every caller.
 *
 * Owner and Collaborator on the same screen would otherwise each fetch it, and
 * so would the next screen. Held for the life of the page: staff lists change
 * rarely, and a stale name in a filter dropdown is a far smaller cost than a
 * request per dropdown per screen.
 */
interface Person {
  profileId: string;
  authId: string | null;
  label: string;
}

let peoplePromise: Promise<Person[]> | null = null;

function fetchPeople(): Promise<Person[]> {
  if (peoplePromise) return peoplePromise;

  peoplePromise = (async () => {
    const supabase = createClient();
    // No account filter: `profiles_select` is account-scoped, so this is the
    // caller's own staff. See migration 20261016120000.
    const { data, error } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, email")
      .order("full_name");

    if (error) {
      // Let the next open try again rather than caching a failure.
      peoplePromise = null;
      throw error;
    }

    return (data ?? [])
      .map((p) => ({
        profileId: p.id as string,
        authId: (p.user_id as string | null) ?? null,
        label: (p.full_name as string | null) || (p.email as string | null) || "Unnamed",
      }))
      .filter((p) => Boolean(p.profileId));
  })();

  return peoplePromise;
}

/** Drop the cached staff list — for tests, and after a team change. */
export function resetPeopleOptionsCache(): void {
  peoplePromise = null;
}

/**
 * Answers already fetched for a `distinct` column, and the requests in flight.
 *
 * Opening a filter dropdown took one to three seconds EVERY time, on every
 * table, and the reason was that nothing here was ever reused. Each open fired
 * a fresh /api/table/column-values, and that endpoint has to authenticate the
 * caller, find their account and then scan up to 2,000 rows — four sequential
 * round trips to Mumbai before a single value appears. Closing the dropdown and
 * opening it again paid the whole bill a second time, and so did the next
 * screen asking for the same column.
 *
 * So the answers are held for the life of the page, and concurrent asks for the
 * same column share one request instead of racing. A filter dropdown's value
 * list is a convenience, not a source of truth — a value added by someone else
 * in the last few minutes being missing from the list is a far smaller cost than
 * every open of every filter waiting on the network.
 *
 * `reload` on the table still refetches the ROWS; this only caches the list of
 * values the dropdown offers.
 */
interface DistinctResult {
  values: ColumnOption[];
  truncated: boolean;
}

const DISTINCT_TTL_MS = 5 * 60 * 1000;

const distinctCache = new Map<string, { at: number; result: DistinctResult }>();
const distinctInflight = new Map<string, Promise<DistinctResult>>();

function distinctKey(module: string, column: string, search: string): string {
  return `${module}\u0000${column}\u0000${search}`;
}

async function fetchDistinct(
  module: string,
  column: string,
  search: string,
): Promise<DistinctResult> {
  const key = distinctKey(module, column, search);

  const cached = distinctCache.get(key);
  if (cached && Date.now() - cached.at < DISTINCT_TTL_MS) return cached.result;

  const existing = distinctInflight.get(key);
  if (existing) return existing;

  const request = (async (): Promise<DistinctResult> => {
    const params = new URLSearchParams({ module, column });
    if (search) params.set("q", search);

    const res = await fetch(`/api/table/column-values?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || "Could not load values");

    const result: DistinctResult = {
      values: ((payload.values as string[]) ?? []).map((v) => ({ label: v, value: v })),
      truncated: Boolean(payload.truncated),
    };
    distinctCache.set(key, { at: Date.now(), result });
    return result;
  })();

  distinctInflight.set(key, request);
  try {
    return await request;
  } finally {
    // Whether it resolved or threw: a failure must not be remembered as an
    // in-flight request, or the dropdown never retries.
    distinctInflight.delete(key);
  }
}

/** Forget every cached value list — for tests, and after a bulk import. */
export function resetColumnValuesCache(): void {
  distinctCache.clear();
  distinctInflight.clear();
}

/**
 * How long to wait after the last keystroke before asking the server.
 *
 * Typing "Rajkot" in the dropdown's search box fired six requests, each a
 * 2,000-row scan, and the only one whose answer mattered was the last.
 */
const SEARCH_DEBOUNCE_MS = 300;

export interface ColumnFilterOptions {
  options: ColumnOption[];
  loading: boolean;
  error: string | null;
  /** More values exist than came back, so offer the search box. */
  truncated: boolean;
  search: string;
  setSearch: (value: string) => void;
}

export function useColumnFilterOptions<T>(
  column: ColumnDef<T>,
  enabled: boolean,
): ColumnFilterOptions {
  const [options, setOptions] = useState<ColumnOption[]>(column.options ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState("");
  /**
   * The search term the fetch actually uses, which trails the box by
   * SEARCH_DEBOUNCE_MS. `search` stays immediate so typing never feels laggy.
   */
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  const source = column.valueSource;
  const hasOwnOptions = (column.options?.length ?? 0) > 0;

  /**
   * Only the newest request may write state. Typing in the search box fires
   * several, and without this an earlier, slower response can land last and
   * show results for a search the user has moved on from.
   */
  const requestId = useRef(0);

  useEffect(() => {
    if (hasOwnOptions) {
      setOptions(column.options ?? []);
      return;
    }
    if (!enabled || !source) return;

    const id = ++requestId.current;
    // A cached answer must not flash a spinner — that is most opens after the
    // first, and a spinner on instant data reads as slower than no spinner.
    const cachedHit =
      source.kind !== "people" &&
      distinctCache.has(
        distinctKey(
          (source as { module: string }).module,
          (source as { column: string }).column,
          debouncedSearch.trim(),
        ),
      );
    if (!cachedHit) setLoading(true);
    setError(null);

    const run = async (): Promise<{ values: ColumnOption[]; truncated: boolean }> => {
      if (source.kind === "people") {
        const people = await fetchPeople();
        const needle = debouncedSearch.trim().toLowerCase();
        const matching = needle
          ? people.filter((p) => p.label.toLowerCase().includes(needle))
          : people;
        return {
          // The value carries the id space the column actually stores. A
          // person with no auth id has never signed in, so nothing can be
          // assigned to them under that id — leave them out rather than
          // offering a filter that matches nothing.
          values: matching
            .map((p) => ({
              label: p.label,
              value: source.idSpace === "auth" ? (p.authId ?? "") : p.profileId,
            }))
            .filter((o) => o.value !== ""),
          truncated: false,
        };
      }

      return fetchDistinct(source.module, source.column, debouncedSearch.trim());
    };

    run()
      .then((result) => {
        if (id !== requestId.current) return;
        setOptions(result.values);
        setTruncated(result.truncated);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setOptions([]);
        setError(errorMessage(err, "Could not load values"));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    // `column.options` is read through `hasOwnOptions`; depending on the array
    // itself would re-run on every render, because screens define it inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    hasOwnOptions,
    debouncedSearch,
    source?.kind,
    (source as { idSpace?: string })?.idSpace,
    (source as { module?: string })?.module,
    (source as { column?: string })?.column,
  ]);

  return { options, loading, error, truncated, search, setSearch };
}
