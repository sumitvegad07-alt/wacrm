import type { ReportDefinition } from './types';

/**
 * Deal Report.
 *
 * Follows the same three rules as the Quotation report (see
 * quotationReportConfig.ts and docs/report-engine.md §5b–5d):
 *
 * 1. A deal belongs to a LEAD or a CUSTOMER (`deals.deal_for` says which). The
 *    Lead and Customer tabs inner-join their own entity so each lists only its
 *    own deals.
 * 2. Item-level tabs use the item_* measure twins. Grouping by product joins
 *    deal_items, which would duplicate any deal-level sum once per line;
 *    `availableMeasures` keeps the wrong twin out of Manage Column.
 * 3. Amounts: `deals.value` is the header amount and matches the sum of item
 *    totals whenever items exist, so Amount reads `value` at deal level and
 *    SUM(item total) at item level. Sub Amount has no header column at all — it
 *    always comes from the items, so a deal entered as a lump sum with no line
 *    items contributes to Amount but not Sub Amount.
 *
 * Pipeline stage names repeat across pipelines, so the Stage tab shows them
 * qualified as "Pipeline / Stage". Registered in migration
 * 20260817150000_lead_and_deal_report_modules.sql.
 */

/** Lead and Customer: the party is the subject, so counting parties is redundant. */
const PARTY_COLUMNS = [
  'deal_count',
  'product_count',
  'product_quantity',
  'gross_amount',
  'net_amount',
] as const;

/** User / Area / Period / Pipeline / Stage: add reach — customers and leads. */
const ROLLUP_COLUMNS = [
  'deal_count',
  'customer_count',
  'lead_count',
  'product_count',
  'product_quantity',
  'gross_amount',
  'net_amount',
] as const;

/** Product / Category / Sub-Category: the item-level twins of ROLLUP_COLUMNS. */
const ITEM_COLUMNS = [
  'deal_count',
  'customer_count',
  'lead_count',
  'item_product_count',
  'item_product_quantity',
  'item_gross_amount',
  'item_net_amount',
] as const;

const RECORD_LEVEL_MEASURES = [...ROLLUP_COLUMNS];
const ITEM_LEVEL_MEASURES = [...ITEM_COLUMNS, 'avg_price'];

export const dealReportConfig: ReportDefinition = {
  moduleName: 'deal',
  label: 'Deal Reports',
  requiredModule: 'deals',

  dimensions: [
    { key: 'lead', label: 'Lead', category: 'customer' },
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' },
    { key: 'status', label: 'Status', category: 'customer' },
    { key: 'pipeline', label: 'Deal Pipeline', category: 'customer' },
    { key: 'stage', label: 'Deal Pipeline Stage', category: 'customer' },
    { key: 'product', label: 'Product', category: 'product' },
    { key: 'product_category', label: 'Product Category', category: 'product' },
    { key: 'product_subcategory', label: 'Product Sub-Category', category: 'product' },
  ],

  measures: [
    { key: 'deal_count', label: '# deal', type: 'number' },
    { key: 'customer_count', label: '# customer', type: 'number' },
    { key: 'lead_count', label: '# lead', type: 'number' },
    { key: 'product_count', label: '# product', type: 'number' },
    { key: 'product_quantity', label: 'Quantity', type: 'number' },
    { key: 'gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'net_amount', label: 'Amount', type: 'currency' },
    // Item-level twins. Same labels on purpose — the column reads the same to the
    // user; `availableMeasures` decides which one a given tab may use.
    { key: 'item_product_count', label: '# product', type: 'number' },
    { key: 'item_product_quantity', label: 'Quantity', type: 'number' },
    { key: 'item_gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'item_net_amount', label: 'Amount', type: 'currency' },
    { key: 'avg_price', label: 'Avg Price', type: 'currency' },
  ],

  kpis: ['net_amount', 'gross_amount', 'deal_count'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'status', label: 'Status', type: 'select', section: 'DEAL', options: [
      { label: 'Open', value: 'open' },
      { label: 'Won', value: 'won' },
      { label: 'Lost', value: 'lost' },
    ]},
    { key: 'party_type', label: 'Raised For', type: 'select', section: 'DEAL', options: [
      { label: 'Lead', value: 'lead' },
      { label: 'Customer', value: 'customer' },
    ]},
    { key: 'pipeline', label: 'Pipeline', type: 'lookup', lookupTable: 'pipelines', lookupValueColumn: 'id', section: 'DEAL' },
    { key: 'stage', label: 'Stage', type: 'lookup', lookupTable: 'pipeline_stages', lookupValueColumn: 'id', section: 'DEAL' },
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Owned by', type: 'user', section: 'USER' },
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
      key: 'pipeline',
      label: 'Deal Pipeline',
      dimension: 'pipeline',
      defaultMeasures: [...ROLLUP_COLUMNS],
      availableMeasures: RECORD_LEVEL_MEASURES,
    },
    {
      key: 'stage',
      label: 'Deal Pipeline Stage',
      dimension: 'stage',
      defaultMeasures: [...ROLLUP_COLUMNS],
      availableMeasures: RECORD_LEVEL_MEASURES,
    },
    {
      key: 'product',
      label: 'Product',
      dimension: 'product',
      // Extra columns; the viewer drops sub-category when the account has only
      // one product level configured.
      extraDimensions: ['product_category', 'product_subcategory'],
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
