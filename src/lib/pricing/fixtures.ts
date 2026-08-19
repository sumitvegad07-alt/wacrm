import type {
  ConfirmedOrderScheme,
  OrderDiscountInput,
  PricingContext,
  PricingLineInput,
  PricingProduct,
  SchemeDefinition,
  SchemeDetectionLine,
  SchemeRewardType,
} from './types';

/**
 * SHARED PRICING FIXTURES — the contract between the SQL engine and the
 * TypeScript advisory mirror.
 *
 * These cases are run twice:
 *   1. against `calculateOrderPricing()` by vitest (see the .test.ts beside
 *      this file) — fast, no database;
 *   2. against the `calculate_order_pricing` Postgres function, by inserting
 *      these exact products inside a transaction that is then rolled back.
 *      See `sql-parity.md` for the runnable script and the recorded results.
 *
 * If the two disagree on any case, one of them is wrong. Do not "fix" the
 * expectation to make a test pass without understanding which side drifted.
 *
 * Product UUIDs are fixed literals so both sides price the same catalogue.
 */

export const FIXTURE_PRODUCTS: Record<string, PricingProduct> = {
  // Plain product, no tax, no floor.
  'aaaaaaaa-0000-4000-8000-000000000001': {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Plain Widget',
    unit: 'pc',
    price: 100,
    taxRate: 0,
    minPrice: null,
  },
  // Taxed at 18%, floor of 80.
  'aaaaaaaa-0000-4000-8000-000000000002': {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    name: 'Taxed Widget',
    unit: 'pc',
    price: 100,
    taxRate: 18,
    minPrice: 80,
  },
  // Awkward price + rate, to catch rounding drift between NUMERIC and float.
  'aaaaaaaa-0000-4000-8000-000000000003': {
    id: 'aaaaaaaa-0000-4000-8000-000000000003',
    name: 'Odd Widget',
    unit: 'box',
    price: 33.33,
    taxRate: 12.5,
    minPrice: null,
  },
};

export interface PricingFixture {
  name: string;
  /** What this case is actually proving. */
  proves: string;
  lines: PricingLineInput[];
  context: PricingContext;
  orderDiscount?: OrderDiscountInput | null;
  /** Confirmed value-slab (whole-order) schemes, Phase 4. */
  orderSchemes?: ConfirmedOrderScheme[] | null;
  expect: {
    sub_total: number;
    tax_total: number;
    total_amount: number;
    discount_total: number;
    classification: 'direct' | 'primary' | 'secondary';
    valid: boolean;
    /** Per-line effective unit price, in line order. */
    effective_unit_prices: number[];
    /**
     * Per-line rate WITH tax (rate_incl_unit), in line order. Optional — only
     * the inclusive/exclusive display cases assert it.
     */
    rate_incl_unit_prices?: number[];
    /** Per-line is_scheme_goods flag, in line order. Optional — scheme cases only. */
    is_scheme_goods?: boolean[];
  };
}

const CTX_PLAIN: PricingContext = {
  hierarchyEnabled: false,
  enforcePriceFloor: true,
  customerLevel: null,
};

export const PRICING_FIXTURES: PricingFixture[] = [
  {
    name: 'single line, no discount, no tax',
    proves: 'the simplest path: quantity x price, nothing else applied',
    lines: [{ productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 10 }],
    context: CTX_PLAIN,
    expect: {
      sub_total: 1000,
      tax_total: 0,
      total_amount: 1000,
      discount_total: 0,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [100],
    },
  },
  {
    name: 'tax applied at 18%',
    proves: 'tax comes from the slab and is charged on the discounted net',
    lines: [{ productId: 'aaaaaaaa-0000-4000-8000-000000000002', quantity: 10 }],
    context: CTX_PLAIN,
    expect: {
      sub_total: 1000,
      tax_total: 180,
      total_amount: 1180,
      discount_total: 0,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [100],
    },
  },
  {
    name: 'line percentage discount',
    proves: 'a percent discount reduces the line before tax is charged',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000002',
        quantity: 10,
        discountType: 'percent',
        discountValue: 10,
      },
    ],
    context: CTX_PLAIN,
    expect: {
      sub_total: 900,
      tax_total: 162,
      total_amount: 1062,
      discount_total: 100,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [90],
    },
  },
  {
    name: 'line flat-amount discount (per unit)',
    proves: "an 'amount' discount is PER UNIT: ₹15 off each × 10 = ₹150 off the line",
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000001',
        quantity: 10,
        discountType: 'amount',
        discountValue: 15,
      },
    ],
    context: CTX_PLAIN,
    expect: {
      sub_total: 850,
      tax_total: 0,
      total_amount: 850,
      discount_total: 150,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [85],
    },
  },
  {
    name: 'discount larger than the line is capped',
    proves: 'a discount can never exceed the line, so a line never goes negative',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000001',
        quantity: 2,
        discountType: 'amount',
        discountValue: 9999,
      },
    ],
    context: { ...CTX_PLAIN, enforcePriceFloor: false },
    expect: {
      sub_total: 0,
      tax_total: 0,
      total_amount: 0,
      discount_total: 200,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [0],
    },
  },
  {
    name: 'whole-order discount spread pro-rata across two lines',
    proves: 'the order discount is allocated per line so each line taxes correctly',
    lines: [
      { productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 10 }, // 1000, 0% tax
      { productId: 'aaaaaaaa-0000-4000-8000-000000000002', quantity: 10 }, // 1000, 18% tax
    ],
    context: CTX_PLAIN,
    orderDiscount: { type: 'percent', value: 10 },
    expect: {
      // 2000 base, 10% = 200 off, split 100/100
      sub_total: 1800,
      tax_total: 162, // only the taxed line: 900 * 18%
      total_amount: 1962,
      discount_total: 200,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [90, 90],
    },
  },
  {
    name: 'whole-order flat discount capped at order value',
    proves: 'an order discount larger than the order cannot invert the total',
    lines: [{ productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 1 }],
    context: { ...CTX_PLAIN, enforcePriceFloor: false },
    orderDiscount: { type: 'amount', value: 5000 },
    expect: {
      sub_total: 0,
      tax_total: 0,
      total_amount: 0,
      discount_total: 100,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [0],
    },
  },
  {
    name: 'price floor breached blocks the order',
    proves: 'stacked discounts cannot sell below the product floor',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000002', // floor 80
        quantity: 10,
        discountType: 'percent',
        discountValue: 50, // -> 50/unit, under the floor
      },
    ],
    context: CTX_PLAIN,
    expect: {
      sub_total: 500,
      tax_total: 90,
      total_amount: 590,
      discount_total: 500,
      classification: 'direct',
      valid: false, // blocked
      effective_unit_prices: [50],
    },
  },
  {
    name: 'price floor breached but enforcement disabled',
    proves: 'the floor only blocks when the account has enforcement switched on',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000002',
        quantity: 10,
        discountType: 'percent',
        discountValue: 50,
      },
    ],
    context: { ...CTX_PLAIN, enforcePriceFloor: false },
    expect: {
      sub_total: 500,
      tax_total: 90,
      total_amount: 590,
      discount_total: 500,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [50],
    },
  },
  {
    name: 'classification: hierarchy on, top-level customer',
    proves: 'a level 1 customer produces a primary order',
    lines: [{ productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 1 }],
    context: { hierarchyEnabled: true, enforcePriceFloor: true, customerLevel: 1 },
    expect: {
      sub_total: 100,
      tax_total: 0,
      total_amount: 100,
      discount_total: 0,
      classification: 'primary',
      valid: true,
      effective_unit_prices: [100],
    },
  },
  {
    name: 'classification: hierarchy on, customer below top level',
    proves: 'any level below the top produces a secondary order',
    lines: [{ productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 1 }],
    context: { hierarchyEnabled: true, enforcePriceFloor: true, customerLevel: 2 },
    expect: {
      sub_total: 100,
      tax_total: 0,
      total_amount: 100,
      discount_total: 0,
      classification: 'secondary',
      valid: true,
      effective_unit_prices: [100],
    },
  },
  {
    name: 'classification: hierarchy on, customer level not set',
    proves:
      "an unknown level is 'direct' (not known yet), never 'secondary' — it must not assert a position nobody stated",
    lines: [{ productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 1 }],
    context: { hierarchyEnabled: true, enforcePriceFloor: true, customerLevel: null },
    expect: {
      sub_total: 100,
      tax_total: 0,
      total_amount: 100,
      discount_total: 0,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [100],
    },
  },
  {
    name: 'locked price on an edited line',
    proves: 'an existing line keeps its agreed price instead of re-resolving to catalogue',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000001',
        quantity: 10,
        lockedPrice: 75,
      },
    ],
    context: CTX_PLAIN,
    expect: {
      sub_total: 750,
      tax_total: 0,
      total_amount: 750,
      discount_total: 0,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [75],
    },
  },
  {
    name: 'zero quantity line',
    proves: 'a zero-quantity line contributes nothing and does not divide by zero',
    lines: [{ productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 0 }],
    context: CTX_PLAIN,
    expect: {
      sub_total: 0,
      tax_total: 0,
      total_amount: 0,
      discount_total: 0,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [0],
    },
  },
  {
    name: 'awkward price and tax rate',
    proves: 'rounding matches Postgres NUMERIC on values that do not divide cleanly',
    lines: [{ productId: 'aaaaaaaa-0000-4000-8000-000000000003', quantity: 3 }],
    context: CTX_PLAIN,
    expect: {
      // 33.33 * 3 = 99.99 ; 12.5% of 99.99 = 12.49875 -> 12.50
      sub_total: 99.99,
      tax_total: 12.5,
      total_amount: 112.49,
      discount_total: 0,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [33.33],
      // exclusive: 33.33 grossed up by 12.5% = 37.49625 -> 37.50
      rate_incl_unit_prices: [37.5],
    },
  },

  // ── Inclusive tax (engine v2, migration 083) ──────────────────────────────
  // The price already CONTAINS the tax. net = price / (1 + rate); tax = the
  // remainder (penny-perfect), so the total equals the shown inclusive price.
  {
    name: 'inclusive tax, no discount',
    proves: 'an inclusive price is split into net + tax that add back to the same total',
    lines: [
      { productId: 'aaaaaaaa-0000-4000-8000-000000000002', quantity: 10, taxMode: 'inclusive' },
    ],
    context: CTX_PLAIN,
    expect: {
      // 100 incl × 10 = 1000 total ; net = 1000/1.18 = 847.4576 -> 847.46 ;
      // tax = 1000 - 847.46 = 152.54 ; floor check uses the inclusive 100 (>= 80)
      sub_total: 847.46,
      tax_total: 152.54,
      total_amount: 1000,
      discount_total: 0,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [100],
      rate_incl_unit_prices: [100], // inclusive: the catalogue price itself
    },
  },
  {
    name: 'inclusive tax with a per-unit amount discount',
    proves: 'discount is applied in the inclusive basis, then net/tax are backed out',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000002',
        quantity: 5,
        taxMode: 'inclusive',
        discountType: 'amount',
        discountValue: 10, // ₹10 off each × 5 = ₹50 off the (inclusive) line
      },
    ],
    context: CTX_PLAIN,
    expect: {
      // gross 500 incl - 50 = 450 incl ; net = 450/1.18 = 381.3559 -> 381.36 ;
      // tax = 450 - 381.36 = 68.64 ; effective unit (incl) = 90 (>= floor 80)
      sub_total: 381.36,
      tax_total: 68.64,
      total_amount: 450,
      discount_total: 50,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [90],
      rate_incl_unit_prices: [100],
    },
  },
  {
    name: 'inclusive tax breaching the floor',
    proves: 'the floor compares against the inclusive per-unit price and still blocks',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000002', // floor 80
        quantity: 10,
        taxMode: 'inclusive',
        discountType: 'percent',
        discountValue: 30, // -> 70 incl/unit, under the floor
      },
    ],
    context: CTX_PLAIN,
    expect: {
      // gross 1000 incl - 300 = 700 incl ; net = 700/1.18 = 593.2203 -> 593.22 ;
      // tax = 700 - 593.22 = 106.78 ; effective unit (incl) = 70 < 80 -> blocked
      sub_total: 593.22,
      tax_total: 106.78,
      total_amount: 700,
      discount_total: 300,
      classification: 'direct',
      valid: false,
      effective_unit_prices: [70],
      rate_incl_unit_prices: [100],
    },
  },
  {
    name: 'mixed basis: one exclusive line + one inclusive line, whole-order discount',
    proves: 'each line keeps its own basis while the order discount is split pro-rata',
    lines: [
      { productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 10, taxMode: 'exclusive' }, // 1000, 0% tax
      { productId: 'aaaaaaaa-0000-4000-8000-000000000002', quantity: 10, taxMode: 'inclusive' }, // 1000 incl, 18% tax
    ],
    context: CTX_PLAIN,
    orderDiscount: { type: 'percent', value: 10 },
    expect: {
      // base 2000, 10% = 200, split 100/100 -> each line 900 in its own basis.
      // exclusive line: net 900, tax 0.   inclusive line: net 900/1.18 = 762.71,
      // tax = 900 - 762.71 = 137.29. sub = 900 + 762.71 = 1662.71 ;
      // total = 900 + 900 = 1800.
      sub_total: 1662.71,
      tax_total: 137.29,
      total_amount: 1800,
      discount_total: 200,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [90, 90],
      rate_incl_unit_prices: [100, 100], // excl: 100×(1+0)=100 ; incl: 100
    },
  },
  {
    name: 'inclusive tax, awkward rate, rounding',
    proves: 'inclusive net/tax rounding matches Postgres NUMERIC on an unclean divide',
    lines: [
      { productId: 'aaaaaaaa-0000-4000-8000-000000000003', quantity: 3, taxMode: 'inclusive' },
    ],
    context: CTX_PLAIN,
    expect: {
      // 33.33 incl × 3 = 99.99 total ; net = 99.99/1.125 = 88.88 ;
      // tax = 99.99 - 88.88 = 11.11
      sub_total: 88.88,
      tax_total: 11.11,
      total_amount: 99.99,
      discount_total: 0,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [33.33],
      rate_incl_unit_prices: [33.33],
    },
  },

  // ── Schemes (Phase 4, engine_version 3) ───────────────────────────────────
  // The engine receives CONFIRMED scheme effects as inputs (schemeDiscountAmount,
  // isSchemeGoods lines, orderSchemes). These cases pin the arithmetic; the
  // reward RESOLUTION is proven separately in the detection fixtures below.
  {
    name: 'quantity_slab money reward as a line scheme discount',
    proves: 'a confirmed scheme discount reduces the line before tax, like any discount',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000002', // 18% tax, floor 80
        quantity: 10,
        schemeId: '5c000000-0000-4000-8000-000000000001',
        schemeDiscountAmount: 100, // ₹100 off the ₹1000 line (a 10% slab)
      },
    ],
    context: CTX_PLAIN,
    expect: {
      sub_total: 900,
      tax_total: 162, // 900 × 18%
      total_amount: 1062,
      discount_total: 100,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [90],
    },
  },
  {
    name: 'free-goods line is ₹0 and adds nothing to the order',
    proves: 'an is_scheme_goods line contributes zero and is exempt from tax and floor',
    lines: [
      { productId: 'aaaaaaaa-0000-4000-8000-000000000002', quantity: 10 }, // paid 1000 +18%
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000002', // floor 80 — must NOT trip on the ₹0 line
        quantity: 1,
        schemeId: '5c000000-0000-4000-8000-000000000002',
        isSchemeGoods: true,
      },
    ],
    context: CTX_PLAIN,
    expect: {
      sub_total: 1000,
      tax_total: 180,
      total_amount: 1180,
      discount_total: 0,
      classification: 'direct',
      valid: true, // ₹0 free line does not breach the ₹80 floor
      effective_unit_prices: [100, 0],
      is_scheme_goods: [false, true],
    },
  },
  {
    name: 'scheme discount and salesman discount are jointly capped',
    proves: 'scheme + salesman discount together can never take a line below zero',
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000001', // no tax, no floor
        quantity: 10, // gross 1000
        schemeId: '5c000000-0000-4000-8000-000000000003',
        schemeDiscountAmount: 100, // scheme takes 100 first
        discountType: 'percent',
        discountValue: 95, // salesman would take 950, capped at 900 (gross − scheme)
      },
    ],
    context: { ...CTX_PLAIN, enforcePriceFloor: false },
    expect: {
      sub_total: 0,
      tax_total: 0,
      total_amount: 0,
      discount_total: 1000, // 100 scheme + 900 salesman
      classification: 'direct',
      valid: true,
      effective_unit_prices: [0],
    },
  },
  {
    name: 'value_slab whole-order scheme spread pro-rata',
    proves: 'a confirmed value-slab discount splits across its scoped lines and taxes correctly',
    lines: [
      { productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 10 }, // 1000, 0% tax
      { productId: 'aaaaaaaa-0000-4000-8000-000000000002', quantity: 10 }, // 1000, 18% tax
    ],
    context: CTX_PLAIN,
    orderSchemes: [
      {
        schemeId: '5c000000-0000-4000-8000-000000000010',
        discountAmount: 60, // 3% of the 2000 basket
        positions: [1, 2],
      },
    ],
    expect: {
      // 60 split 30/30 → each line 970 in its basis. taxed line: 970 × 18% = 174.6
      sub_total: 1940,
      tax_total: 174.6,
      total_amount: 2114.6,
      discount_total: 60,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [97, 97],
    },
  },
  {
    name: 'value_slab scoped to one line only',
    proves: 'a value-slab discount lands only on the positions it is scoped to',
    lines: [
      { productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 10 }, // 1000, position 1 — NOT in scope
      { productId: 'aaaaaaaa-0000-4000-8000-000000000001', quantity: 10 }, // 1000, position 2 — in scope
    ],
    context: CTX_PLAIN,
    orderSchemes: [
      {
        schemeId: '5c000000-0000-4000-8000-000000000011',
        discountAmount: 50,
        positions: [2],
      },
    ],
    expect: {
      // only line 2 is reduced: 1000 → 950
      sub_total: 1950,
      tax_total: 0,
      total_amount: 1950,
      discount_total: 50,
      classification: 'direct',
      valid: true,
      effective_unit_prices: [100, 95],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SCHEME DETECTION FIXTURES — the contract for detectEligibleSchemes() and the
// SQL detect_eligible_schemes function. Same discipline: run against both sides,
// they must agree. Catalogue prices come from FIXTURE_PRODUCTS above (Plain
// Widget ...0001 = ₹100, Taxed Widget ...0002 = ₹100). Scheme ids are fixed
// literals so both engines resolve the same definitions.
// ─────────────────────────────────────────────────────────────────────────────

const P1 = 'aaaaaaaa-0000-4000-8000-000000000001'; // Plain Widget, ₹100
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002'; // Taxed Widget, ₹100
const TODAY = '2026-08-19';

/** quantity_slab, step_up: 10–19 → 5%, 20+ → 10%, on Plain Widget. */
const SCHEME_QS_PERCENT: SchemeDefinition = {
  id: 'de000000-0000-4000-8000-000000000001',
  name: 'Volume 5/10',
  schemeType: 'quantity_slab',
  slabMode: 'step_up',
  targetType: 'all',
  maxFreeUnitsPerOrder: null,
  priority: 0,
  startsOn: '2026-08-01',
  endsOn: null,
  active: true,
  productIds: [P1],
  customerIds: [],
  slabs: [
    {
      id: 'de000000-0000-4000-8000-0000000000a1',
      minQty: 10, maxQty: 19, minValue: null, maxValue: null,
      rewardType: 'discount_percent', rewardValue: 5, freeProductId: null, freeQty: null,
    },
    {
      id: 'de000000-0000-4000-8000-0000000000a2',
      minQty: 20, maxQty: null, minValue: null, maxValue: null,
      rewardType: 'discount_percent', rewardValue: 10, freeProductId: null, freeQty: null,
    },
  ],
};

/** Higher-priority per-unit amount scheme on the same product, to prove tie-break. */
const SCHEME_QS_PRIORITY: SchemeDefinition = {
  id: 'de000000-0000-4000-8000-000000000002',
  name: 'Flat 5/unit (priority)',
  schemeType: 'quantity_slab',
  slabMode: 'step_up',
  targetType: 'all',
  maxFreeUnitsPerOrder: null,
  priority: 5,
  startsOn: '2026-08-01',
  endsOn: null,
  active: true,
  productIds: [P1],
  customerIds: [],
  slabs: [
    {
      id: 'de000000-0000-4000-8000-0000000000b1',
      minQty: 10, maxQty: null, minValue: null, maxValue: null,
      rewardType: 'discount_amount', rewardValue: 5, freeProductId: null, freeQty: null,
    },
  ],
};

/** free_goods, step_up: buy 10–19 of Taxed Widget → 1 Plain Widget free; 20+ → 3 free. */
const SCHEME_FG_STEP: SchemeDefinition = {
  id: 'de000000-0000-4000-8000-000000000003',
  name: 'Buy 10 get 1',
  schemeType: 'free_goods',
  slabMode: 'step_up',
  targetType: 'all',
  maxFreeUnitsPerOrder: null,
  priority: 0,
  startsOn: '2026-08-01',
  endsOn: null,
  active: true,
  productIds: [P2],
  customerIds: [],
  slabs: [
    {
      id: 'de000000-0000-4000-8000-0000000000c1',
      minQty: 10, maxQty: 19, minValue: null, maxValue: null,
      rewardType: 'free_goods', rewardValue: null, freeProductId: P1, freeQty: 1,
    },
    {
      id: 'de000000-0000-4000-8000-0000000000c2',
      minQty: 20, maxQty: null, minValue: null, maxValue: null,
      rewardType: 'free_goods', rewardValue: null, freeProductId: P1, freeQty: 3,
    },
  ],
};

/** free_goods, repeat: every 10 Plain Widgets → 1 free, capped at 5 per order. */
const SCHEME_FG_REPEAT: SchemeDefinition = {
  id: 'de000000-0000-4000-8000-000000000004',
  name: 'Every 10 → 1 free (cap 5)',
  schemeType: 'free_goods',
  slabMode: 'repeat',
  targetType: 'all',
  maxFreeUnitsPerOrder: 5,
  priority: 0,
  startsOn: '2026-08-01',
  endsOn: null,
  active: true,
  productIds: [P1],
  customerIds: [],
  slabs: [
    {
      id: 'de000000-0000-4000-8000-0000000000d1',
      minQty: 10, maxQty: null, minValue: null, maxValue: null,
      rewardType: 'free_goods', rewardValue: null, freeProductId: P1, freeQty: 1,
    },
  ],
};

/** value_slab: whole basket over ₹50,000 → 3% off. */
const SCHEME_VALUE: SchemeDefinition = {
  id: 'de000000-0000-4000-8000-000000000005',
  name: 'Big Basket 3%',
  schemeType: 'value_slab',
  slabMode: 'step_up',
  targetType: 'all',
  maxFreeUnitsPerOrder: null,
  priority: 0,
  startsOn: '2026-08-01',
  endsOn: null,
  active: true,
  productIds: [],
  customerIds: [],
  slabs: [
    {
      id: 'de000000-0000-4000-8000-0000000000e1',
      minQty: null, maxQty: null, minValue: 50000, maxValue: null,
      rewardType: 'discount_percent', rewardValue: 3, freeProductId: null, freeQty: null,
    },
  ],
};

/** Expired copy of the volume scheme, to prove the date window is honoured. */
const SCHEME_EXPIRED: SchemeDefinition = {
  ...SCHEME_QS_PERCENT,
  id: 'de000000-0000-4000-8000-000000000006',
  name: 'Expired volume',
  endsOn: '2026-08-01',
};

/** Customer-targeted scheme, to prove targeting. */
const SCHEME_TARGETED: SchemeDefinition = {
  ...SCHEME_QS_PERCENT,
  id: 'de000000-0000-4000-8000-000000000007',
  name: 'VIP only',
  targetType: 'specific_customers',
  customerIds: ['c0ffee00-0000-4000-8000-000000000001'],
};

export interface SchemeDetectionFixture {
  name: string;
  proves: string;
  lines: SchemeDetectionLine[];
  schemes: SchemeDefinition[];
  contactId: string | null;
  asOf: string;
  expect: {
    lineSchemes: Array<{
      position: number;
      schemeId: string;
      rewardType: SchemeRewardType;
      schemeDiscountAmount: number;
      freeQty: number;
      defaultSelected: boolean;
    }>;
    orderSchemes: Array<{
      schemeId: string;
      discountAmount: number;
      appliesToPositions: number[];
    }>;
  };
}

export const SCHEME_DETECTION_FIXTURES: SchemeDetectionFixture[] = [
  {
    name: 'step_up picks the highest slab the quantity reaches',
    proves: '25 units lands in the 20+ slab (10%), not the 10–19 slab (5%)',
    lines: [{ productId: P1, quantity: 25 }],
    schemes: [SCHEME_QS_PERCENT],
    contactId: null,
    asOf: TODAY,
    expect: {
      lineSchemes: [
        {
          position: 1,
          schemeId: SCHEME_QS_PERCENT.id,
          rewardType: 'discount_percent',
          schemeDiscountAmount: 250, // 25 × 100 × 10%
          freeQty: 0,
          defaultSelected: true,
        },
      ],
      orderSchemes: [],
    },
  },
  {
    name: 'free_goods step_up earns the slab free quantity, opt-in',
    proves: 'buying 12 earns 1 free (10–19 slab) and defaults to unselected',
    lines: [{ productId: P2, quantity: 12 }],
    schemes: [SCHEME_FG_STEP],
    contactId: null,
    asOf: TODAY,
    expect: {
      lineSchemes: [
        {
          position: 1,
          schemeId: SCHEME_FG_STEP.id,
          rewardType: 'free_goods',
          schemeDiscountAmount: 0,
          freeQty: 1,
          defaultSelected: false,
        },
      ],
      orderSchemes: [],
    },
  },
  {
    name: 'free_goods repeat scales by complete sets and honours the cap',
    proves: '65 units = 6 sets → 6 free, capped to 5 by max_free_units_per_order',
    lines: [{ productId: P1, quantity: 65 }],
    schemes: [SCHEME_FG_REPEAT],
    contactId: null,
    asOf: TODAY,
    expect: {
      lineSchemes: [
        {
          position: 1,
          schemeId: SCHEME_FG_REPEAT.id,
          rewardType: 'free_goods',
          schemeDiscountAmount: 0,
          freeQty: 5,
          defaultSelected: false,
        },
      ],
      orderSchemes: [],
    },
  },
  {
    name: 'best single scheme per line is decided by priority',
    proves: 'the higher-priority flat scheme wins even though the percent scheme gives more',
    lines: [{ productId: P1, quantity: 20 }],
    schemes: [SCHEME_QS_PERCENT, SCHEME_QS_PRIORITY],
    contactId: null,
    asOf: TODAY,
    expect: {
      lineSchemes: [
        {
          position: 1,
          schemeId: SCHEME_QS_PRIORITY.id, // priority 5 beats priority 0
          rewardType: 'discount_amount',
          schemeDiscountAmount: 100, // ₹5 × 20 (vs the 10% = ₹200 it loses to on priority)
          freeQty: 0,
          defaultSelected: true,
        },
      ],
      orderSchemes: [],
    },
  },
  {
    name: 'value_slab qualifies on the basket subtotal',
    proves: 'a ₹60,000 basket clears the ₹50,000 slab and earns 3% off',
    lines: [{ productId: P1, quantity: 600 }],
    schemes: [SCHEME_VALUE],
    contactId: null,
    asOf: TODAY,
    expect: {
      lineSchemes: [],
      orderSchemes: [
        {
          schemeId: SCHEME_VALUE.id,
          discountAmount: 1800, // 3% of 60,000
          appliesToPositions: [1],
        },
      ],
    },
  },
  {
    name: 'an expired scheme is never offered',
    proves: 'the active date window is honoured even when quantities match',
    lines: [{ productId: P1, quantity: 25 }],
    schemes: [SCHEME_EXPIRED],
    contactId: null,
    asOf: TODAY,
    expect: { lineSchemes: [], orderSchemes: [] },
  },
  {
    name: 'customer targeting excludes non-targeted customers',
    proves: "a specific_customers scheme is invisible to a customer who isn't listed",
    lines: [{ productId: P1, quantity: 25 }],
    schemes: [SCHEME_TARGETED],
    contactId: 'deadbeef-0000-4000-8000-000000000099',
    asOf: TODAY,
    expect: { lineSchemes: [], orderSchemes: [] },
  },
  {
    name: 'customer targeting includes the targeted customer',
    proves: 'the same scheme applies to the listed customer',
    lines: [{ productId: P1, quantity: 25 }],
    schemes: [SCHEME_TARGETED],
    contactId: 'c0ffee00-0000-4000-8000-000000000001',
    asOf: TODAY,
    expect: {
      lineSchemes: [
        {
          position: 1,
          schemeId: SCHEME_TARGETED.id,
          rewardType: 'discount_percent',
          schemeDiscountAmount: 250,
          freeQty: 0,
          defaultSelected: true,
        },
      ],
      orderSchemes: [],
    },
  },
];
