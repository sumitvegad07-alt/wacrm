import { describe, expect, it } from 'vitest';
import { calculateOrderPricing } from './calculateOrderPricing';
import { FIXTURE_PRODUCTS, PRICING_FIXTURES } from './fixtures';

/**
 * Runs the shared fixture suite against the TypeScript advisory mirror.
 *
 * The SAME fixtures are run against the `calculate_order_pricing` Postgres
 * function — see sql-parity.md for the script and the recorded output. Both
 * sides must agree; the fixtures are the contract, not either implementation.
 */
describe('calculateOrderPricing (advisory mirror)', () => {
  for (const fixture of PRICING_FIXTURES) {
    it(`${fixture.name} — ${fixture.proves}`, () => {
      const result = calculateOrderPricing(
        fixture.lines,
        FIXTURE_PRODUCTS,
        fixture.context,
        fixture.orderDiscount ?? null,
      );

      expect(result.sub_total).toBeCloseTo(fixture.expect.sub_total, 2);
      expect(result.tax_total).toBeCloseTo(fixture.expect.tax_total, 2);
      expect(result.total_amount).toBeCloseTo(fixture.expect.total_amount, 2);
      expect(result.discount_total).toBeCloseTo(fixture.expect.discount_total, 2);
      expect(result.classification).toBe(fixture.expect.classification);
      expect(result.valid).toBe(fixture.expect.valid);

      expect(result.lines).toHaveLength(fixture.expect.effective_unit_prices.length);
      fixture.expect.effective_unit_prices.forEach((expected, i) => {
        expect(result.lines[i].effective_unit_price).toBeCloseTo(expected, 4);
      });
    });
  }

  it('never lets a line go negative, however large the discount', () => {
    const result = calculateOrderPricing(
      [
        {
          productId: 'aaaaaaaa-0000-4000-8000-000000000001',
          quantity: 5,
          discountType: 'percent',
          discountValue: 500,
        },
      ],
      FIXTURE_PRODUCTS,
      { hierarchyEnabled: false, enforcePriceFloor: false, customerLevel: null },
      { type: 'amount', value: 10_000 },
    );

    expect(result.sub_total).toBe(0);
    expect(result.total_amount).toBe(0);
    expect(result.lines[0].sub_total).toBeGreaterThanOrEqual(0);
  });

  it('reports every floor violation, not just the first', () => {
    const result = calculateOrderPricing(
      [
        {
          productId: 'aaaaaaaa-0000-4000-8000-000000000002',
          quantity: 1,
          discountType: 'percent',
          discountValue: 90,
        },
        {
          productId: 'aaaaaaaa-0000-4000-8000-000000000002',
          quantity: 2,
          discountType: 'percent',
          discountValue: 80,
        },
      ],
      FIXTURE_PRODUCTS,
      { hierarchyEnabled: false, enforcePriceFloor: true, customerLevel: null },
    );

    expect(result.floor_violations).toHaveLength(2);
    expect(result.valid).toBe(false);
    expect(result.floor_violations[0].min_price).toBe(80);
  });

  it('handles an unknown product id without throwing', () => {
    const result = calculateOrderPricing(
      [{ productId: 'ffffffff-0000-4000-8000-00000000ffff', quantity: 3 }],
      FIXTURE_PRODUCTS,
      { hierarchyEnabled: false, enforcePriceFloor: true, customerLevel: null },
    );

    expect(result.lines[0].product_name).toBe('Unknown product');
    expect(result.total_amount).toBe(0);
  });
});
