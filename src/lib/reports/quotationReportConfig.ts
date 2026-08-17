import type { ReportDefinition } from './types';

/**
 * Quotation Report.
 *
 * Three things to know before editing this file (all enforced in migration
 * 20260817120000_quotation_report_module.sql):
 *
 * 1. Only the LATEST version of a quotation counts. A revision leaves the old row
 *    with is_latest_version = false; the engine hard-wires that predicate so a
 *    quotation revised twice is still one quotation.
 *
 * 2. A quotation belongs to a LEAD or a CUSTOMER, never both. The Lead and
 *    Customer tabs inner-join their own entity, so each lists only its own
 *    quotations rather than lumping the other side into a blank row. Geography
 *    (state/city/territory) falls back from customer to lead, so lead quotations
 *    still appear on the Area tab — except Area itself, which only customers have.
 *
 * 3. Item-level tabs use DIFFERENT measure keys. Grouping by product joins
 *    quotation_items, which would duplicate any quotation-level SUM once per line
 *    (the fan-out in docs/report-engine.md §5). The product/category/sub-category
 *    tabs therefore use the item_* twins — same labels, per-line arithmetic — and
 *    `availableMeasures` keeps the wrong twin out of Manage Column on each tab.
 *    Never add a quotation-level amount to an item-level tab; the totals will lie.
 */

/** Lead and Customer: the party is the subject, so counting parties is redundant. */
const PARTY_COLUMNS = [
  'quotation_count',
  'product_count',
  'product_quantity',
  'gross_amount',
  'net_amount',
] as const;

/** User / Area / Period: add reach — how many distinct customers and leads. */
const ROLLUP_COLUMNS = [
  'quotation_count',
  'product_count',
  'customer_count',
  'lead_count',
  'product_quantity',
  'gross_amount',
  'net_amount',
] as const;

/** Product / Category / Sub-Category: the item-level twins of ROLLUP_COLUMNS. */
const ITEM_COLUMNS = [
  'quotation_count',
  'item_product_count',
  'customer_count',
  'lead_count',
  'item_product_quantity',
  'item_gross_amount',
  'item_net_amount',
] as const;

const RECORD_LEVEL_MEASURES = [
  ...ROLLUP_COLUMNS,
  'tax_amount',
];

const ITEM_LEVEL_MEASURES = [
  ...ITEM_COLUMNS,
  'avg_price',
];

export const quotationReportConfig: ReportDefinition = {
  moduleName: 'quotation',
  label: 'Quotation Reports',
  requiredModule: 'quotations',

  dimensions: [
    { key: 'lead', label: 'Lead', category: 'customer' },
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' },
    { key: 'status', label: 'Status', category: 'customer' },
    { key: 'product', label: 'Product', category: 'product' },
    { key: 'product_category', label: 'Product Category', category: 'product' },
    { key: 'product_subcategory', label: 'Product Sub-Category', category: 'product' },
  ],

  measures: [
    { key: 'quotation_count', label: '# of quotation', type: 'number' },
    { key: 'product_count', label: '# of product', type: 'number' },
    { key: 'customer_count', label: '# of customer', type: 'number' },
    { key: 'lead_count', label: '# of lead', type: 'number' },
    { key: 'product_quantity', label: 'Quantity', type: 'number' },
    { key: 'gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'net_amount', label: 'Amount', type: 'currency' },
    { key: 'tax_amount', label: 'Tax Amount', type: 'currency' },
    // Item-level twins. Same labels on purpose — the column reads the same to the
    // user; `availableMeasures` decides which one a given tab may use.
    { key: 'item_product_count', label: '# of product', type: 'number' },
    { key: 'item_product_quantity', label: 'Quantity', type: 'number' },
    { key: 'item_gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'item_net_amount', label: 'Amount', type: 'currency' },
    { key: 'avg_price', label: 'Avg Price', type: 'currency' },
  ],

  kpis: ['net_amount', 'gross_amount', 'quotation_count'],

  // Lead is listed first because that is the pipeline order, but almost every
  // quotation is raised against an existing customer — opening on Lead showed an
  // empty table on a healthy report.
  defaultTab: 'customer',

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'status', label: 'Status', type: 'select', section: 'QUOTATION', options: [
      { label: 'Draft', value: 'Draft' },
      { label: 'Pending', value: 'Pending' },
      { label: 'Sent', value: 'Sent' },
      { label: 'Approved', value: 'Approved' },
      { label: 'Accepted', value: 'Accepted' },
      { label: 'Rejected', value: 'Rejected' },
    ]},
    { key: 'party_type', label: 'Raised For', type: 'select', section: 'QUOTATION', options: [
      { label: 'Lead', value: 'lead' },
      { label: 'Customer', value: 'customer' },
    ]},
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Quoted by', type: 'user', section: 'USER' },
    { key: 'lead', label: 'Lead', type: 'lead', section: 'LEAD' },
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
    { key: 'product', label: 'Product', type: 'product', section: 'PRODUCT' },
    { key: 'product_category', label: 'Category', type: 'select', section: 'PRODUCT' },
    { key: 'product_subcategory', label: 'Sub-Category', type: 'select', section: 'PRODUCT' },
  ],

  tabConfigs: [
    {
      key: 'lead',
      label: 'Lead',
      dimension: 'lead',
      defaultMeasures: [...PARTY_COLUMNS],
      availableMeasures: RECORD_LEVEL_MEASURES,
    },
    {
      key: 'customer',
      label: 'Customer',
      dimension: 'customer',
      defaultMeasures: [...PARTY_COLUMNS],
      availableMeasures: RECORD_LEVEL_MEASURES,
    },
    {
      key: 'user',
      label: 'User',
      dimension: 'user',
      defaultMeasures: [...ROLLUP_COLUMNS],
      availableMeasures: RECORD_LEVEL_MEASURES,
    },
    {
      key: 'area',
      label: 'Area',
      dimension: 'area',
      defaultMeasures: [...ROLLUP_COLUMNS],
      availableMeasures: RECORD_LEVEL_MEASURES,
    },
    {
      key: 'time',
      label: 'Period',
      dimension: 'date',
      defaultMeasures: [...ROLLUP_COLUMNS],
      availableMeasures: RECORD_LEVEL_MEASURES,
    },
    {
      key: 'product',
      label: 'Product',
      dimension: 'product',
      // The one extra column the Product tab adds over User/Area/Period.
      extraDimensions: ['product_category'],
      defaultMeasures: [...ITEM_COLUMNS],
      availableMeasures: ITEM_LEVEL_MEASURES,
    },
    {
      key: 'product_category',
      label: 'Product Category',
      dimension: 'product_category',
      defaultMeasures: [...ITEM_COLUMNS],
      availableMeasures: ITEM_LEVEL_MEASURES,
      requiresProductSettings: 'category',
    },
    {
      key: 'product_subcategory',
      label: 'Product Sub-Category',
      dimension: 'product_subcategory',
      defaultMeasures: [...ITEM_COLUMNS],
      availableMeasures: ITEM_LEVEL_MEASURES,
      requiresProductSettings: 'subcategory',
    },
  ],
};
