/**
 * Subtotal rows for a report table whose grain is two dimensions deep.
 *
 * Added 2026-10-19 for Product Summary, which reads "customer / product /
 * quantity / amount" and is only useful if you can also see what ONE product
 * came to across every customer who bought it.
 *
 * Deliberately opt-in per tab (`TabConfig.showSubtotals`) rather than automatic
 * on any two-dimension table. Customer Outstanding's Order tab also shows four
 * dimension columns, but its first one is the order number — every group would
 * hold exactly one row, and every row would be followed by a subtotal repeating
 * it.
 *
 * Two rules worth knowing:
 *
 *  - Rows are grouped by VALUE, not by adjacency, and the groups come back in
 *    the order their first row appears. So sorting by Amount still works: it
 *    decides which product leads the table and the order of customers inside
 *    each product, and the product's rows stay together instead of scattering
 *    down the page, which is what makes a subtotal mean anything.
 *  - Every group gets a subtotal, including a group of one. The reader is
 *    scanning for "what did this product come to"; omitting it on the products
 *    that only one customer bought is exactly the case where they would hunt
 *    for a line that is not there.
 */

export interface SubtotalGroup {
  /** The first dimension's value, as shown in the table. */
  groupKey: string;
  rows: Record<string, unknown>[];
  /** Per measure key. A measure that must not be summed is absent, not zero. */
  subtotals: Record<string, number>;
}

export interface SubtotalMeasure {
  key: string;
  /** False for ratios and other figures a column of which does not add up. */
  additive: boolean;
}

/**
 * Group `rows` by the value of `groupBy`, summing each additive measure.
 *
 * Returns an empty array when there is nothing to group by, so a caller can
 * fall back to a plain table without a special case.
 */
export function groupRowsForSubtotals(
  rows: Record<string, unknown>[],
  groupBy: string | undefined,
  measures: SubtotalMeasure[],
): SubtotalGroup[] {
  if (!groupBy || rows.length === 0) return [];

  const order: string[] = [];
  const byKey = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    // A null dimension prints as '-' in the table; group it under the same
    // label so the subtotal lines up with what the reader sees.
    const raw = row[groupBy];
    const key = raw === null || raw === undefined || raw === '' ? '-' : String(raw);
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(row);
  }

  return order.map((groupKey) => {
    const groupRows = byKey.get(groupKey)!;
    const subtotals: Record<string, number> = {};
    for (const measure of measures) {
      if (!measure.additive) continue;
      subtotals[measure.key] = groupRows.reduce(
        (sum, row) => sum + (Number(row[measure.key]) || 0),
        0,
      );
    }
    return { groupKey, rows: groupRows, subtotals };
  });
}
