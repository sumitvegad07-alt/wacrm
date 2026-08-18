import { describe, it, expect } from 'vitest';
import { visitReportConfig } from '@/lib/reports/visitReportConfig';
import { ageingReportConfig } from '@/lib/reports/ageingReportConfig';
import type { ReportDefinition } from '@/lib/reports/types';

/** Every measure/dimension a tab asks for must exist in the report definition,
 *  or the viewer sends the engine a key it will silently drop and the column
 *  quietly disappears. */
function assertTabKeysAreDeclared(config: ReportDefinition) {
  const measureKeys = new Set(config.measures.map((m) => m.key));
  const dimensionKeys = new Set(config.dimensions.map((d) => d.key));

  config.tabConfigs?.forEach((tab) => {
    expect(dimensionKeys, `${config.moduleName}/${tab.key} dimension`).toContain(tab.dimension);
    [...(tab.extraDimensions ?? [])].forEach((d) =>
      expect(dimensionKeys, `${config.moduleName}/${tab.key} extraDimension ${d}`).toContain(d)
    );
    [...tab.defaultMeasures, ...(tab.availableMeasures ?? []), ...(tab.kpis ?? [])].forEach((m) =>
      expect(measureKeys, `${config.moduleName}/${tab.key} measure ${m}`).toContain(m)
    );
    // A default column that Manage Column cannot offer is a column the user can
    // switch off and never get back.
    if (tab.availableMeasures) {
      tab.defaultMeasures.forEach((m) =>
        expect(tab.availableMeasures, `${config.moduleName}/${tab.key} default ${m} not available`).toContain(m)
      );
    }
  });
}

describe('Visit report', () => {
  it('declares every key its tabs use', () => {
    assertTabKeysAreDeclared(visitReportConfig);
  });

  it('carries the full feedback pivot on every tab', () => {
    // The five buckets are mutually exclusive and sum to # visit. Dropping one
    // from a tab breaks that reconciliation silently — the row still adds up to
    // something, just not to the visit count.
    const pivot = [
      'feedback_excellent',
      'feedback_good',
      'feedback_average',
      'feedback_poor',
      'feedback_none',
    ];
    visitReportConfig.tabConfigs?.forEach((tab) => {
      pivot.forEach((key) =>
        expect(tab.defaultMeasures, `${tab.key} is missing ${key}`).toContain(key)
      );
      expect(tab.defaultMeasures, `${tab.key} is missing # visit`).toContain('visit_count');
    });
  });

  it('splits visits by target on the rollup tabs only', () => {
    const byTab = new Map(visitReportConfig.tabConfigs!.map((t) => [t.key, t.defaultMeasures]));

    // # customer visit + # lead visit = # visit, so both belong together or not
    // at all. They are meaningless on a tab that is already one or the other.
    ['area', 'time', 'user'].forEach((key) => {
      expect(byTab.get(key)).toContain('customer_visit_count');
      expect(byTab.get(key)).toContain('lead_visit_count');
    });
    ['customer', 'lead'].forEach((key) => {
      expect(byTab.get(key)).not.toContain('customer_visit_count');
      expect(byTab.get(key)).not.toContain('lead_visit_count');
    });

    // Orders are raised against customers, so productivity is not a lead column.
    expect(byTab.get('customer')).toContain('productive_visit_count');
    expect(byTab.get('lead')).not.toContain('productive_visit_count');
  });

  it('registers the productivity ratio as a percent so it is never summed', () => {
    const ratio = visitReportConfig.measures.find((m) => m.key === 'productivity_ratio');
    expect(ratio?.type).toBe('percent');
  });
});

describe('Ageing report', () => {
  it('declares every key its tabs use', () => {
    assertTabKeysAreDeclared(ageingReportConfig);
  });

  it('routes the product tabs at the products base table and the rest at contacts', () => {
    const byTab = new Map(ageingReportConfig.tabConfigs!.map((t) => [t.key, t]));

    // Ageing lists records with NO orders, so the base table is the master being
    // listed. contacts cannot enumerate products, hence the override.
    ['product', 'product_category', 'product_subcategory'].forEach((key) =>
      expect(byTab.get(key)?.moduleOverride, `${key} must query ageing_product`).toBe('ageing_product')
    );
    ['customer', 'area'].forEach((key) =>
      expect(byTab.get(key)?.moduleOverride, `${key} must use the report's own module`).toBeUndefined()
    );
  });

  it('never offers a measure the tab\'s base table cannot answer', () => {
    const byTab = new Map(ageingReportConfig.tabConfigs!.map((t) => [t.key, t]));

    ['product', 'product_category', 'product_subcategory'].forEach((key) => {
      expect(byTab.get(key)?.availableMeasures).not.toContain('customer_count');
      expect(byTab.get(key)?.kpis).not.toContain('customer_count');
    });
    ['customer', 'area'].forEach((key) => {
      expect(byTab.get(key)?.availableMeasures).not.toContain('product_count');
    });
  });

  it('marks Days Since Last Order non-additive so the footer will not sum ages', () => {
    const days = ageingReportConfig.measures.find((m) => m.key === 'days_since_last_order');
    expect(days?.additive).toBe(false);
  });

  it('gates the category tabs on the account\'s product hierarchy depth', () => {
    const byTab = new Map(ageingReportConfig.tabConfigs!.map((t) => [t.key, t]));
    expect(byTab.get('product_category')?.requiresProductSettings).toBe('category');
    expect(byTab.get('product_subcategory')?.requiresProductSettings).toBe('subcategory');
  });
});
