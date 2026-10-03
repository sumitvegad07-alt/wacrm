// Asset list screen — the small reads behind its filters. Like api.ts, every function takes an
// INJECTED SupabaseClient, so the server page and the browser can both use them and RLS (not this
// file) decides what the caller may see.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ilikeContainsValue } from './filters';
import type { FilterOption, TerritoryRow } from './list-view';

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
