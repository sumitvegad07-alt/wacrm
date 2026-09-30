// Asset list filters — pure functions only (no Supabase, no React), so they are unit-tested
// and reusable by both the list screen's URL handling and api.ts's query building.

import type { AssetStatus } from '../types';

export type WarrantyFilter = 'expiring' | 'expired';

export type AssetFilters = {
  q?: string;
  contactId?: string;
  assetTypeId?: string;
  status?: AssetStatus[];
  warranty?: WarrantyFilter;
  territoryId?: string;
  /**
   * Archival toggle ONLY (spec §7.1: "Show Inactive … matching the eight pages already
   * converted to soft delete"). When falsy, archived rows (deleted_at set) are hidden; when
   * true they are included. It never filters on `status` — hiding scrapped machines is what the
   * Status filter is for, and a scrapped machine's history is exactly what someone opens the
   * record to read.
   */
  showInactive?: boolean;
};

// Exhaustive by construction: adding a value to AssetStatus without listing it here is a
// compile error, so the URL parser can never silently reject a real status.
const STATUS_SET: Record<AssetStatus, true> = {
  active: true,
  under_repair: true,
  replaced: true,
  scrapped: true,
  inactive: true,
};
export const ASSET_STATUSES = Object.keys(STATUS_SET) as AssetStatus[];

function isAssetStatus(v: string): v is AssetStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_SET, v);
}

function isWarrantyFilter(v: string | null): v is WarrantyFilter {
  return v === 'expiring' || v === 'expired';
}

function cleanText(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function parseAssetFilters(params: URLSearchParams): AssetFilters {
  const out: AssetFilters = {};

  const q = cleanText(params.get('q'));
  if (q) out.q = q;

  const contactId = cleanText(params.get('contactId'));
  if (contactId) out.contactId = contactId;

  const assetTypeId = cleanText(params.get('assetTypeId'));
  if (assetTypeId) out.assetTypeId = assetTypeId;

  const territoryId = cleanText(params.get('territoryId'));
  if (territoryId) out.territoryId = territoryId;

  // Repeated param -> array. Unknown values are dropped, duplicates collapse, order is first-seen.
  const status: AssetStatus[] = [];
  for (const raw of params.getAll('status')) {
    const v = raw.trim();
    if (isAssetStatus(v) && !status.includes(v)) status.push(v);
  }
  if (status.length > 0) out.status = status;

  const warranty = params.get('warranty');
  if (isWarrantyFilter(warranty)) out.warranty = warranty;

  if (params.get('showInactive') === 'true') out.showInactive = true;

  return out;
}

export function serializeAssetFilters(f: AssetFilters): URLSearchParams {
  const out = new URLSearchParams();

  const q = cleanText(f.q);
  if (q) out.set('q', q);
  if (cleanText(f.contactId)) out.set('contactId', f.contactId!.trim());
  if (cleanText(f.assetTypeId)) out.set('assetTypeId', f.assetTypeId!.trim());
  for (const s of f.status ?? []) out.append('status', s);
  if (f.warranty) out.set('warranty', f.warranty);
  if (cleanText(f.territoryId)) out.set('territoryId', f.territoryId!.trim());
  if (f.showInactive) out.set('showInactive', 'true');

  return out;
}

/**
 * Human summary of the active filters for the "No assets match these filters" empty state.
 * Clause order is FIXED (the list screen renders this string, so it must be deterministic):
 *   search "<q>", customer, type, status <a, b>, warranty <expiring|expired>, territory
 * Absent filters are omitted; clauses are joined with ", ". customer / type / territory carry
 * only an id here, so they are emitted as bare words rather than inventing a label lookup.
 * showInactive is a view toggle, not a filter, and is not reported.
 */
export function assetFilterSummary(f: AssetFilters): string {
  const clauses: string[] = [];
  const q = cleanText(f.q);
  if (q) clauses.push(`search "${q}"`);
  if (cleanText(f.contactId)) clauses.push('customer');
  if (cleanText(f.assetTypeId)) clauses.push('type');
  if (f.status && f.status.length > 0) clauses.push(`status ${f.status.join(', ')}`);
  if (f.warranty) clauses.push(`warranty ${f.warranty}`);
  if (cleanText(f.territoryId)) clauses.push('territory');
  return clauses.join(', ');
}

// ── Free-text search → PostgREST .or() ─────────────────────────────────────────
//
// `.or('a.ilike.X,b.ilike.X')` is not a value the client library escapes: PostgREST parses that
// string itself, so raw user text can change the filter's structure. `Kent, Mumbai` would become
// two unrelated OR branches; a `)` would end the group early. Two layers have to be right:
//
//   1. The LIKE pattern (what Postgres sees). `%` and `_` are wildcards and `\` is the escape
//      character, so each is prefixed with a backslash to make it a LITERAL. The term is then
//      wrapped in `%…%` for a contains-match.
//   2. The PostgREST value grammar. A value containing any reserved character (`, . ( ) :` …) must
//      be wrapped in double quotes; inside the quotes only `"` and `\` need a backslash. We ALWAYS
//      quote, so no per-character decision is needed and nothing in the term can end the value.
//
// One character survives both layers wrongly: `*`. PostgREST rewrites `*` to `%` in like/ilike
// values and there is no way to escape it. Rather than let a literal star become an open-ended
// wildcard, it is replaced with `_` (a single-character wildcard), so `a*b` still finds `a*b`
// and cannot balloon into `a%b`. This is a deliberate, tiny over-match, not a literal match.
//
// Result: every metacharacter (`, . ( ) " \ % _`) matches itself; only `*` is widened.

/** The quoted value for a contains-ILIKE, safe to splice into an .or() string. */
export function ilikeContainsValue(term: string): string {
  // Layer 1: literal % _ \ inside the LIKE pattern, then the star fix-up (added AFTER escaping,
  // so the `_` it introduces stays a real single-character wildcard).
  const pattern = term.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '_');
  // Layer 2: PostgREST double-quoted value; escape the two characters that are special inside it.
  const quoted = `%${pattern}%`.replace(/[\\"]/g, '\\$&');
  return `"${quoted}"`;
}

/** The four columns free-text search covers. `customer_phone_snapshot` lets an old number still find the machine. */
const SEARCH_COLUMNS = ['name', 'serial_no', 'asset_code', 'customer_phone_snapshot'] as const;

/** The argument to `.or(...)` for a free-text term: one ilike branch per search column. */
export function buildAssetSearchOr(q: string): string {
  const v = ilikeContainsValue(q);
  return SEARCH_COLUMNS.map((c) => `${c}.ilike.${v}`).join(',');
}

// ── Warranty → date bounds ─────────────────────────────────────────────────────
//
// warranty_end is a DATE, so the list filters on it in SQL (a post-filter would break pagination).
// The definition of "expiring" / "expired" lives in warrantyState() (../settings), which decides
// the pill colour; this function only expresses the SAME rule as date bounds so the filter and the
// pill cannot disagree. The 30-day window is repeated here because settings.ts does not export it;
// the test file checks the two against each other across every boundary day, so drift fails CI.
const EXPIRING_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Inclusive/exclusive ISO-date bounds (UTC calendar days, like warrantyState) for a warranty filter. */
export function warrantyDateBounds(
  kind: WarrantyFilter,
  today: Date = new Date(),
): { gte?: string; lte?: string; lt?: string } {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (kind === 'expired') return { lt: isoDate(start) };
  return { gte: isoDate(start), lte: isoDate(start + EXPIRING_WINDOW_DAYS * DAY_MS) };
}
