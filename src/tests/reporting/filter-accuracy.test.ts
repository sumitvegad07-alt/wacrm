import { describe, it, expect } from 'vitest';
import { orderReportConfig } from '@/lib/reports/orderReportConfig';

describe('Filter Accuracy Suite - General Requirements', () => {
  it('should have order module registered with dimensions and measures', () => {
    expect(orderReportConfig.moduleName).toBe('order');
    expect(orderReportConfig.dimensions.length).toBeGreaterThan(0);
    expect(orderReportConfig.measures.length).toBeGreaterThan(0);
  });

  it('should contain all required measures (gross_amount, net_amount, discount_amount, tax_amount, order_count, product_quantity)', () => {
    const measureKeys = orderReportConfig.measures.map(m => m.key);
    expect(measureKeys).toContain('gross_amount');
    expect(measureKeys).toContain('net_amount');
    expect(measureKeys).toContain('discount_amount');
    expect(measureKeys).toContain('tax_amount');
    expect(measureKeys).toContain('order_count');
    expect(measureKeys).toContain('product_quantity');
  });

  it('should contain tabConfigs mapping for customer, user, area, time, product, product_category, product_subcategory', () => {
    expect(orderReportConfig.tabConfigs).toBeDefined();
    const tabKeys = orderReportConfig.tabConfigs!.map(t => t.key);
    expect(tabKeys).toContain('customer');
    expect(tabKeys).toContain('user');
    expect(tabKeys).toContain('area');
    expect(tabKeys).toContain('time');
    expect(tabKeys).toContain('product');
    expect(tabKeys).toContain('product_category');
    expect(tabKeys).toContain('product_subcategory');
  });
});
