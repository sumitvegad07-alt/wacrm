import { describe, it, expect } from 'vitest';
import { productSummaryReportConfig } from '@/lib/reports/productSummaryReportConfig';
import { outstandingReportConfig } from '@/lib/reports/outstandingReportConfig';
import { getReportByModule } from '@/lib/reports/registry';
import { PERIOD_PRESETS } from '@/components/reports/report-filter-drawer';
import type { ReportDefinition } from '@/lib/reports/types';

/**
 * The two Summary Report modules. Spec:
 * docs/superpowers/specs/2026-10-19-summary-reports-design.md
 *
 * These configs carry invariants that are invisible at runtime: a mistyped
 * measure key is not an error, it is a column the engine silently drops and the
 * user never sees (report-engine.md §5i). Each one below is a rule the design
 * depends on, not a restatement of the config.
 */

/** Every key a tab asks for must be declared, or the viewer sends the engine a
 *  key it drops and the column quietly disappears. */
function assertTabKeysAreDeclared(config: ReportDefinition) {
  const measureKeys = new Set(config.measures.map((m) => m.key));
  const dimensionKeys = new Set(config.dimensions.map((d) => d.key));

  config.kpis.forEach((k) =>
    expect(measureKeys, `${config.moduleName} kpi ${k}`).toContain(k)
  );
  if (config.defaultChartMeasure) {
    expect(measureKeys, `${config.moduleName} defaultChartMeasure`).toContain(config.defaultChartMeasure);
  }

  config.tabConfigs?.forEach((tab) => {
    expect(dimensionKeys, `${config.moduleName}/${tab.key} dimension`).toContain(tab.dimension);
    (tab.extraDimensions ?? []).forEach((d) =>
      expect(dimensionKeys, `${config.moduleName}/${tab.key} extraDimension ${d}`).toContain(d)
    );
    [...tab.defaultMeasures, ...(tab.hiddenMeasures ?? []), ...(tab.availableMeasures ?? []), ...(tab.kpis ?? [])]
      .forEach((m) => expect(measureKeys, `${config.moduleName}/${tab.key} measure ${m}`).toContain(m));

    // A default column Manage Column cannot offer is a column the user can
    // switch off and never get back.
    if (tab.availableMeasures) {
      tab.defaultMeasures.forEach((m) =>
        expect(tab.availableMeasures, `${config.moduleName}/${tab.key} default ${m} not available`).toContain(m)
      );
    }
  });
}

describe('Summary reports — shared contract', () => {
  const configs = [productSummaryReportConfig, outstandingReportConfig];

  it.each(configs)('$moduleName declares every key its tabs use', (config) => {
    assertTabKeysAreDeclared(config);
  });

  it.each(configs)('$moduleName opens on a period the picker actually has', (config) => {
    // defaultPeriod is passed straight to getDatesForPeriod. An unknown value
    // yields no range, so the report opens unfiltered over all time instead of
    // the window the config intended.
    expect(PERIOD_PRESETS.map((p) => p.value)).toContain(config.defaultPeriod);
  });

  it.each(configs)('$moduleName is reachable from the registry', (config) => {
    // /print/report resolves a report by module string. A config missing here
    // prints an empty page rather than failing.
    expect(getReportByModule(config.moduleName)).toBe(config);
  });

  it('does not collide with the Order module it inherits from', () => {
    // Both alias to `order` in the engine, but a saved default view is keyed on
    // moduleName alone — sharing one would make two reports overwrite each
    // other's layout.
    const names = configs.map((c) => c.moduleName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain('order');
  });
});

describe('Product Summary', () => {
  it('shows a customer AND a product column on every breakdown tab', () => {
    // The entire reason this module exists. A breakdown tab that lost one of
    // the two would silently become a worse copy of the Order report.
    // `product_total` is the deliberate exception — see its own test below.
    const customerish = ['customer'];
    const productish = ['product', 'product_category'];

    productSummaryReportConfig.tabConfigs
      ?.filter((tab) => tab.key !== 'product_total')
      .forEach((tab) => {
        const shown = [tab.dimension, ...(tab.extraDimensions ?? [])];
        expect(shown.some((d) => customerish.includes(d)), `${tab.key} has no customer column`).toBe(true);
        expect(shown.some((d) => productish.includes(d)), `${tab.key} has no product column`).toBe(true);
      });
  });

  it('subtotals every breakdown tab, and only those', () => {
    // A subtotal is only meaningful where the primary dimension repeats down
    // the table. On Product total each row already IS the product's total, so
    // a subtotal line would duplicate every row.
    productSummaryReportConfig.tabConfigs?.forEach((tab) => {
      const isBreakdown = (tab.extraDimensions ?? []).length > 0;
      expect(Boolean(tab.showSubtotals), `${tab.key}`).toBe(isBreakdown);
    });
  });

  it('gives Product total one row per product and no customer column', () => {
    const tab = productSummaryReportConfig.tabConfigs?.find((t) => t.key === 'product_total');
    expect(tab).toBeDefined();
    expect(tab!.dimension).toBe('product');
    expect(tab!.extraDimensions ?? []).toHaveLength(0);
    // # of customer is the useful column here precisely because the customer
    // names are gone: it says how many bought it without listing them.
    expect(tab!.defaultMeasures).toContain('customer_count');
  });

  it('defaults to Quantity and Amount — the two columns that were asked for', () => {
    productSummaryReportConfig.tabConfigs?.forEach((tab) => {
      expect(tab.defaultMeasures, `${tab.key}`).toEqual(
        expect.arrayContaining(['product_quantity', 'net_amount'])
      );
    });
  });

  it('marks Avg Rate non-additive', () => {
    // A ratio: one row's rate added to another's means nothing, so the footer
    // must dash it rather than total it (§5e).
    const avg = productSummaryReportConfig.measures.find((m) => m.key === 'avg_rate');
    expect(avg?.additive).toBe(false);
  });

  it('offers no Sub-Category anywhere', () => {
    // `order.product_subcategory` is registered as COALESCE(p.category,
    // 'General') — identical to Category. This report does not inherit that
    // bug by simply never offering the dimension or the filter.
    const keys = [
      ...productSummaryReportConfig.dimensions.map((d) => d.key),
      ...productSummaryReportConfig.filters.map((f) => f.key),
    ];
    expect(keys).not.toContain('product_subcategory');
  });

  it('opens on today', () => {
    expect(productSummaryReportConfig.defaultPeriod).toBe('today');
  });
});

describe('Customer Outstanding', () => {
  const tabs = outstandingReportConfig.tabConfigs ?? [];

  it('keeps Customer Balance to the one grain where it is true', () => {
    // customer_balance is MAX(contacts.outstanding_balance) — one value per
    // customer. On an order-grain tab it repeats across a customer's rows; on
    // Area or User it reports the largest single debtor as the group's total.
    // Either way the footer lies.
    tabs.forEach((tab) => {
      const offered = tab.availableMeasures ?? outstandingReportConfig.measures.map((m) => m.key);
      if (tab.dimension === 'customer') {
        expect(offered, `${tab.key} should offer customer_balance`).toContain('customer_balance');
      } else {
        expect(offered, `${tab.key} must not offer customer_balance`).not.toContain('customer_balance');
      }
    });
  });

  it('puts the phone number next to the customer wherever a customer is named', () => {
    // The report's purpose is a callable list. A customer-grain tab without the
    // number sends the reader back to the Customers screen.
    tabs
      .filter((tab) => [tab.dimension, ...(tab.extraDimensions ?? [])].includes('customer'))
      .forEach((tab) => {
        const shown = [tab.dimension, ...(tab.extraDimensions ?? [])];
        expect(shown, `${tab.key} names a customer but shows no phone`).toContain('customer_phone');
      });
  });

  it('shows the order number and its date together on the order tab', () => {
    const orderTab = tabs.find((t) => t.dimension === 'order_number');
    expect(orderTab).toBeDefined();
    expect(orderTab!.extraDimensions).toEqual(expect.arrayContaining(['order_date', 'customer', 'customer_phone']));
    // `date` is TO_CHAR(base.date,'FMMonth YYYY') on the order module — a month
    // bucket, which would collapse a day's orders into "October 2026".
    expect(orderTab!.extraDimensions).not.toContain('date');
  });

  it('shows Outstanding on every tab', () => {
    tabs.forEach((tab) =>
      expect(tab.defaultMeasures, `${tab.key}`).toContain('outstanding_amount')
    );
  });

  it('opens on the order tab, over a window long enough to be a collections list', () => {
    expect(tabs[0].dimension).toBe('order_number');
    expect(outstandingReportConfig.defaultPeriod).toBe('last_365_days');
  });

  it('offers the only-unpaid filter as a plain yes/no', () => {
    // The registered predicate is a no-op unless the value is exactly 'yes'.
    const f = outstandingReportConfig.filters.find((x) => x.key === 'only_outstanding');
    expect(f?.type).toBe('select');
    expect(f?.options?.map((o) => o.value)).toEqual(['yes', 'no']);
  });
});
