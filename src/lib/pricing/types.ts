/**
 * Shared pricing types.
 *
 * These mirror the input and output shapes of the `calculate_order_pricing`
 * Postgres function (migrations 077 → 083 tax_mode → 084 per-unit amount;
 * engine_version 2). Output keys are deliberately snake_case so a TypeScript
 * result can be compared field-for-field against the JSON the database returns,
 * with no translation layer in between.
 */

/** A product as the pricing engine needs to see it. */
export interface PricingProduct {
  id: string;
  name: string;
  unit: string | null;
  /** Catalogue price. */
  price: number;
  /** Resolved percentage from the product's tax slab. 0 when no slab is set. */
  taxRate: number;
  /** Floor below which this product may never be sold. null = no floor. */
  minPrice: number | null;
}

export interface PricingLineInput {
  productId: string;
  quantity: number;
  discountType?: 'percent' | 'amount' | null;
  discountValue?: number;
  /**
   * Set when re-pricing an EXISTING order line during an edit. The line keeps
   * the price already agreed with the customer instead of being re-resolved
   * at today's rates.
   */
  lockedPrice?: number | null;
  /**
   * Tax basis for THIS line, stored per line (order_items.tax_mode) exactly as
   * in the SQL. 'exclusive' (default): the price is pre-tax and tax is added on
   * top. 'inclusive': the price already contains the tax, which is backed out.
   * A new line takes the account's current default; an edited line keeps its
   * own original basis — a single order can therefore mix both.
   */
  taxMode?: 'inclusive' | 'exclusive';
}

export interface OrderDiscountInput {
  type: 'percent' | 'amount';
  value: number;
}

/** Account and customer state the engine needs. */
export interface PricingContext {
  hierarchyEnabled: boolean;
  enforcePriceFloor: boolean;
  /** contacts.hierarchy_level, or null when unknown / no customer selected. */
  customerLevel: number | null;
}

export interface PricingLineResult {
  position: number;
  product_id: string | null;
  product_name: string;
  unit: string | null;
  quantity: number;
  /** The line's tax basis, echoed back so it can be stored on order_items. */
  tax_mode: 'inclusive' | 'exclusive';
  catalogue_price: number;
  price_list_price: number;
  /**
   * Per-unit rate WITH tax, in the price's own basis, for the order-form
   * display columns. Inclusive: the catalogue price itself (tax already in it).
   * Exclusive: catalogue price grossed up by the tax rate.
   */
  rate_incl_unit: number;
  scheme_discount_amount: number;
  discount_type: string | null;
  discount_value: number;
  discount_amount: number;
  order_discount_share: number;
  sub_total: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  is_scheme_goods: boolean;
  min_price: number | null;
  effective_unit_price: number;
  floor_breached: boolean;
}

export interface FloorViolation {
  product_id: string | null;
  product_name: string;
  min_price: number;
  attempted_price: number;
}

export interface PricingResult {
  lines: PricingLineResult[];
  sub_total: number;
  discount_total: number;
  order_discount: number;
  tax_total: number;
  total_amount: number;
  classification: 'direct' | 'primary' | 'secondary';
  floor_violations: FloorViolation[];
  enforce_floor: boolean;
  /** Safe to save. False when a floor is breached and enforcement is on. */
  valid: boolean;
  engine_version: number;
}
