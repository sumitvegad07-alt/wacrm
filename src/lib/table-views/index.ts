/**
 * Saved table views — pure helpers.
 *
 * Everything here is free of React and of Supabase so it can be unit-tested
 * directly. `useTableView` owns the state and the network; this file owns the
 * rules about what a view *is* and where the browser copies of it live.
 */

import type { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";

export interface TableColumnState {
  /** Every manageable column id, in the order the user arranged them. */
  active: string[];
  /** The subset of `active` that is currently shown. */
  visible: string[];
}

export interface TableViewConfig {
  filters: FilterState;
  /** `null` means "never customised" — fall back to the column defaults in code. */
  columns: TableColumnState | null;
  /** `null` means "never customised" — fall back to DEFAULT_PAGE_SIZE. */
  pageSize: number | null;
}

export interface SavedTableView {
  id: string;
  name: string;
  config: TableViewConfig;
  is_default: boolean;
}

export const DEFAULT_PAGE_SIZE = 10;

/**
 * The database key for a table's saved views.
 *
 * DataTable storage keys carry version suffixes (`wacrm_leads_table_columns_v2`)
 * that developers bump when a column change should force-reset everyone's stored
 * layout. Saved views must survive that, so they key off the unversioned name.
 * The browser-side keys below deliberately keep the raw versioned string, so a
 * bump still does its job of resetting layouts.
 */
export function normalizeTableKey(storageKey: string): string {
  return storageKey.replace(/_v\d+$/, "");
}

/** Column layout + rows per page: long-lived, per browser. Pre-dates this feature. */
export function columnStorageKey(storageKey: string): string {
  return storageKey;
}

/** Working filters: per browser tab, cleared when the tab closes. */
export function scratchStorageKey(storageKey: string): string {
  return `${storageKey}:filters`;
}

/** Which saved view is showing, so the name survives navigation. Per browser tab. */
export function activeViewStorageKey(storageKey: string): string {
  return `${storageKey}:view`;
}

// ---------------------------------------------------------------------------
// Storage. Both sessionStorage and localStorage throw in some privacy modes, so
// every access is guarded and a failure degrades to "nothing stored".
// ---------------------------------------------------------------------------

function readJson<T>(store: "local" | "session", key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(store: "local" | "session", key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    (store === "local" ? window.localStorage : window.sessionStorage).setItem(
      key,
      JSON.stringify(value),
    );
  } catch {
    /* storage unavailable or full — the table still works, it just forgets */
  }
}

function removeItem(store: "local" | "session", key: string): void {
  if (typeof window === "undefined") return;
  try {
    (store === "local" ? window.localStorage : window.sessionStorage).removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * The stored column layout. The shape `{ active, visible }` is what DataTable has
 * written since before saved views existed, so it is read as-is rather than
 * migrated — nobody loses a layout they set up earlier.
 */
export function readStoredColumns(storageKey: string): TableColumnState | null {
  const parsed = readJson<{ active?: unknown; visible?: unknown }>(
    "local",
    columnStorageKey(storageKey),
  );
  if (!parsed || !Array.isArray(parsed.active) || !Array.isArray(parsed.visible)) return null;
  return {
    active: parsed.active.filter((id): id is string => typeof id === "string"),
    visible: parsed.visible.filter((id): id is string => typeof id === "string"),
  };
}

export function writeStoredColumns(storageKey: string, columns: TableColumnState): void {
  writeJson("local", columnStorageKey(storageKey), columns);
}

export function readStoredPageSize(storageKey: string): number | null {
  const parsed = readJson<{ pageSize?: unknown }>("local", columnStorageKey(storageKey));
  const size = parsed?.pageSize;
  return typeof size === "number" && size > 0 ? size : null;
}

export function writeStoredPageSize(storageKey: string, pageSize: number): void {
  const existing = readJson<Record<string, unknown>>("local", columnStorageKey(storageKey)) ?? {};
  writeJson("local", columnStorageKey(storageKey), { ...existing, pageSize });
}

/**
 * Working filters for this tab.
 *
 * Returns `undefined` for "nothing stored" and distinguishes it from `{}`. That
 * difference decides behaviour: a user who cleared every filter on purpose must
 * get an empty table filter set back, not the module's defaults.
 */
export function readScratchFilters(storageKey: string): FilterState | undefined {
  const parsed = readJson<{ filters?: FilterState }>("session", scratchStorageKey(storageKey));
  if (!parsed || typeof parsed.filters !== "object" || parsed.filters === null) return undefined;
  return parsed.filters;
}

export function writeScratchFilters(storageKey: string, filters: FilterState): void {
  writeJson("session", scratchStorageKey(storageKey), { filters });
}

export function clearScratchFilters(storageKey: string): void {
  removeItem("session", scratchStorageKey(storageKey));
}

export function readActiveViewId(storageKey: string): string | null {
  const parsed = readJson<{ id?: unknown }>("session", activeViewStorageKey(storageKey));
  return typeof parsed?.id === "string" ? parsed.id : null;
}

export function writeActiveViewId(storageKey: string, id: string | null): void {
  if (id === null) removeItem("session", activeViewStorageKey(storageKey));
  else writeJson("session", activeViewStorageKey(storageKey), { id });
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/**
 * Work out which columns to show, from the column definitions in code plus
 * whatever layout was stored or came from a view.
 *
 * Pure, so switching view needs no effect and cannot flicker. A column added by
 * a later release is appended to a stored layout and shown unless its
 * `visibleByDefault` is false — the behaviour DataTable had before, except that
 * it no longer silently writes the merged result back to storage.
 *
 * The `actions` column is excluded: DataTable pins it to the second position and
 * it must not be hideable or re-orderable.
 */
export function reconcileColumns<T>(
  columns: ColumnDef<T>[],
  stored: TableColumnState | null,
): TableColumnState {
  const manageable = (columns ?? []).filter((c) => c.id !== "actions");
  const known = new Set(manageable.map((c) => c.id));

  if (!stored) {
    return {
      active: manageable.map((c) => c.id),
      visible: manageable.filter((c) => c.visibleByDefault !== false).map((c) => c.id),
    };
  }

  // Keep the user's order, drop ids for columns that no longer exist.
  const active = stored.active.filter((id) => known.has(id));
  const added = manageable.map((c) => c.id).filter((id) => !stored.active.includes(id));

  const visible = stored.visible.filter((id) => known.has(id));
  const addedVisible = added.filter((id) => {
    const col = manageable.find((c) => c.id === id);
    return col ? col.visibleByDefault !== false : false;
  });

  return {
    active: [...active, ...added],
    visible: [...visible, ...addedVisible],
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** A filter counts as set when it is not null, not blank, and not an empty list. */
export function isFilterActive(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0 && value.some((v) => v !== "" && v !== null);
  return true;
}

export function countActiveFilters(filters: FilterState): number {
  return Object.values(filters ?? {}).filter(isFilterActive).length;
}

/** Drop unset keys so `{ status: null }` and `{}` compare as the same thing. */
export function pruneFilters(filters: FilterState): FilterState {
  const out: FilterState = {};
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (isFilterActive(value)) out[key] = value;
  }
  return out;
}

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function filtersEqual(a: FilterState, b: FilterState): boolean {
  const left = pruneFilters(a);
  const right = pruneFilters(b);
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((k) => JSON.stringify(left[k]) === JSON.stringify(right[k]));
}

/**
 * Whether the table currently looks like the given view. Drives the
 * "• Modified" marker and whether "Update this view" is offered.
 *
 * A `null` side means "not customised", which matches anything, so simply
 * opening a view that never saved a column layout does not read as modified.
 */
export function configsEqual(a: TableViewConfig, b: TableViewConfig): boolean {
  if (!filtersEqual(a.filters, b.filters)) return false;

  if (a.columns && b.columns) {
    if (!sameList(a.columns.active, b.columns.active)) return false;
    if (!sameList(a.columns.visible, b.columns.visible)) return false;
  }

  if (a.pageSize !== null && b.pageSize !== null && a.pageSize !== b.pageSize) return false;

  return true;
}

/** Coerce whatever came back from `config jsonb` into a usable config. */
export function parseConfig(raw: unknown): TableViewConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const filters =
    obj.filters && typeof obj.filters === "object" ? (obj.filters as FilterState) : {};

  let columns: TableColumnState | null = null;
  const rawColumns = obj.columns as { active?: unknown; visible?: unknown } | null | undefined;
  if (rawColumns && Array.isArray(rawColumns.active) && Array.isArray(rawColumns.visible)) {
    columns = {
      active: rawColumns.active.filter((id): id is string => typeof id === "string"),
      visible: rawColumns.visible.filter((id): id is string => typeof id === "string"),
    };
  }

  const pageSize =
    typeof obj.pageSize === "number" && obj.pageSize > 0 ? obj.pageSize : null;

  return { filters, columns, pageSize };
}
