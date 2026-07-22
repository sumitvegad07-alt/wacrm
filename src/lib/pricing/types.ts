/**
 * Shared pricing types.
 *
 * These mirror the input and output shapes of the `calculate_order_pricing`
 * Postgres function (migration 077). Output keys are deliberately snake_case
 * so a TypeScript result can be compared field-for-field against the JSON the
 * database returns, with no translation layer in between.
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
  catalogue_price: number;
  price_list_price: number;
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
