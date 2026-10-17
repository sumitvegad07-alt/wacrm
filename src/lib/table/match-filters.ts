import type { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { isDateInFilter } from "@/lib/date-filters";
import { isEmptyFilterValue } from "./apply-filters";

/**
 * Does this row pass every active column filter?
 *
 * For screens that hold their rows in memory. Server-paged screens push the
 * same filter state into the query instead — see `apply-filters.ts`.
 *
 * Driven by the column definitions rather than by a hand-written chain of
 * `if (colId === 'x')` branches. Those chains were how a filter came to be
 * offered but never applied: a column whose branch nobody wrote was simply
 * never filtered, and nothing said so. Harmless while filters hid behind a
 * click on the heading; a visibly dead control once the filter row became
 * permanent. Here a column with a filter type is filtered, full stop.
 *
 * A filter whose column has gone, or has since been made unfilterable, is
 * ignored rather than treated as matching nothing — a saved view outlives the
 * release that defined its columns, and it must not silently empty the table.
 */
export function matchesColumnFilters<T>(
  row: T,
  filterState: FilterState,
  columns: ColumnDef<T>[],
): boolean {
  for (const [columnId, filterValue] of Object.entries(filterState ?? {})) {
    if (isEmptyFilterValue(filterValue)) continue;

    const column = columns.find((c) => c.id === columnId);
    if (!column?.type) continue;

    const actual = column.filterValue ? column.filterValue(row) : (row as Record<string, unknown>)[columnId];

    if (column.type === "date") {
      if (!isDateInFilter(actual as string | Date | null | undefined, filterValue as string | string[])) {
        return false;
      }
      continue;
    }

    if (column.type === "range") {
      // Either end may be blank — "over 10,000" has no upper bound — and zero
      // is a real bound, so each end is tested for being a number.
      const [rawMin, rawMax] = Array.isArray(filterValue) ? filterValue : [filterValue, undefined];
      const amount = Number(actual);
      if (!Number.isFinite(amount)) return false;
      const min = Number(rawMin);
      const max = Number(rawMax);
      if (rawMin !== "" && rawMin != null && Number.isFinite(min) && amount < min) return false;
      if (rawMax !== "" && rawMax != null && Number.isFinite(max) && amount > max) return false;
      continue;
    }

    if (column.type === "select") {
      const wanted = (Array.isArray(filterValue) ? filterValue : [filterValue]).map(String);
      // A row may itself hold several values — tags, collaborators — in which
      // case it matches when any one of them was chosen.
      const held = (Array.isArray(actual) ? actual : [actual])
        .filter((v) => v !== null && v !== undefined && v !== "")
        .map(String);
      if (!held.some((v) => wanted.includes(v))) return false;
      continue;
    }

    // text: a case-insensitive contains, over the value as it reads. Numbers
    // are compared as text so a quantity or a code can still be searched.
    if (actual === null || actual === undefined || actual === "") return false;
    const haystack = (Array.isArray(actual) ? actual.join(" ") : String(actual)).toLowerCase();
    if (!haystack.includes(String(filterValue).toLowerCase())) return false;
  }

  return true;
}
