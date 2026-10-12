import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared helpers for the "Re-activate" bulk action.
 *
 * Every soft-delete module already lets an admin restore ONE row from the
 * pinned Action column, but the bulk bar only offered "Move to Inactive" — so
 * de-activating fifty customers took one click and undoing it took fifty. The
 * selection logic lives here rather than in each of the eleven list pages so
 * the rule for "what counts as inactive" is written once.
 */

/** The soft-delete flag every module shares, read off a row of any shape. */
type ActivatableRow = { is_active?: boolean | null };

/**
 * The selected ids that are actually inactive, in table order.
 *
 * `is_active` is only ever read as `!== false` across the product: a row whose
 * flag was never written (legacy data, or an insert that predates the column)
 * renders as Active, so it must not be counted here either. Selected ids with
 * no matching row are dropped — a selection outlives a filter change, so it can
 * hold ids that are no longer on the page.
 *
 * `T` is deliberately unconstrained. Several list pages type their row with an
 * index signature (`[key: string]: any`, for custom fields), and TypeScript's
 * weak-type rule rejects those against an all-optional constraint even though
 * they do carry the flag.
 */
export function inactiveSelection<T>(
  rows: readonly T[],
  selectedIds: Set<string>,
  idOf: (row: T) => string = (row) => (row as T & { id: string }).id,
  // Price Lists and Schemes name the same flag `active`, so it is an accessor
  // rather than a fixed column.
  activeOf: (row: T) => boolean | null | undefined = (row) =>
    (row as ActivatableRow).is_active,
): string[] {
  if (selectedIds.size === 0) return [];
  return rows
    .filter((row) => selectedIds.has(idOf(row)) && activeOf(row) === false)
    .map(idOf);
}

/**
 * Why the Re-activate button is disabled, for its hover tooltip — or
 * `undefined` when there is something to restore and it should be enabled.
 */
export function reactivateDisabledReason(
  selectedCount: number,
  inactiveCount: number,
): string | undefined {
  if (inactiveCount > 0) return undefined;
  if (selectedCount === 0) return "Select records to re-activate";
  if (selectedCount === 1) return "The selected record is not Inactive";
  return `None of the ${selectedCount} selected records are Inactive`;
}

/**
 * Flip `is_active` back on for a batch of rows.
 *
 * One statement for the whole batch: the older per-row loops in this codebase
 * cost a round trip each, which is the single biggest source of slow writes
 * here (see OZZO_DATA_PERF_RESEARCH.md).
 */
export async function bulkReactivate(
  supabase: SupabaseClient,
  table: string,
  ids: string[],
): Promise<{ error: { message: string } | null }> {
  if (ids.length === 0) return { error: null };
  const { error } = await supabase.from(table).update({ is_active: true }).in("id", ids);
  return { error: error ? { message: error.message } : null };
}

/** "3 customers re-activated" / "1 customer re-activated". */
export function reactivatedMessage(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural} re-activated`;
}
