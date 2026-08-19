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
  // ── Scheme inputs (Phase 4) ────────────────────────────────────────────────
  // These are CONFIRMED scheme effects the salesman accepted, resolved by the
  // detection brain (detectEligibleSchemes / detect_eligible_schemes) BEFORE
  // pricing. The engine treats them as trusted arithmetic inputs — it does not
  // re-resolve slabs. All slab logic lives in detection; drift is caught
  // server-side by re-running detection in create_order/update_order.
  /** The scheme this line's discount (or free-goods reward) came from. */
  schemeId?: string | null;
  /**
   * Money taken off this line by a line-level scheme (quantity_slab: a percent,
   * per-unit amount, or special-price reward already reduced to a rupee figure).
   * 0 for free-goods lines. Combined with the salesman discount but jointly
   * capped so the line can never go negative.
   */
  schemeDiscountAmount?: number;
  /**
   * True when THIS line is a free-goods reward line. It is priced to ₹0 by the
   * engine regardless of catalogue price, contributes nothing to any total, and
   * is exempt from the price-floor check (a ₹0 line is never a floor breach).
   */
  isSchemeGoods?: boolean;
}

/**
 * A confirmed whole-order (value_slab) scheme to apply, resolved by detection.
 * Allocated pro-rata across `positions` exactly like the manual order discount,
 * so each qualifying line's tax reduces correctly.
 */
export interface ConfirmedOrderScheme {
  schemeId: string;
  /** The rupee discount this value-slab produces for the whole order. */
  discountAmount: number;
  /** 1-based line positions the discount spreads across (its scoped products). */
  positions: number[];
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
  /** The scheme this line's discount / free-goods reward is attributed to. */
  scheme_id: string | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Scheme detection (Phase 4)
//
// The detection brain is separate from the pricing engine. It looks at a draft
// order and PROPOSES the schemes it qualifies for; it never sets an order total
// on its own. The salesman confirms a subset, whose money/free-goods effects are
// then fed into calculateOrderPricing as the inputs above. Mirrors the SQL
// `detect_eligible_schemes` function; pinned by the same fixture suite.
// ─────────────────────────────────────────────────────────────────────────────

export type SchemeType = 'quantity_slab' | 'free_goods' | 'value_slab';
export type SlabMode = 'step_up' | 'repeat';
export type SchemeRewardType =
  | 'discount_percent'
  | 'discount_amount'
  | 'special_price'
  | 'free_goods';

export interface SchemeSlab {
  id: string;
  /** quantity_slab / free_goods use qty bounds. */
  minQty: number | null;
  maxQty: number | null;
  /** value_slab uses value bounds. */
  minValue: number | null;
  maxValue: number | null;
  rewardType: SchemeRewardType;
  /** percent, per-unit amount, or special per-unit price, by rewardType. */
  rewardValue: number | null;
  /** free_goods only. */
  freeProductId: string | null;
  freeQty: number | null;
}

export interface SchemeDefinition {
  id: string;
  name: string;
  schemeType: SchemeType;
  slabMode: SlabMode;
  targetType: 'all' | 'specific_customers';
  /** Cap on total free units per order for this scheme. null = uncapped. */
  maxFreeUnitsPerOrder: number | null;
  /** Deterministic tie-break: higher wins when more than one scheme matches. */
  priority: number;
  /** ISO date (YYYY-MM-DD). */
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  /** scheme_products — the products the scheme applies to. Empty = all products. */
  productIds: string[];
  /** scheme_customers — only consulted when targetType = 'specific_customers'. */
  customerIds: string[];
  slabs: SchemeSlab[];
}

/** A single non-free draft line the detector reasons over. */
export interface SchemeDetectionLine {
  productId: string;
  quantity: number;
}

export interface SchemeNudge {
  /** How many more units of the line's product unlock the next reward. */
  unitsToNext?: number;
  /** How much more order value unlocks the next value slab. */
  valueToNext?: number;
  nextRewardLabel: string;
}

export interface LineSchemeSuggestion {
  /** 1-based position into the detection input lines. */
  position: number;
  productId: string;
  schemeId: string;
  schemeName: string;
  schemeType: SchemeType;
  rewardType: SchemeRewardType;
  rewardValue: number;
  matchedSlabId: string;
  /** Rupees off this line (0 for free_goods). Fed straight to the engine. */
  schemeDiscountAmount: number;
  freeProductId: string | null;
  freeProductName: string | null;
  /** Free units earned, already capped by maxFreeUnitsPerOrder. */
  freeQty: number;
  /** Money discounts default to accepted; free goods must be opted into. */
  defaultSelected: boolean;
  nudge: SchemeNudge | null;
}

export interface OrderSchemeSuggestion {
  schemeId: string;
  schemeName: string;
  rewardType: 'discount_percent' | 'discount_amount';
  rewardValue: number;
  /** After-catalogue subtotal of the scheme's own products (₹0 lines excluded). */
  qualifyingSubtotal: number;
  discountAmount: number;
  /** 1-based positions the discount spreads across. */
  appliesToPositions: number[];
  defaultSelected: boolean;
  nudge: SchemeNudge | null;
}

export interface SchemeDetectionResult {
  lineSchemes: LineSchemeSuggestion[];
  orderSchemes: OrderSchemeSuggestion[];
  engineVersion: number;
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
