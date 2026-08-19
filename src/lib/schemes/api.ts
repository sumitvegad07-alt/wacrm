// Scheme Management — client data layer. Follows the repo's "talk to Supabase
// directly via createClient()" pattern; RLS (migration 075) enforces that only
// admins of the account can write, and only members can read.
//
// A scheme is a parent row plus three child sets (slabs, product links, customer
// links). Saves are done parent-first, then children; on edit the children are
// replaced. This is not a single transaction, but a partially-saved scheme is
// inert — detect_eligible_schemes simply won't match a scheme with no slabs — so
// the worst case is a scheme that offers nothing until re-saved, never a wrong
// price.

import { createClient } from '@/lib/supabase/client';
import type {
  CustomerOption,
  ProductOption,
  SchemeFormValues,
  SchemeRow,
  SchemeSlabRow,
  SchemeWithDetails,
} from './types';

const SCHEME_COLS =
  'id, account_id, name, scheme_type, slab_mode, target_type, max_free_units_per_order, priority, starts_on, ends_on, active, created_at, updated_at';

const SLAB_COLS =
  'id, scheme_id, min_qty, max_qty, min_value, max_value, reward_type, reward_value, free_product_id, free_qty';

// ── reads ─────────────────────────────────────────────────────
/** All schemes for an account, each hydrated with its slabs, product and
 *  customer links. Ordered by priority (desc) then name so the highest-
 *  precedence promotions surface first — matching the engine's tie-break. */
export async function getSchemes(accountId: string): Promise<SchemeWithDetails[]> {
  const supabase = createClient();

  const [{ data: schemes, error: sErr }, { data: slabs, error: slErr }, { data: prods, error: pErr }, { data: custs, error: cErr }] =
    await Promise.all([
      supabase.from('schemes').select(SCHEME_COLS).eq('account_id', accountId).order('priority', { ascending: false }).order('name', { ascending: true }),
      supabase.from('scheme_slabs').select(SLAB_COLS),
      supabase.from('scheme_products').select('scheme_id, product_id'),
      supabase.from('scheme_customers').select('scheme_id, contact_id'),
    ]);

  if (sErr) throw sErr;
  if (slErr) throw slErr;
  if (pErr) throw pErr;
  if (cErr) throw cErr;

  const slabsByScheme = new Map<string, SchemeSlabRow[]>();
  (slabs ?? []).forEach((s: any) => {
    const list = slabsByScheme.get(s.scheme_id) ?? [];
    list.push(s as SchemeSlabRow);
    slabsByScheme.set(s.scheme_id, list);
  });
  const productsByScheme = new Map<string, string[]>();
  (prods ?? []).forEach((r: any) => {
    const list = productsByScheme.get(r.scheme_id) ?? [];
    list.push(r.product_id);
    productsByScheme.set(r.scheme_id, list);
  });
  const customersByScheme = new Map<string, string[]>();
  (custs ?? []).forEach((r: any) => {
    const list = customersByScheme.get(r.scheme_id) ?? [];
    list.push(r.contact_id);
    customersByScheme.set(r.scheme_id, list);
  });

  return (schemes ?? []).map((row: any) => ({
    ...(row as SchemeRow),
    slabs: slabsByScheme.get(row.id) ?? [],
    productIds: productsByScheme.get(row.id) ?? [],
    customerIds: customersByScheme.get(row.id) ?? [],
  }));
}

/** Products for the scope picker. */
export async function getProductOptions(accountId: string): Promise<ProductOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price')
    .eq('account_id', accountId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p: any) => ({ id: p.id, name: p.name ?? 'Unnamed product', price: Number(p.price ?? 0) }));
}

/** Customers (contacts) for the targeting picker. Firm name first, else contact
 *  person, else phone — matching how the rest of the app labels a contact. */
export async function getCustomerOptions(accountId: string): Promise<CustomerOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('contacts')
    .select('id, company, name, phone')
    .eq('account_id', accountId)
    .order('company', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c: any) => ({
    id: c.id,
    label: c.company || c.name || c.phone || 'Unknown customer',
  }));
}

// ── writes ────────────────────────────────────────────────────
function schemePayload(accountId: string, form: SchemeFormValues) {
  return {
    account_id: accountId,
    name: form.name.trim(),
    scheme_type: form.schemeType,
    slab_mode: form.slabMode,
    target_type: form.targetType,
    max_free_units_per_order: form.maxFreeUnitsPerOrder,
    priority: form.priority,
    starts_on: form.startsOn,
    ends_on: form.endsOn,
    active: form.active,
  };
}

function slabPayload(schemeId: string, slab: SchemeSlabRow) {
  return {
    scheme_id: schemeId,
    min_qty: slab.min_qty,
    max_qty: slab.max_qty,
    min_value: slab.min_value,
    max_value: slab.max_value,
    reward_type: slab.reward_type,
    reward_value: slab.reward_value,
    free_product_id: slab.free_product_id,
    free_qty: slab.free_qty,
  };
}

async function writeChildren(schemeId: string, form: SchemeFormValues) {
  const supabase = createClient();
  if (form.slabs.length > 0) {
    const { error } = await supabase.from('scheme_slabs').insert(form.slabs.map((s) => slabPayload(schemeId, s)));
    if (error) throw error;
  }
  if (form.productIds.length > 0) {
    const { error } = await supabase
      .from('scheme_products')
      .insert(form.productIds.map((product_id) => ({ scheme_id: schemeId, product_id })));
    if (error) throw error;
  }
  if (form.targetType === 'specific_customers' && form.customerIds.length > 0) {
    const { error } = await supabase
      .from('scheme_customers')
      .insert(form.customerIds.map((contact_id) => ({ scheme_id: schemeId, contact_id })));
    if (error) throw error;
  }
}

export async function createScheme(accountId: string, form: SchemeFormValues): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('schemes')
    .insert(schemePayload(accountId, form))
    .select('id')
    .single();
  if (error) throw error;
  const schemeId = data.id as string;
  try {
    await writeChildren(schemeId, form);
  } catch (childErr) {
    // Compensate: a parent with no valid children would be a dangling scheme.
    await supabase.from('schemes').delete().eq('id', schemeId);
    throw childErr;
  }
  return schemeId;
}

export async function updateScheme(accountId: string, schemeId: string, form: SchemeFormValues): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('schemes').update(schemePayload(accountId, form)).eq('id', schemeId);
  if (error) throw error;
  // Replace children wholesale — simplest correct diff for admin-frequency edits.
  await Promise.all([
    supabase.from('scheme_slabs').delete().eq('scheme_id', schemeId),
    supabase.from('scheme_products').delete().eq('scheme_id', schemeId),
    supabase.from('scheme_customers').delete().eq('scheme_id', schemeId),
  ]);
  await writeChildren(schemeId, form);
}

export async function setSchemeActive(schemeId: string, active: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('schemes').update({ active }).eq('id', schemeId);
  if (error) throw error;
}

export async function deleteScheme(schemeId: string): Promise<void> {
  const supabase = createClient();
  // Children cascade via FK ON DELETE CASCADE (migration 075).
  const { error } = await supabase.from('schemes').delete().eq('id', schemeId);
  if (error) throw error;
}
