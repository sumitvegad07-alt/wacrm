/**
 * Price Lists (v5) — customer-specific pricing.
 *
 * A price list carries an optional blanket discount % applied to every product,
 * plus optional per-product overrides (price_list_items) that beat the blanket.
 * It is assigned to a customer via contacts.price_list_id, and the pricing
 * engine (calculate_order_pricing / its TS mirror) resolves each order line as
 * override → blanket → catalogue. All figures are DISCOUNT PERCENTAGES, never
 * stored final prices, so a catalogue price change flows through automatically.
 */

export interface PriceListItem {
  id?: string;
  product_id: string;
  /** Filled for display in the editor; not persisted on the item row. */
  product_name?: string;
  discount_percent: number;
}

export interface PriceList {
  id: string;
  account_id: string;
  name: string;
  /** % off every product; null = no blanket. */
  blanket_discount_percent: number | null;
  active: boolean;
  created_at?: string;
  /** Number of per-product overrides (list view only). */
  item_count?: number;
  /** Number of customers currently assigned this list (list view only). */
  customer_count?: number;
}

export interface PriceListWithItems extends PriceList {
  items: PriceListItem[];
}
