import { describe, it, expect } from 'vitest';
import { orderReportConfig } from '@/lib/reports/orderReportConfig';

describe('Customer Filter Configuration Suite', () => {
  it('defines customer filter with type customer in CUSTOMER section', () => {
    const custFilter = orderReportConfig.filters.find(f => f.key === 'customer');
    expect(custFilter).toBeDefined();
    expect(custFilter?.type).toBe('customer');
    expect(custFilter?.section).toBe('CUSTOMER');
  });

  it('configures customer tab with order_count, product_quantity, product_count, gross_amount, net_amount', () => {
    const customerTab = orderReportConfig.tabConfigs?.find(t => t.key === 'customer');
    expect(customerTab).toBeDefined();
    expect(customerTab?.defaultMeasures).toContain('order_count');
    expect(customerTab?.defaultMeasures).toContain('product_quantity');
    expect(customerTab?.defaultMeasures).toContain('product_count');
    expect(customerTab?.defaultMeasures).toContain('gross_amount');
    expect(customerTab?.defaultMeasures).toContain('net_amount');
  });
});
