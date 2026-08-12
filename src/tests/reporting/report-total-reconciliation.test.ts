import { describe, it, expect } from 'vitest';
import { orderReportConfig } from '@/lib/reports/orderReportConfig';

describe('Report Total Reconciliation Spec Suite', () => {
  it('ensures KPI measure keys match default measures across dimensions', () => {
    const kpiKeys = orderReportConfig.kpis;
    expect(kpiKeys).toContain('net_amount');
    expect(kpiKeys).toContain('gross_amount');
    expect(kpiKeys).toContain('order_count');

    // Each default tab must include the core KPI financial measures so totals reconcile 1:1
    orderReportConfig.tabConfigs?.forEach(tab => {
      expect(tab.defaultMeasures).toContain('gross_amount');
      expect(tab.defaultMeasures).toContain('net_amount');
      expect(tab.defaultMeasures).toContain('order_count');
    });
  });
});
