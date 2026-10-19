import { describe, it, expect } from 'vitest';
import { groupRowsForSubtotals } from '@/lib/reports/subtotals';

const MEASURES = [
  { key: 'product_quantity', additive: true },
  { key: 'net_amount', additive: true },
  { key: 'avg_rate', additive: false },
];

/** The founder's own example: one product, three customers, one total. */
const TOOTHBRUSH_ROWS = [
  { product: 'Toothbrush', customer: 'Balaji Enterprise', product_quantity: 50, net_amount: 1000, avg_rate: 20 },
  { product: 'Toothbrush', customer: 'Kanta Enterprise', product_quantity: 20, net_amount: 500, avg_rate: 25 },
  { product: 'Toothbrush', customer: 'Ramesh Stores', product_quantity: 190, net_amount: 3800, avg_rate: 20 },
];

describe('groupRowsForSubtotals', () => {
  it('totals one product across its customers', () => {
    const groups = groupRowsForSubtotals(TOOTHBRUSH_ROWS, 'product', MEASURES);

    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe('Toothbrush');
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[0].subtotals.product_quantity).toBe(260);
    expect(groups[0].subtotals.net_amount).toBe(5300);
  });

  it('leaves a non-additive measure out of the subtotal entirely', () => {
    // Absent, not zero: the table renders a dash for a missing key, and a 0
    // would read as "this product sold at ₹0 a piece".
    const groups = groupRowsForSubtotals(TOOTHBRUSH_ROWS, 'product', MEASURES);
    expect('avg_rate' in groups[0].subtotals).toBe(false);
  });

  it('keeps a product together even when the sort scatters its rows', () => {
    // Sorting by Amount interleaves products. Grouping by value rather than by
    // adjacency is what stops one product producing three separate subtotals.
    const scattered = [
      { product: 'Soap', customer: 'A', product_quantity: 5, net_amount: 500, avg_rate: 100 },
      { product: 'Toothbrush', customer: 'B', product_quantity: 50, net_amount: 400, avg_rate: 8 },
      { product: 'Soap', customer: 'C', product_quantity: 2, net_amount: 300, avg_rate: 150 },
      { product: 'Toothbrush', customer: 'D', product_quantity: 10, net_amount: 100, avg_rate: 10 },
    ];

    const groups = groupRowsForSubtotals(scattered, 'product', MEASURES);

    expect(groups.map((g) => g.groupKey)).toEqual(['Soap', 'Toothbrush']);
    expect(groups[0].subtotals.product_quantity).toBe(7);
    expect(groups[1].subtotals.product_quantity).toBe(60);
    // Row order inside a group is the order the sort produced.
    expect(groups[1].rows.map((r) => r.customer)).toEqual(['B', 'D']);
  });

  it('orders groups by where each one first appears, not alphabetically', () => {
    // The sort the user picked decides which product leads the table; the
    // grouping must not quietly re-sort it.
    const rows = [
      { product: 'Zinc', customer: 'A', product_quantity: 9, net_amount: 90, avg_rate: 10 },
      { product: 'Apple', customer: 'B', product_quantity: 1, net_amount: 10, avg_rate: 10 },
    ];
    expect(groupRowsForSubtotals(rows, 'product', MEASURES).map((g) => g.groupKey))
      .toEqual(['Zinc', 'Apple']);
  });

  it('subtotals a group of one, rather than skipping it', () => {
    // The reader is scanning for "what did this product come to". A product
    // only one customer bought is exactly where a missing line costs them time.
    const groups = groupRowsForSubtotals(
      [{ product: 'Comb', customer: 'A', product_quantity: 3, net_amount: 60, avg_rate: 20 }],
      'product', MEASURES,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].subtotals.product_quantity).toBe(3);
  });

  it('groups blanks under the dash the table already shows', () => {
    const rows = [
      { product: null, customer: 'A', product_quantity: 2, net_amount: 20, avg_rate: 10 },
      { product: '', customer: 'B', product_quantity: 3, net_amount: 30, avg_rate: 10 },
    ];
    const groups = groupRowsForSubtotals(rows, 'product', MEASURES);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe('-');
    expect(groups[0].subtotals.product_quantity).toBe(5);
  });

  it('treats a missing measure value as zero, not NaN', () => {
    const rows = [
      { product: 'Soap', customer: 'A', product_quantity: 5, net_amount: 500, avg_rate: 100 },
      { product: 'Soap', customer: 'B', net_amount: null, avg_rate: 0 },
    ];
    const groups = groupRowsForSubtotals(rows, 'product', MEASURES);
    expect(groups[0].subtotals.product_quantity).toBe(5);
    expect(groups[0].subtotals.net_amount).toBe(500);
  });

  it('returns nothing to group when there is no group column or no rows', () => {
    expect(groupRowsForSubtotals(TOOTHBRUSH_ROWS, undefined, MEASURES)).toEqual([]);
    expect(groupRowsForSubtotals([], 'product', MEASURES)).toEqual([]);
  });

  it('the subtotals add up to the grand total', () => {
    // The reconciliation that makes the feature trustworthy: every row is in
    // exactly one group, so the subtotals must sum to what the footer shows.
    const rows = [...TOOTHBRUSH_ROWS,
      { product: 'Soap', customer: 'Balaji Enterprise', product_quantity: 35, net_amount: 700, avg_rate: 20 },
      { product: 'Soap', customer: 'Kanta Enterprise', product_quantity: 15, net_amount: 300, avg_rate: 20 },
    ];
    const groups = groupRowsForSubtotals(rows, 'product', MEASURES);
    const fromGroups = groups.reduce((s, g) => s + g.subtotals.product_quantity, 0);
    const grandTotal = rows.reduce((s, r) => s + (Number(r.product_quantity) || 0), 0);

    expect(fromGroups).toBe(grandTotal);
    expect(groups.reduce((s, g) => s + g.rows.length, 0)).toBe(rows.length);
  });
});
