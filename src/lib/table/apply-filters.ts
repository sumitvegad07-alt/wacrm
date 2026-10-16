import type { FilterState } from "@/components/ui/data-table/data-table-types";
import type { CustomField } from "@/types";
import { dateFilterToRange } from "@/lib/date-filters";

/**
 * Turning a screen's `filterState` into query conditions.
 *
 * Every list screen used to do this with a `.filter()` over rows it had already
 * downloaded. These helpers do the same thing against the query instead, so the
 * database returns one page of rows that already match.
 *
 * They are deliberately tiny and untyped against supabase's builder: a
 * PostgrestFilterBuilder's type changes with every chained call, and threading
 * that through would add noise without catching anything. Each helper returns
 * whatever it was given.
 */

/** Anything the UI treats as "no filter set". */
export function isEmptyFilterValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

type Builder = {
  ilike: (column: string, pattern: string) => Builder;
  eq: (column: string, value: unknown) => Builder;
  in: (column: string, values: readonly unknown[]) => Builder;
  gte: (column: string, value: unknown) => Builder;
  lte: (column: string, value: unknown) => Builder;
  filter: (column: string, operator: string, value: unknown) => Builder;
  or: (expression: string) => Builder;
  overlaps: (column: string, value: readonly unknown[]) => Builder;
};

/** `contains` text match, matching the old `.toLowerCase().includes(...)`. */
export function applyTextFilter<T>(query: T, column: string, value: unknown): T {
  if (isEmptyFilterValue(value)) return query;
  return (query as Builder).ilike(column, `%${String(value)}%`) as T;
}

/** Multi-select filter, matching the old `(val as string[]).includes(row[col])`. */
export function applyInFilter<T>(query: T, column: string, value: unknown): T {
  if (isEmptyFilterValue(value)) return query;
  const list = Array.isArray(value) ? value : [value];
  return (query as Builder).in(column, list) as T;
}

/**
 * A uuid, and nothing else.
 *
 * `applyInWithFallbackFilter` builds a PostgREST `or(...)` expression by hand,
 * which is a string PostgREST parses — so a value carrying a comma, a bracket
 * or a quote could change the shape of the condition. Every id these filters
 * carry is a uuid, so anything that is not one is dropped rather than escaped.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is string => typeof v === "string" && UUID.test(v));
}

/**
 * Match `column`, falling back to `fallbackColumn` where `column` is null.
 *
 * For Lead Owner: `leads.owner_id` is the assigned owner and may be null, in
 * which case the screen shows the creator from `user_id`. Filtering on
 * `owner_id` alone would miss every lead whose owner was never set — which is
 * most of them on an account that does not assign owners — so the filter has
 * to ask the same question the column answers.
 */
export function applyInWithFallbackFilter<T>(
  query: T,
  column: string,
  fallbackColumn: string,
  value: unknown,
): T {
  if (isEmptyFilterValue(value)) return query;
  const ids = safeIds(value);
  if (ids.length === 0) return query;
  const list = ids.join(",");
  return (query as Builder).or(
    `${column}.in.(${list}),and(${column}.is.null,${fallbackColumn}.in.(${list}))`,
  ) as T;
}

/**
 * Match a row whose array column holds any of the chosen values.
 *
 * For Lead Collaborator: `collaborator_ids` is a `uuid[]`, so "is one of these
 * people a collaborator" is an overlap, not an `in`.
 */
export function applyArrayOverlapFilter<T>(query: T, column: string, value: unknown): T {
  if (isEmptyFilterValue(value)) return query;
  const list = Array.isArray(value) ? value : [value];
  return (query as Builder).overlaps(column, list as readonly unknown[]) as T;
}

/** Date preset or custom range, matching the old `isDateInFilter`. */
export function applyDateFilter<T>(query: T, column: string, value: unknown): T {
  if (isEmptyFilterValue(value)) return query;
  const { gte, lte } = dateFilterToRange(value as string | string[]);
  let next = query as Builder;
  if (gte) next = next.gte(column, gte);
  if (lte) next = next.lte(column, lte);
  return next as T;
}

/**
 * Every active `cf_<field id>` filter, against the row's `custom_values` map.
 *
 * Typed the same way the browser used to: a date field gets a range, a
 * dropdown/radio/multi-select is an exact match against one of the chosen
 * options, anything else is a contains match.
 *
 * Multi-select filters with more than one option selected are the one case
 * PostgREST cannot express as a single condition on a JSON key, so they fall
 * back to an `in` over the map's text value.
 */
export function applyCustomFieldFilters<T>(
  query: T,
  filters: FilterState,
  customFields: CustomField[],
): T {
  let next = query as Builder;

  for (const [columnId, value] of Object.entries(filters ?? {})) {
    if (!columnId.startsWith("cf_") || isEmptyFilterValue(value)) continue;

    const path = `custom_values->>${columnId}`;
    const field = customFields.find((f) => `cf_${f.id}` === columnId);

    if (field?.field_type === "date") {
      const { gte, lte } = dateFilterToRange(value as string | string[]);
      if (gte) next = next.filter(path, "gte", gte);
      if (lte) next = next.filter(path, "lte", lte);
      continue;
    }

    if (
      field?.field_type === "dropdown" ||
      field?.field_type === "radio" ||
      field?.field_type === "multi-select"
    ) {
      next = next.in(path, Array.isArray(value) ? value : [value]);
      continue;
    }

    next = next.ilike(path, `%${String(value)}%`);
  }

  return next as T;
}

/**
 * A stable `useServerTable` dependency for a screen's custom-field definitions.
 *
 * Screens load their `custom_fields` list asynchronously, so passing the array
 * itself as a dependency re-runs the query a second time the moment it arrives
 * — a wasted round-trip on every page load, which is exactly the kind of
 * duplicate work this whole change exists to remove.
 *
 * The definitions only affect the QUERY when a `cf_*` filter is actually
 * active, and then only through that field's type. So this returns an empty
 * string when nothing is filtered, and otherwise a key that changes only when
 * an active filter's field type does.
 */
export function customFieldFilterKey(
  filters: FilterState,
  customFields: CustomField[],
): string {
  const active = Object.keys(filters ?? {}).filter(
    (key) => key.startsWith("cf_") && !isEmptyFilterValue(filters[key]),
  );
  if (active.length === 0) return "";

  return active
    .map((key) => `${key}:${customFields.find((f) => `cf_${f.id}` === key)?.field_type ?? "?"}`)
    .sort()
    .join("|");
}
