import { describe, it, expect } from 'vitest';
import type { ReportFilterDef } from '@/lib/reports/types';
import type { TerritoryLevel } from '@/lib/territories/types';

function isFilterVisible(
  filterDef: ReportFilterDef,
  customerHierarchyEnabled: boolean,
  productLevelsCount: number,
  territoryLevels: TerritoryLevel[]
): boolean {
  if (['sales_type', 'customer_type', 'user_role', 'hierarchy_level'].includes(filterDef.key)) {
    if (!customerHierarchyEnabled) return false;
  }

  if (filterDef.key === 'product_category' && productLevelsCount < 1) {
    return false;
  }
  if (filterDef.key === 'product_subcategory' && productLevelsCount < 2) {
    return false;
  }

  if (filterDef.type === 'territory' && filterDef.territoryLevel) {
    if (territoryLevels.length > 0) {
      const levelConfig = territoryLevels.find(l => l.position === filterDef.territoryLevel);
      if (levelConfig && levelConfig.enabled === false) {
        return false;
      }
    }
  }

  return true;
}

describe('Hierarchy & Configuration Visibility Suite', () => {
  it('hides customer hierarchy filters when customer hierarchy is disabled', () => {
    const filterDef: ReportFilterDef = { key: 'sales_type', label: 'Sales Type', type: 'select' };
    expect(isFilterVisible(filterDef, false, 3, [])).toBe(false);
  });

  it('shows customer hierarchy filters when customer hierarchy is enabled', () => {
    const filterDef: ReportFilterDef = { key: 'sales_type', label: 'Sales Type', type: 'select' };
    expect(isFilterVisible(filterDef, true, 3, [])).toBe(true);
  });

  it('hides product category and subcategory when product levels count is 0', () => {
    const catDef: ReportFilterDef = { key: 'product_category', label: 'Category', type: 'select' };
    const subcatDef: ReportFilterDef = { key: 'product_subcategory', label: 'Sub-Category', type: 'select' };

    expect(isFilterVisible(catDef, true, 0, [])).toBe(false);
    expect(isFilterVisible(subcatDef, true, 0, [])).toBe(false);
  });

  it('shows product category but hides subcategory when product levels count is 1', () => {
    const catDef: ReportFilterDef = { key: 'product_category', label: 'Category', type: 'select' };
    const subcatDef: ReportFilterDef = { key: 'product_subcategory', label: 'Sub-Category', type: 'select' };

    expect(isFilterVisible(catDef, true, 1, [])).toBe(true);
    expect(isFilterVisible(subcatDef, true, 1, [])).toBe(false);
  });

  it('shows both product category and subcategory when product levels count is >= 2', () => {
    const catDef: ReportFilterDef = { key: 'product_category', label: 'Category', type: 'select' };
    const subcatDef: ReportFilterDef = { key: 'product_subcategory', label: 'Sub-Category', type: 'select' };

    expect(isFilterVisible(catDef, true, 2, [])).toBe(true);
    expect(isFilterVisible(subcatDef, true, 2, [])).toBe(true);
  });
});
