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
import {
  AssetError,
  mapAssetError,
  isRangeNotSatisfiable,
  rangeRowCount,
  type AssetConflict,
} from './errors';
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

  const { data, error, count, status } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) {
    // An offset past the last row (e.g. a stale bookmarked page) is a 416 from PostgREST. That is an
    // empty page, not a failure: report the real total when PostgREST gave one, otherwise zero.
    if (isRangeNotSatisfiable(error, status)) return { rows: [], total: rangeRowCount(error) ?? 0 };
    throw mapAssetError(error);
  }

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
 *
 * Tenant scope is enforced IN SQL with `.eq('account_id', ...)`. Row Level Security is not enough
 * here: its policy is is_account_member(account_id), which admits EVERY account the caller belongs
 * to, so an unscoped query could return another company's asset (and, with the limit applied in SQL
 * before any JS check, push the real conflict out of the page). It fails closed: with no account id
 * (and no `ownerId` to derive one from) it returns null rather than run an unscoped query. Because
 * the SQL filter is authoritative there is deliberately no second account check in JS.
 *
 * Everything, including the account lookup used by updates, runs inside the try/catch: this is a
 * decorator on an error that already happened, so it must never be able to replace that error.
 * Best effort: any failure returns null and the caller still reports the duplicate.
 *
 * scope.accountId: the account to search (create knows it).
 * scope.ownerId: the asset being updated; its account is looked up when accountId is absent, and
 *   the asset itself is excluded from the search.
 */
async function findSerialConflict(
  supabase: SupabaseClient,
  serial: string,
  scope: { accountId?: string | null; ownerId?: string },
): Promise<AssetConflict | null> {
  try {
    const accountId = scope.accountId ?? (scope.ownerId ? await accountOf(supabase, scope.ownerId) : null);
    if (!accountId) return null;

    // A plain (non-.or) filter, so only the LIKE layer needs escaping; `*` cannot be escaped
    // (PostgREST rewrites it), so candidates are re-checked for an exact serial match below. The
    // limit is generous because a star can widen the pattern to several near-miss serials.
    const pattern = serial.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '_');
    let q = supabase
      .from('customer_assets')
      .select('id, asset_code, serial_no')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .ilike('serial_no', pattern)
      .limit(100);
    if (scope.ownerId) q = q.neq('id', scope.ownerId);
    const { data, error } = await q;
    if (error) return null;
    const wanted = serial.toLowerCase();
    const hit = ((data ?? []) as { id: string; asset_code: string; serial_no: string | null }[]).find(
      (r) => r.serial_no?.toLowerCase() === wanted,
    );
    return hit ? { id: hit.id, asset_code: hit.asset_code } : null;
  } catch {
    return null;
  }
}

async function accountOf(supabase: SupabaseClient, assetId: string): Promise<string | null> {
  const { data } = await supabase.from('customer_assets').select('account_id').eq('id', assetId).maybeSingle();
  return (data as { account_id: string } | null)?.account_id ?? null;
}

/**
 * After a failed restore: the code that collided and the live asset now holding it, both scoped to
 * the archived asset's own account in SQL. Best effort (null on any failure).
 */
async function findCodeCollision(
  supabase: SupabaseClient,
  assetId: string,
  newCode?: string,
): Promise<{ assetCode: string | null; conflict: AssetConflict | null }> {
  try {
    const { data: own } = await supabase
      .from('customer_assets')
      .select('account_id, asset_code')
      .eq('id', assetId)
      .maybeSingle();
    const row = own as { account_id: string; asset_code: string } | null;
    if (!row) return { assetCode: newCode ?? null, conflict: null };
    const assetCode = newCode ?? row.asset_code;
    const { data, error } = await supabase
      .from('customer_assets')
      .select('id, asset_code')
      .eq('account_id', row.account_id)
      .eq('asset_code', assetCode)
      .is('deleted_at', null)
      .neq('id', assetId)
      .limit(1)
      .maybeSingle();
    if (error) return { assetCode, conflict: null };
    const hit = data as { id: string; asset_code: string } | null;
    return { assetCode, conflict: hit ? { id: hit.id, asset_code: hit.asset_code } : null };
  } catch {
    return { assetCode: newCode ?? null, conflict: null };
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
    // ownerId: the helper derives the asset's own account (inside its try/catch) so the lookup is account-scoped.
    throw mapped.withConflict(await findSerialConflict(supabase, serial, { ownerId: id }));
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

/**
 * Restore an archived asset (clears deleted_at). Needs the delete_service_assets right, same as
 * archiving (trigger, 42501). Guarded by `deleted_at IS NOT NULL`.
 *
 * If the archived asset's code was reissued to a live asset in the meantime, the restore trips the
 * unique-code index; this throws kind `duplicate_code` whose message says what to do, with
 * `.conflict` set to the asset now holding the code. The way out is to restore WITH a new code:
 * `restoreAsset(supabase, id, { newCode })` sets asset_code in the same UPDATE. The trigger allows
 * exactly that because archived rows are exempt from asset_code immutability. Omit `newCode` for a
 * plain restore.
 */
export async function restoreAsset(
  supabase: SupabaseClient,
  id: string,
  opts: { newCode?: string } = {},
): Promise<CustomerAsset> {
  const newCode = opts.newCode?.trim() || undefined;
  const patch: WritePayload = { deleted_at: null };
  if (newCode) patch.asset_code = newCode;

  const { data, error } = await supabase
    .from('customer_assets')
    .update(patch)
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('*')
    .maybeSingle();
  if (error) {
    const mapped = mapAssetError(error, { restoring: !newCode, assetCode: newCode });
    if (mapped.kind !== 'duplicate_code') throw mapped;
    const { assetCode, conflict } = await findCodeCollision(supabase, id, newCode);
    throw mapAssetError(error, { restoring: !newCode, assetCode: assetCode ?? undefined }).withConflict(conflict);
  }
  if (!data) {
    throw new AssetError('not_found', 'Asset not found, not archived, or you do not have permission to restore it.');
  }
  return data as CustomerAsset;
}
