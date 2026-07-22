import type {
  FloorViolation,
  OrderDiscountInput,
  PricingContext,
  PricingLineInput,
  PricingLineResult,
  PricingProduct,
  PricingResult,
} from './types';

/**
 * ADVISORY mirror of the `calculate_order_pricing` Postgres function
 * (migration 077).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS NOT AUTHORITATIVE. The database decides what an order costs.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It exists for exactly two reasons, both of which need an answer with no
 * network round trip:
 *
 *   1. Live totals as the user types.
 *   2. Mobile order entry with no signal at all, where there is no database
 *      to ask. The order is saved with pricing_status='provisional' and the
 *      server re-checks it on sync.
 *
 * Because this duplicates logic that also lives in SQL, the two are pinned
 * together by a shared fixture suite (`fixtures.ts`). If you change the
 * pricing rules here you MUST change migration 077 and re-run the fixtures
 * against both. A divergence is a bug, not a rounding opinion.
 *
 * The identical duplication already bit this codebase once — see
 * wacrm-mobile/src/services/QuotationCalculationEngine.ts, whose own header
 * asks for exactly the centralisation this file is a controlled exception to.
 *
 * PRICING SEQUENCE (fixed, not configurable — matches SQL):
 *   catalogue -> price list [Phase 3] -> scheme [Phase 4]
 *     -> salesman discount -> pro-rata order discount -> price floor
 */

/**
 * Round half-up to `dp` decimals, compensating for binary floating point
 * representation error (0.1 + 0.2, 1.005, and friends). Postgres NUMERIC is
 * exact decimal, so a naive Math.round() drifts from the server on values
 * that land exactly on a half.
 */
function round(value: number, dp: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  const scaled = value * factor;
  // Nudge by an epsilon proportional to the magnitude, so 470.24999999999994
  // rounds like the 470.25 it was meant to be.
  const corrected = scaled + (scaled >= 0 ? 1 : -1) * Math.abs(scaled) * Number.EPSILON * 4;
  return Math.round(corrected) / factor;
}

const round2 = (n: number) => round(n, 2);
const round4 = (n: number) => round(n, 4);

/** Mirrors the SQL classification branch exactly. */
export function classify(ctx: PricingContext): 'direct' | 'primary' | 'secondary' {
  if (!ctx.hierarchyEnabled) return 'direct';
  // Hierarchy is on but this customer has no level. 'direct' means "not known
  // yet" — deliberately NOT 'secondary', which would assert a position in the
  // hierarchy nobody has actually stated.
  if (ctx.customerLevel === null || ctx.customerLevel === undefined) return 'direct';
  if (ctx.customerLevel <= 1) return 'primary';
  return 'secondary';
}

export function calculateOrderPricing(
  lines: PricingLineInput[],
  products: Map<string, PricingProduct> | Record<string, PricingProduct>,
  ctx: PricingContext,
  orderDiscount?: OrderDiscountInput | null,
): PricingResult {
  const lookup = (id: string): PricingProduct | undefined =>
    products instanceof Map ? products.get(id) : products[id];

  // ---- pass 1: resolve, apply the line-level salesman discount ----
  const scratch = (lines ?? []).map((line, index) => {
    const product = lookup(line.productId);
    const quantity = Math.max(Number(line.quantity) || 0, 0);
    const cataloguePrice = Number(product?.price ?? 0);
    // Phase 3 resolves the customer's price list here. Until then the admin
    // price is the catalogue price, or the locked price when an existing line
    // is being re-priced during an edit.
    const priceListPrice = Number(line.lockedPrice ?? product?.price ?? 0);
    const discountValue = Math.max(Number(line.discountValue) || 0, 0);
    const discountType = line.discountType ?? null;

    const gross = round2(priceListPrice * quantity);
    // Phase 4 applies schemes here.
    const schemeDiscountAmount = 0;

    let discountAmount = 0;
    if (discountType === 'percent') discountAmount = round2((gross * discountValue) / 100);
    else if (discountType === 'amount') discountAmount = round2(discountValue);
    // A discount can never exceed the line it is discounting.
    discountAmount = Math.min(discountAmount, gross);

    return {
      position: index + 1,
      product,
      quantity,
      cataloguePrice,
      priceListPrice,
      discountType,
      discountValue,
      discountAmount,
      schemeDiscountAmount,
      gross,
      afterItem: gross - discountAmount - schemeDiscountAmount,
    };
  });

  const baseSum = scratch.reduce((sum, s) => sum + s.afterItem, 0);

  // ---- whole-order discount ----
  let orderDiscountTotal = 0;
  if (orderDiscount?.type === 'percent') {
    orderDiscountTotal = round2((baseSum * (Number(orderDiscount.value) || 0)) / 100);
  } else if (orderDiscount?.type === 'amount') {
    orderDiscountTotal = Math.min(round2(Number(orderDiscount.value) || 0), baseSum);
  }

  // ---- pass 2: allocate pro-rata, tax, floor check ----
  const floorViolations: FloorViolation[] = [];

  const resultLines: PricingLineResult[] = scratch.map((s) => {
    // Allocated per line rather than held at the header so each line's tax
    // reduces correctly — invoice discounts must apply at line level.
    const share = baseSum > 0 ? round2((orderDiscountTotal * s.afterItem) / baseSum) : 0;
    const net = s.afterItem - share;
    const taxRate = Number(s.product?.taxRate ?? 0);
    const taxAmount = round2((net * taxRate) / 100);
    const effectiveUnit = s.quantity > 0 ? round4(net / s.quantity) : 0;
    const minPrice = s.product?.minPrice ?? null;
    const floorBreached = minPrice !== null && effectiveUnit < minPrice;

    if (floorBreached && minPrice !== null) {
      floorViolations.push({
        product_id: s.product?.id ?? null,
        product_name: s.product?.name ?? 'Unknown product',
        min_price: minPrice,
        attempted_price: effectiveUnit,
      });
    }

    return {
      position: s.position,
      product_id: s.product?.id ?? null,
      product_name: s.product?.name ?? 'Unknown product',
      unit: s.product?.unit ?? null,
      quantity: s.quantity,
      catalogue_price: s.cataloguePrice,
      price_list_price: s.priceListPrice,
      scheme_discount_amount: s.schemeDiscountAmount,
      discount_type: s.discountType,
      discount_value: s.discountValue,
      discount_amount: s.discountAmount,
      order_discount_share: share,
      sub_total: net,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total: net + taxAmount,
      is_scheme_goods: false,
      min_price: minPrice,
      effective_unit_price: effectiveUnit,
      floor_breached: floorBreached,
    };
  });

  const subTotal = resultLines.reduce((sum, l) => sum + l.sub_total, 0);
  const taxTotal = resultLines.reduce((sum, l) => sum + l.tax_amount, 0);
  const total = resultLines.reduce((sum, l) => sum + l.total, 0);
  const itemDiscountTotal = scratch.reduce((sum, s) => sum + s.discountAmount, 0);

  return {
    lines: resultLines,
    sub_total: subTotal,
    discount_total: itemDiscountTotal + orderDiscountTotal,
    order_discount: orderDiscountTotal,
    tax_total: taxTotal,
    total_amount: total,
    classification: classify(ctx),
    floor_violations: floorViolations,
    enforce_floor: ctx.enforcePriceFloor,
    valid: !(ctx.enforcePriceFloor && floorViolations.length > 0),
    engine_version: 1,
  };
}
