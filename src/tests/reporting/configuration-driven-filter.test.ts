import { describe, it, expect } from 'vitest';
import { orderReportConfig } from '@/lib/reports/orderReportConfig';

describe('Configuration Driven Filter Spec Suite', () => {
  it('has tabConfigs defined with requiresProductSettings constraints', () => {
    const categoryTab = orderReportConfig.tabConfigs?.find(t => t.key === 'product_category');
    const subcategoryTab = orderReportConfig.tabConfigs?.find(t => t.key === 'product_subcategory');

    expect(categoryTab?.requiresProductSettings).toBe('category');
    expect(subcategoryTab?.requiresProductSettings).toBe('subcategory');
  });

  it('contains territoryLevel metadata for all territory filters', () => {
    const territoryFilters = orderReportConfig.filters.filter(f => f.type === 'territory');
    expect(territoryFilters.length).toBeGreaterThan(0);
    territoryFilters.forEach(f => {
      expect(f.territoryLevel).toBeGreaterThan(0);
    });
  });
});
