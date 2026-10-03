// Asset screens — the small reads behind the list filters and the create/edit form. Like api.ts, every function takes an
// INJECTED SupabaseClient, so the server page and the browser can both use them and RLS (not this
// file) decides what the caller may see.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ilikeContainsValue } from './filters';
import type { FilterOption, TerritoryRow } from './list-view';
import { normalizeTerritorySettings } from '@/lib/territories/settings';
import type { Territory, TerritorySettings } from '@/lib/territories/types';

/** Live (not archived) asset types of the account, as filter options, A to Z. */
export async function loadAssetTypeOptions(supabase: SupabaseClient, accountId: string): Promise<FilterOption[]> {
  const { data, error } = await supabase
    .from('asset_types')
    .select('id, name')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; name: string }[]).map((t) => ({ value: t.id, label: t.name }));
}

/**
 * Every live territory of the account (id, parent, name), paged past PostgREST's 1000-row cap: the
 * default territory seed alone is 1047 rows, so an unpaged read would silently drop the rest.
 */
export async function loadTerritoryRows(supabase: SupabaseClient, accountId: string): Promise<TerritoryRow[]> {
  const PAGE = 1000;
  const all: TerritoryRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('territories')
      .select('id, parent_id, name')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .order('id', { ascending: true }) // a stable order, or pages can overlap or skip rows
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as TerritoryRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export interface CustomerOption {
  id: string;
  label: string;
}

interface ContactHit {
  id: string;
  name: string | null;
  phone: string;
}

/** contacts.name is NULL for customers imported from a phone list; contacts.phone is NOT NULL. */
function toOption(c: ContactHit): CustomerOption {
  return { id: c.id, label: c.name?.trim() || c.phone };
}

/**
 * One customer for the filter's label. Null when the customer does not exist OR is hidden from this
 * viewer by contacts data scoping; the caller cannot tell which, and does not need to.
 */
export async function loadCustomerOption(supabase: SupabaseClient, contactId: string): Promise<CustomerOption | null> {
  const { data, error } = await supabase.from('contacts').select('id, name, phone').eq('id', contactId).maybeSingle();
  if (error) throw error;
  return data ? toOption(data as ContactHit) : null;
}

/** Customer picker search: up to 20 matches on name OR phone (empty term lists the first 20). */
export async function searchCustomers(supabase: SupabaseClient, term: string): Promise<CustomerOption[]> {
  let q = supabase.from('contacts').select('id, name, phone').limit(20);
  const t = term.trim();
  if (t) {
    const v = ilikeContainsValue(t);
    q = q.or(`name.ilike.${v},phone.ilike.${v}`);
  }
  const { data, error } = await q.order('name', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return ((data ?? []) as ContactHit[]).map(toOption);
}

/**
 * Live products of the account as picker options, A to Z, paged past PostgREST's 1000-row cap (a
 * catalogue can be larger). `products` has no deleted_at; `active` is its on/off switch.
 */
export async function loadProductOptions(supabase: SupabaseClient, accountId: string): Promise<FilterOption[]> {
  const PAGE = 1000;
  const all: FilterOption[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name')
      .eq('account_id', accountId)
      .eq('active', true)
      .order('name', { ascending: true })
      .order('id', { ascending: true }) // a stable order, or pages can overlap or skip rows
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { id: string; name: string | null }[];
    all.push(...rows.map((p) => ({ value: p.id, label: p.name?.trim() || 'Unnamed product' })));
    if (rows.length < PAGE) break;
  }
  return all;
}

export interface TerritoryFormData {
  rows: Territory[];
  settings: TerritorySettings;
}

const TERRITORY_COLS =
  'id, account_id, parent_id, level, name, code, status, notes, is_seed_data, created_at, updated_at, deleted_at';

/**
 * What the existing cascading <TerritoryPicker> needs: every live territory with its level, and the
 * account's configured levels. Same reads as lib/territories/api.ts, but through an injected client
 * so the server page can run them in parallel with the other lookups instead of the browser doing
 * them after the form has already painted.
 */
export async function loadTerritoryFormData(supabase: SupabaseClient, accountId: string): Promise<TerritoryFormData> {
  const PAGE = 1000;
  const rows: Territory[] = [];
  const readRows = async () => {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('territories')
        .select(TERRITORY_COLS)
        .eq('account_id', accountId)
        .is('deleted_at', null)
        .order('level', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const page = (data ?? []) as Territory[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
  };
  const readSettings = async () => {
    const { data, error } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
    if (error) throw error;
    return normalizeTerritorySettings((data?.settings as Record<string, unknown> | null)?.territory_settings);
  };
  const [settings] = await Promise.all([readSettings(), readRows()]);
  return { rows, settings };
}

/** Everything the asset form's pickers need, loaded once on the server and handed to <AssetForm>. */
export interface AssetFormLookups {
  assetTypes: FilterOption[];
  products: FilterOption[];
  territories: Territory[];
  territorySettings: TerritorySettings;
  /** Names of lookups that failed to load, so the form can say so instead of showing a silently empty picker. */
  failures: string[];
}

/**
 * The form's lookups, in parallel and settled separately: a failed picker degrades to a banner and
 * an empty list, and never takes the whole form down (the user can still type everything else).
 */
export async function loadAssetFormLookups(supabase: SupabaseClient, accountId: string): Promise<AssetFormLookups> {
  const [types, products, territory] = await Promise.allSettled([
    loadAssetTypeOptions(supabase, accountId),
    loadProductOptions(supabase, accountId),
    loadTerritoryFormData(supabase, accountId),
  ]);
  const failures: string[] = [];
  if (types.status === 'rejected') failures.push('asset types');
  if (products.status === 'rejected') failures.push('products');
  if (territory.status === 'rejected') failures.push('territories');
  return {
    assetTypes: types.status === 'fulfilled' ? types.value : [],
    products: products.status === 'fulfilled' ? products.value : [],
    territories: territory.status === 'fulfilled' ? territory.value.rows : [],
    territorySettings:
      territory.status === 'fulfilled' ? territory.value.settings : normalizeTerritorySettings(undefined),
    failures,
  };
}
