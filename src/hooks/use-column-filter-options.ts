"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ColumnDef, ColumnOption } from "@/components/ui/data-table/data-table-types";

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
    setLoading(true);
    setError(null);

    const run = async (): Promise<{ values: ColumnOption[]; truncated: boolean }> => {
      if (source.kind === "people") {
        const people = await fetchPeople();
        const needle = search.trim().toLowerCase();
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

      const params = new URLSearchParams({ module: source.module, column: source.column });
      if (search.trim()) params.set("q", search.trim());

      const res = await fetch(`/api/table/column-values?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Could not load values");

      return {
        values: ((payload.values as string[]) ?? []).map((v) => ({ label: v, value: v })),
        truncated: Boolean(payload.truncated),
      };
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
        setError(err instanceof Error ? err.message : "Could not load values");
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
    search,
    source?.kind,
    (source as { idSpace?: string })?.idSpace,
    (source as { module?: string })?.module,
    (source as { column?: string })?.column,
  ]);

  return { options, loading, error, truncated, search, setSearch };
}
