import { describe, it, expect } from 'vitest';
import { orderReportConfig } from '@/lib/reports/orderReportConfig';

/** The product-grain tabs carry the money as the item-level twin instead, because
 *  grouping by a product column joins order_items and an order-level SUM repeats
 *  once per line (report-engine.md §5). See order-sales-item-grain.test.ts. */
const MONEY_ON_TAB: Record<string, [string, string]> = {
  product: ['item_gross_amount', 'item_net_amount'],
  product_category: ['item_gross_amount', 'item_net_amount'],
  product_subcategory: ['item_gross_amount', 'item_net_amount'],
};

describe('Report Total Reconciliation Spec Suite', () => {
  it('ensures KPI measure keys match default measures across dimensions', () => {
    const kpiKeys = orderReportConfig.kpis;
    expect(kpiKeys).toContain('net_amount');
    expect(kpiKeys).toContain('gross_amount');
    expect(kpiKeys).toContain('order_count');

    // Each default tab must show a Sub Amount, an Amount and an order count, so
    // its totals reconcile 1:1 — but in the arithmetic correct for ITS grain.
    orderReportConfig.tabConfigs?.forEach(tab => {
      const [gross, net] = MONEY_ON_TAB[tab.dimension] ?? ['gross_amount', 'net_amount'];
      expect(tab.defaultMeasures, `${tab.key} ${gross}`).toContain(gross);
      expect(tab.defaultMeasures, `${tab.key} ${net}`).toContain(net);
      expect(tab.defaultMeasures, `${tab.key} order_count`).toContain('order_count');
    });
  });
});
