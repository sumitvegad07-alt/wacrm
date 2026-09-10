import { createClient } from "@/lib/supabase/client";
import type { PriceList, PriceListItem, PriceListWithItems } from "./types";

/**
 * Price Lists data access. RLS (migration 074) already restricts every table to
 * the caller's account and gates writes to admins, so these helpers pass the
 * account_id only where the schema needs it (inserts) and otherwise let RLS
 * scope reads.
 */

export async function getPriceLists(accountId: string): Promise<PriceList[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("price_lists")
    .select("id, account_id, name, blanket_discount_percent, active, created_at, price_list_items(count), contacts(count)")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    account_id: r.account_id,
    name: r.name,
    blanket_discount_percent: r.blanket_discount_percent,
    active: r.active,
    created_at: r.created_at,
    item_count: r.price_list_items?.[0]?.count ?? 0,
    customer_count: r.contacts?.[0]?.count ?? 0,
  }));
}

export async function getPriceListWithItems(id: string): Promise<PriceListWithItems> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("price_lists")
    .select("id, account_id, name, blanket_discount_percent, active, created_at, price_list_items(id, product_id, discount_percent, products(name))")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const items: PriceListItem[] = ((data as any).price_list_items ?? []).map((it: any) => ({
    id: it.id,
    product_id: it.product_id,
    product_name: it.products?.name ?? "",
    discount_percent: Number(it.discount_percent),
  }));
  return {
    id: (data as any).id,
    account_id: (data as any).account_id,
    name: (data as any).name,
    blanket_discount_percent: (data as any).blanket_discount_percent,
    active: (data as any).active,
    created_at: (data as any).created_at,
    items,
  };
}

export interface PriceListInput {
  name: string;
  blanket_discount_percent: number | null;
  active: boolean;
  items: { product_id: string; discount_percent: number }[];
}

/** Replace the whole set of overrides for a list (delete-all then insert). */
async function syncItems(listId: string, items: PriceListInput["items"]) {
  const supabase = createClient();
  const { error: delErr } = await supabase.from("price_list_items").delete().eq("price_list_id", listId);
  if (delErr) throw new Error(delErr.message);
  const rows = items
    .filter((i) => i.product_id)
    .map((i) => ({ price_list_id: listId, product_id: i.product_id, discount_percent: i.discount_percent }));
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("price_list_items").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }
}

export async function createPriceList(accountId: string, input: PriceListInput): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("price_lists")
    .insert({
      account_id: accountId,
      name: input.name.trim(),
      blanket_discount_percent: input.blanket_discount_percent,
      active: input.active,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message.includes("duplicate") ? "A price list with that name already exists." : error.message);
  await syncItems(data.id, input.items);
  return data.id;
}

export async function updatePriceList(id: string, input: PriceListInput): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("price_lists")
    .update({
      name: input.name.trim(),
      blanket_discount_percent: input.blanket_discount_percent,
      active: input.active,
    })
    .eq("id", id);
  if (error) throw new Error(error.message.includes("duplicate") ? "A price list with that name already exists." : error.message);
  await syncItems(id, input.items);
}

export async function setPriceListActive(id: string, active: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("price_lists").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePriceList(id: string): Promise<void> {
  const supabase = createClient();
  // contacts.price_list_id is ON DELETE SET NULL, so assigned customers simply
  // fall back to catalogue pricing. price_list_items cascade.
  const { error } = await supabase.from("price_lists").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
