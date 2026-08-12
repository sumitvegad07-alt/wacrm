import { describe, it, expect } from 'vitest';
import { orderReportConfig } from '@/lib/reports/orderReportConfig';

describe('Product Filter Configuration Suite', () => {
  it('defines product, category, and subcategory filters under PRODUCT section', () => {
    const prodFilter = orderReportConfig.filters.find(f => f.key === 'product');
    const catFilter = orderReportConfig.filters.find(f => f.key === 'product_category');
    const subcatFilter = orderReportConfig.filters.find(f => f.key === 'product_subcategory');

    expect(prodFilter).toBeDefined();
    expect(catFilter).toBeDefined();
    expect(subcatFilter).toBeDefined();

    expect(prodFilter?.section).toBe('PRODUCT');
    expect(catFilter?.section).toBe('PRODUCT');
    expect(subcatFilter?.section).toBe('PRODUCT');
  });

  it('configures product tab with avg_price measure', () => {
    const productTab = orderReportConfig.tabConfigs?.find(t => t.key === 'product');
    expect(productTab).toBeDefined();
    expect(productTab?.defaultMeasures).toContain('avg_price');
  });
});
