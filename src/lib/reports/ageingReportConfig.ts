import type { ReportDefinition } from './types';

/**
 * Ageing Report — who and what stopped ordering.
 *
 * This report inverts the engine. Every other module aggregates rows that exist;
 * Ageing lists master records for which NO order row exists in the chosen window.
 * So "Period" does not mean "orders placed between these dates" — it means "had
 * no order between these dates", and the dates live inside a NOT EXISTS rather
 * than filtering the base table. Widening the period therefore SHRINKS the list.
 *
 * Because the thing being listed is the master record, the base table is the
 * master: `contacts` for Customer / Area, `products` for Product / Category /
 * Sub-Category. Tabs cannot switch base tables, so the product tabs carry
 * `moduleOverride: 'ageing_product'` and the viewer executes against that module
 * (see TabConfig.moduleOverride). One report, two registry modules.
 *
 * Last Order Date, Days Since Last Order and # lifetime order come from an
 * UNBOUNDED lookback — "when did they last order" is a lifetime question even
 * when the dormancy window is one month — and are what make the list actionable
 * rather than a bare list of names. Days Since is marked non-additive: a column
 * of ages does not add up, so the footer dashes it.
 *
 * Registered in migration 20260818090000_visit_and_ageing_report_modules.sql.
 */

/** What a dormant record is worth knowing: how long, and how much history. */
const DORMANCY_COLUMNS = ['days_since_last_order', 'lifetime_order_count'] as const;

/** Rollup tabs count records rather than showing one record's age. */
const ROLLUP_CUSTOMER = ['customer_count', 'never_ordered_count', 'days_since_last_order'] as const;
const ROLLUP_PRODUCT = ['product_count', 'never_ordered_count', 'days_since_last_order'] as const;

/** Measures each base table can actually answer. `contacts` cannot count
 *  products and `products` cannot count customers, so Manage Column has to be
 *  narrowed per tab or it would offer a column the engine drops. */
const CUSTOMER_MEASURES = ['customer_count', 'never_ordered_count', ...DORMANCY_COLUMNS] as const;
const PRODUCT_MEASURES = ['product_count', 'never_ordered_count', ...DORMANCY_COLUMNS] as const;

export const ageingReportConfig: ReportDefinition = {
  moduleName: 'ageing',
  label: 'Ageing Reports',
  requiredModule: 'orders',

  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'customer_type', label: 'Customer Type', category: 'customer' },
    { key: 'last_order_date', label: 'Last Order Date', category: 'time' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'product', label: 'Product', category: 'product' },
    { key: 'product_category', label: 'Product Category', category: 'product' },
    { key: 'product_subcategory', label: 'Product Sub-Category', category: 'product' },
  ],

  measures: [
    { key: 'customer_count', label: '# customer', type: 'number' },
    { key: 'product_count', label: '# product', type: 'number' },
    { key: 'never_ordered_count', label: '# never ordered', type: 'number' },
    // An age per row. Summing a column of ages is meaningless, so the footer
    // shows a dash instead of a total.
    { key: 'days_since_last_order', label: 'Days Since Last Order', type: 'number', additive: false },
    { key: 'lifetime_order_count', label: '# lifetime order', type: 'number' },
  ],

  kpis: ['customer_count', 'never_ordered_count'],

  filters: [
    // Reads as "no order in this window" — see the file header.
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Owned by', type: 'user', section: 'USER' },
    // Product filters only bite on the product tabs; the engine drops a filter a
    // module does not register, so they are inert (not wrong) elsewhere.
    { key: 'product', label: 'Product', type: 'product', section: 'PRODUCT' },
    {
      key: 'product_status',
      label: 'Product Status',
      type: 'select',
      section: 'PRODUCT',
      options: [
        { label: 'Active only', value: 'active' },
        { label: 'Inactive only', value: 'inactive' },
      ],
    },
  ],

  tabConfigs: [
    {
      key: 'customer',
      label: 'Customer',
      dimension: 'customer',
      // One row per customer, so the age columns are that customer's own figures.
      extraDimensions: ['last_order_date'],
      defaultMeasures: [...DORMANCY_COLUMNS],
      availableMeasures: [...CUSTOMER_MEASURES],
    },
    {
      key: 'area',
      label: 'Area',
      dimension: 'area',
      defaultMeasures: [...ROLLUP_CUSTOMER],
      availableMeasures: [...CUSTOMER_MEASURES],
    },
    {
      key: 'product',
      label: 'Product',
      dimension: 'product',
      moduleOverride: 'ageing_product',
      extraDimensions: ['last_order_date'],
      defaultMeasures: [...DORMANCY_COLUMNS],
      availableMeasures: [...PRODUCT_MEASURES],
      kpis: ['product_count', 'never_ordered_count'],
    },
    {
      key: 'product_category',
      label: 'Product Category',
      dimension: 'product_category',
      moduleOverride: 'ageing_product',
      requiresProductSettings: 'category',
      defaultMeasures: [...ROLLUP_PRODUCT],
      availableMeasures: [...PRODUCT_MEASURES],
      kpis: ['product_count', 'never_ordered_count'],
    },
    {
      key: 'product_subcategory',
      label: 'Product Sub-Category',
      dimension: 'product_subcategory',
      moduleOverride: 'ageing_product',
      requiresProductSettings: 'subcategory',
      defaultMeasures: [...ROLLUP_PRODUCT],
      availableMeasures: [...PRODUCT_MEASURES],
      kpis: ['product_count', 'never_ordered_count'],
    },
  ],
};
