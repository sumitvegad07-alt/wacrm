// Asset list screen — the pure decisions behind /service/assets (no React, no Supabase), so the
// parts that are easy to get subtly wrong are unit-tested instead of eyeballed.

import type { AssetStatus } from '../types';
import { assetFilterSummary, type AssetFilters } from './filters';

// ── Paging (lives in the URL: ?page=3&pageSize=50) ─────────────────────────────

export const PAGE_SIZE_OPTIONS = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE = 100_000;

export interface Paging {
  page: number; // 1-based
  pageSize: number;
  offset: number;
}

/** Garbage in the URL (page=abc, pageSize=7, page=-4) falls back to page 1 / the default size. */
export function parsePaging(params: URLSearchParams): Paging {
  const rawPage = Number.parseInt(params.get('page') ?? '', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1;
  const rawSize = Number.parseInt(params.get('pageSize') ?? '', 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// ── Which of the four states to show ───────────────────────────────────────────

export type ListState = 'error' | 'reset-page' | 'onboarding' | 'no-match' | 'populated';

/** True when a real filter is applied. `showInactive` is a view toggle, not a filter, and is not counted. */
export function hasActiveFilters(filters: AssetFilters): boolean {
  return assetFilterSummary(filters).length > 0;
}

/**
 * The single decision for what the list shows. Order matters:
 *
 *  1. error       a failed load is never rendered as an empty table (spec 7.1).
 *  2. populated   any rows win over everything else.
 *  3. reset-page  no rows but offset > 0. Do NOT show an empty state: go back to page 1.
 *                 listAssets maps a PostgREST 416 (offset past the end, e.g. a stale bookmark) to
 *                 { rows: [], total } where total falls back to 0 if the error wording is not
 *                 recognised. Branching an empty state on `total` would show a tenant with 500
 *                 assets the "No assets yet" onboarding copy. Resetting is right whether or not
 *                 that count parsed, so this never reads `total`.
 *  4. no-match    page 1, no rows, a filter is applied: "No assets match these filters."
 *  5. onboarding  page 1, no rows, no filter: "No assets yet." Only reachable here, so it can
 *                 never be shown to someone who filtered or paged.
 */
export function decideListState(input: {
  failed: boolean;
  rowCount: number;
  offset: number;
  filters: AssetFilters;
}): ListState {
  if (input.failed) return 'error';
  if (input.rowCount > 0) return 'populated';
  if (input.offset > 0) return 'reset-page';
  return hasActiveFilters(input.filters) ? 'no-match' : 'onboarding';
}

// ── Display helpers ────────────────────────────────────────────────────────────

/** "under_repair" -> "under repair". The filter summary and status values are raw enum text. */
export function humanize(text: string): string {
  return text.replace(/_/g, ' ');
}

const STATUS_LABEL: Record<AssetStatus, string> = {
  active: 'Active',
  under_repair: 'Under repair',
  replaced: 'Replaced',
  scrapped: 'Scrapped',
  inactive: 'Inactive',
};

export function assetStatusLabel(status: AssetStatus): string {
  return STATUS_LABEL[status];
}

const present = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * What to show in the Customer column.
 *  - Joined contact visible: its name, else its phone (production customers imported from a phone
 *    list have a NULL name; contacts.phone is NOT NULL).
 *  - Joined contact hidden by the viewer's data scope (contacts is data-scoped, customer_assets is
 *    not): the frozen snapshot, else a dash. Using the snapshot here is not a staleness bug (spec
 *    4.3 forbids it only where the live contact is available): the snapshot is on a row the
 *    viewer can already read, and the alternative is a blank cell.
 */
export function assetCustomerLabel(row: {
  contact: { name: string | null; phone: string } | null;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
}): string {
  if (row.contact) {
    if (present(row.contact.name)) return row.contact.name.trim();
    if (present(row.contact.phone)) return row.contact.phone.trim();
  }
  if (present(row.customer_name_snapshot)) return row.customer_name_snapshot.trim();
  if (present(row.customer_phone_snapshot)) return row.customer_phone_snapshot.trim();
  return '—';
}

// ── Territory filter options ───────────────────────────────────────────────────

export interface TerritoryRow {
  id: string;
  parent_id: string | null;
  name: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Territory options for the filter, labelled with their full path ("India › Gujarat › Surat").
 *
 * The filter is an exact match on customer_assets.territory_id, and territories are assigned at the
 * deepest level, so picking a State would match nothing. Only territories that have no child in
 * `rows` are offered, plus `keepId` (the one currently in the URL) so an active filter always has a
 * visible label even if it is not a leaf.
 */
export function buildTerritoryOptions(rows: TerritoryRow[], keepId?: string): FilterOption[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hasChild = new Set<string>();
  for (const r of rows) if (r.parent_id) hasChild.add(r.parent_id);

  const pathOf = (r: TerritoryRow): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    let cur: TerritoryRow | undefined = r;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id); // a parent cycle cannot hang this loop
      names.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return names.join(' › ');
  };

  return rows
    .filter((r) => !hasChild.has(r.id) || r.id === keepId)
    .map((r) => ({ value: r.id, label: pathOf(r) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
