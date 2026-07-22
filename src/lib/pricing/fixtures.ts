import type {
  OrderDiscountInput,
  PricingContext,
  PricingLineInput,
  PricingProduct,
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
  expect: {
    sub_total: number;
    tax_total: number;
    total_amount: number;
    discount_total: number;
    classification: 'direct' | 'primary' | 'secondary';
    valid: boolean;
    /** Per-line effective unit price, in line order. */
    effective_unit_prices: number[];
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
    name: 'line flat-amount discount',
    proves: "an 'amount' discount is a total off the line, not per unit",
    lines: [
      {
        productId: 'aaaaaaaa-0000-4000-8000-000000000001',
        quantity: 10,
        discountType: 'amount',
        discountValue: 150,
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
    },
  },
];
