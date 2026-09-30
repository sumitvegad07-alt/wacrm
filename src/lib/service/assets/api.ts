// Customer assets — data layer (FSM Phase 1).
//
//   Screens → [ THIS MODULE ] → Supabase table access → Database
//
// Same shape as src/lib/route/sdk.ts: an INJECTED SupabaseClient (so the browser client, a server
// client and, later, mobile can all use it), typed errors, no React, no cache. Assets use plain
// table access rather than RPCs, so this is much thinner than the route SDK. It is deliberately
// not marked 'server-only': the caller decides which client (and therefore which session) runs it,
// and Row Level Security — not this file — is what enforces tenant isolation and permissions.
//
// A BEFORE INSERT/UPDATE trigger owns asset_code, territory inheritance and both customer
// snapshots (migration 20260929152000). So the write functions build their payload from an
// allowlist and NEVER send asset_code, customer_name_snapshot, customer_phone_snapshot, account_id
// (on update) or deleted_at (except archiveAsset), and never send a blank territory_id.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetStatus, CustomerAsset } from '../types';
import { AssetError, mapAssetError, type AssetConflict } from './errors';
import { buildAssetSearchOr, warrantyDateBounds, type AssetFilters } from './filters';

// ── Shapes ─────────────────────────────────────────────────────────────────────

/**
 * The joined customer. `name` is genuinely NULL for customers imported from a phone list, so a
 * screen renders `contact.name ?? contact.phone`. `contact` itself can be null if the caller's
 * data scope hides that customer row. The Customer column reads THIS, never the snapshot columns
 * (spec §4.3) — the snapshots exist for history and old-phone search only.
 */
export interface AssetContactRef {
  name: string | null;
  phone: string;
}

/** One row of the asset list: the asset plus its joined customer and type. */
export type AssetListRow = CustomerAsset & {
  contact: AssetContactRef | null;
  asset_type: { name: string } | null;
};

/** The asset detail page's row: list row plus product and territory names. */
export type AssetDetail = AssetListRow & {
  product: { name: string } | null;
  territory: { name: string } | null;
};

export interface ListAssetsOptions {
  /** Scope to one account. RLS already limits rows to accounts the user belongs to; pass this when a user can belong to several. */
  accountId?: string;
  /** Page size. Default 25. */
  limit?: number;
  /** Row offset. Default 0. */
  offset?: number;
  /** "Now" for the warranty filter; tests only. */
  today?: Date;
}

export interface ListAssetsResult {
  rows: AssetListRow[];
  /** Total rows matching the filters, ignoring paging. */
  total: number;
}

/**
 * The fields a form may write. Deliberately excludes asset_code, both snapshots, account_id and
 * deleted_at: the database owns them. Blank strings are treated as "not provided" on create and as
 * "clear the value" on update (except territory_id — see updateAsset).
 */
export interface AssetFormFields {
  contact_id: string;
  name: string;
  asset_type_id?: string | null;
  product_id?: string | null;
  make?: string | null;
  model_no?: string | null;
  serial_no?: string | null;
  installation_date?: string | null;
  warranty_start?: string | null;
  warranty_end?: string | null;
  status?: AssetStatus;
  site_label?: string | null;
  territory_id?: string | null;
  notes?: string | null;
}

export interface CreateAssetInput extends AssetFormFields {
  account_id: string;
  /** profiles.id of the creator. */
  created_by?: string | null;
}

export type UpdateAssetInput = Partial<AssetFormFields>;

// ── Select lists ───────────────────────────────────────────────────────────────

const LIST_SELECT = '*, contact:contacts(name, phone), asset_type:asset_types(name)';
const DETAIL_SELECT = `${LIST_SELECT}, product:products(name), territory:territories(name)`;

// ── Reads ──────────────────────────────────────────────────────────────────────

/**
 * Paginated, filterable asset list, newest first (id as tie-break so paging is stable).
 * `showInactive` controls archival (deleted_at) ONLY — nothing here filters on `status` unless the
 * caller passed `status`.
 */
export async function listAssets(
  supabase: SupabaseClient,
  filters: AssetFilters = {},
  opts: ListAssetsOptions = {},
): Promise<ListAssetsResult> {
  const { accountId, limit = 25, offset = 0, today } = opts;

  let q = supabase.from('customer_assets').select(LIST_SELECT, { count: 'exact' });

  if (accountId) q = q.eq('account_id', accountId);
  if (!filters.showInactive) q = q.is('deleted_at', null);
  if (filters.contactId) q = q.eq('contact_id', filters.contactId);
  if (filters.assetTypeId) q = q.eq('asset_type_id', filters.assetTypeId);
  if (filters.territoryId) q = q.eq('territory_id', filters.territoryId);
  if (filters.status && filters.status.length > 0) q = q.in('status', filters.status);

  if (filters.warranty) {
    const b = warrantyDateBounds(filters.warranty, today);
    if (b.gte) q = q.gte('warranty_end', b.gte);
    if (b.lte) q = q.lte('warranty_end', b.lte);
    if (b.lt) q = q.lt('warranty_end', b.lt);
  }

  const term = filters.q?.trim();
  if (term) q = q.or(buildAssetSearchOr(term));

  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw mapAssetError(error);

  // Untyped client: the select string is the contract, so the cast is the single place that states it.
  const rows = (data ?? []) as unknown as AssetListRow[];
  return { rows, total: count ?? rows.length };
}

/** One asset with its joined customer, type, product and territory; null when it does not exist or is not visible. Archived assets ARE returned (check deleted_at). */
export async function getAsset(supabase: SupabaseClient, id: string): Promise<AssetDetail | null> {
  const { data, error } = await supabase.from('customer_assets').select(DETAIL_SELECT).eq('id', id).maybeSingle();
  if (error) throw mapAssetError(error);
  return (data as unknown as AssetDetail | null) ?? null;
}

// ── Writes ─────────────────────────────────────────────────────────────────────

const TEXT_FIELDS = ['make', 'model_no', 'serial_no', 'site_label', 'notes'] as const;
const DATE_FIELDS = ['installation_date', 'warranty_start', 'warranty_end'] as const;
const REF_FIELDS = ['asset_type_id', 'product_id'] as const;

type WritePayload = Record<string, string | null>;

/** undefined → not provided; blank / null → null; otherwise the trimmed string. */
function norm(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Build the row to write from an ALLOWLIST (never a spread), so a stray asset_code or snapshot on
 * an object that slipped past the types still cannot reach the database.
 * - create: null / blank values are dropped (the column defaults to NULL anyway).
 * - update: null / blank clears the column, EXCEPT territory_id, which is dropped when blank —
 *   the trigger re-inherits a NULL territory from the contact, so "clearing" it would silently
 *   refill it. A territory can be changed, not unset.
 */
function buildPayload(input: Partial<AssetFormFields>, mode: 'create' | 'update'): WritePayload {
  const out: WritePayload = {};
  const put = (key: string, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value === null && mode === 'create') return;
    out[key] = value;
  };

  const contact = norm(input.contact_id);
  if (contact) out.contact_id = contact;

  const name = norm(input.name);
  if (name) out.name = name;

  for (const k of TEXT_FIELDS) put(k, norm(input[k]));
  for (const k of DATE_FIELDS) put(k, norm(input[k]));
  for (const k of REF_FIELDS) put(k, norm(input[k]));

  const territory = norm(input.territory_id);
  if (territory) out.territory_id = territory;

  if (input.status !== undefined) out.status = input.status;
  return out;
}

/**
 * Look up the live asset that holds `serial` (case-insensitive, matching the unique index on
 * lower(serial_no)), so the form can say "Serial 12345 already exists on asset AST-000091".
 * Best effort: any failure returns null and the caller still reports the duplicate.
 */
async function findSerialConflict(
  supabase: SupabaseClient,
  serial: string,
  scope: { accountId?: string | null; excludeId?: string },
): Promise<AssetConflict | null> {
  try {
    // A plain (non-.or) filter, so only the LIKE layer needs escaping; `*` cannot be escaped
    // (PostgREST rewrites it), so candidates are re-checked for an exact match below.
    const pattern = serial.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '_');
    let q = supabase
      .from('customer_assets')
      .select('id, account_id, asset_code, serial_no')
      .is('deleted_at', null)
      .ilike('serial_no', pattern)
      .limit(10);
    if (scope.excludeId) q = q.neq('id', scope.excludeId);
    const { data, error } = await q;
    if (error) return null;
    const wanted = serial.toLowerCase();
    const hit = ((data ?? []) as { id: string; account_id: string; asset_code: string; serial_no: string | null }[]).find(
      (r) => r.serial_no?.toLowerCase() === wanted && (!scope.accountId || r.account_id === scope.accountId),
    );
    return hit ? { id: hit.id, asset_code: hit.asset_code } : null;
  } catch {
    return null;
  }
}

/** Create an asset. The database assigns asset_code, inherits the territory and captures the snapshots. */
export async function createAsset(supabase: SupabaseClient, input: CreateAssetInput): Promise<CustomerAsset> {
  const payload = buildPayload(input, 'create');
  if (!payload.name) throw new AssetError('validation', 'Asset name is required.');
  if (!payload.contact_id) throw new AssetError('validation', 'Choose a customer for this asset.');

  const row: WritePayload = { account_id: input.account_id, ...payload };
  const createdBy = norm(input.created_by);
  if (createdBy) row.created_by = createdBy;

  const { data, error } = await supabase.from('customer_assets').insert(row).select('*').single();
  if (error) {
    const serial = payload.serial_no ?? undefined;
    const mapped = mapAssetError(error, { serial });
    if (mapped.kind !== 'duplicate_serial' || !serial) throw mapped;
    throw mapped.withConflict(await findSerialConflict(supabase, serial, { accountId: input.account_id }));
  }
  return data as CustomerAsset;
}

/**
 * Update an asset from form fields. Only keys present in `input` are written. Blank text/date/
 * type/product clears the column; a blank territory_id is NOT sent (see buildPayload). RLS filters
 * an UPDATE the caller may not perform down to zero rows rather than an error, so a missing result
 * is reported as not_found instead of being mistaken for success.
 */
export async function updateAsset(
  supabase: SupabaseClient,
  id: string,
  input: UpdateAssetInput,
): Promise<CustomerAsset> {
  const payload = buildPayload(input, 'update');
  if (Object.keys(payload).length === 0) throw new AssetError('validation', 'Nothing to update.');
  if (input.name !== undefined && !payload.name) throw new AssetError('validation', 'Asset name is required.');

  const { data, error } = await supabase.from('customer_assets').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) {
    const serial = payload.serial_no ?? undefined;
    const mapped = mapAssetError(error, { serial });
    if (mapped.kind !== 'duplicate_serial' || !serial) throw mapped;
    // The conflict lookup needs the asset's own account so a user in several accounts is not shown another tenant's asset.
    const own = await supabase.from('customer_assets').select('account_id').eq('id', id).maybeSingle();
    const accountId = (own.data as { account_id: string } | null)?.account_id ?? null;
    throw mapped.withConflict(await findSerialConflict(supabase, serial, { accountId, excludeId: id }));
  }
  if (!data) {
    throw new AssetError('not_found', 'Asset not found, or you do not have permission to edit it.');
  }
  return data as CustomerAsset;
}

/**
 * Archive (soft delete): sets deleted_at. There is no hard delete. Guarded by `deleted_at IS NULL`
 * so archiving twice cannot rewrite the original archive time. The database requires the
 * delete_service_assets right for this (trigger, 42501).
 */
export async function archiveAsset(supabase: SupabaseClient, id: string): Promise<CustomerAsset> {
  const { data, error } = await supabase
    .from('customer_assets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw mapAssetError(error);
  if (!data) {
    throw new AssetError('not_found', 'Asset not found, already archived, or you do not have permission to archive it.');
  }
  return data as CustomerAsset;
}
