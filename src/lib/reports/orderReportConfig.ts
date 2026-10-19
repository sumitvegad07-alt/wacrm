import type { ReportDefinition } from './types';

/**
 * Order Report.
 *
 * Item-level tabs use DIFFERENT measure keys. Grouping by product, category or
 * sub-category joins `order_items`, which repeats the order's own totals once per
 * line — the fan-out in docs/report-engine.md §5. The quantity and amount
 * measures `order` registers are order-level rollups (read off the pre-aggregated
 * `isum` join, or straight off `base`), so on a product tab they reported roughly
 * 3.9x the truth until 2026-10-19. The product tabs therefore use the `item_*`
 * twins — same labels, per-line arithmetic — and `availableMeasures` keeps the
 * wrong twin out of Manage Column on each tab.
 *
 * Never add an order-level quantity or amount to an item-level tab; the totals
 * will lie. Measured before/after and the reconciliation against `order_items`
 * are in migration 20261019150000_order_sales_item_level_measures.sql.
 *
 * `order_count`, `customer_count` and `avg_price` need no twin: COUNT(DISTINCT …)
 * is immune to the repeated rows, and avg_price is already per line.
 */

/** Customer / User / Area / Period: the order IS the grain, so the order-level
 *  rollups are correct here and must keep being used. */
const ORDER_LEVEL_MEASURES = [
  'order_count',
  'customer_count',
  'product_count',
  'product_quantity',
  'base_quantity',
  'gross_amount',
  'net_amount',
  'discount_amount',
  'tax_amount',
  'avg_price',
];

/** Product / Category / Sub-Category: the order line is the grain. Note that
 *  `discount_amount` and `tax_amount` are absent — they are order-level only, so
 *  there is no correct column to offer on these tabs. */
const ITEM_LEVEL_MEASURES = [
  'order_count',
  'customer_count',
  'item_product_count',
  'item_product_quantity',
  'item_base_quantity',
  'item_gross_amount',
  'item_net_amount',
  'avg_price',
];

export const orderReportConfig: ReportDefinition = {
  moduleName: 'order',
  label: 'Order Reports',
  requiredModule: 'orders',
  
  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' },
    { key: 'product', label: 'Product', category: 'product' },
    { key: 'product_category', label: 'Product Category', category: 'product' },
    { key: 'product_subcategory', label: 'Product Sub-Category', category: 'product' },
  ],
  
  measures: [
    { key: 'order_count', label: '# of order', type: 'number' },
    { key: 'product_count', label: '# of product', type: 'number' },
    { key: 'product_quantity', label: 'Quantity', type: 'number' },
    // Multi Unit: converted base-unit quantity (2 BOX → 24). Equals Quantity for
    // single-unit / legacy lines (base_quantity falls back to quantity).
    { key: 'base_quantity', label: 'Base Quantity', type: 'number' },
    { key: 'gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'net_amount', label: 'Amount', type: 'currency' },
    { key: 'discount_amount', label: 'Discount Amount', type: 'currency' },
    { key: 'tax_amount', label: 'Tax Amount', type: 'currency' },
    { key: 'customer_count', label: '# of customer', type: 'number' },
    { key: 'avg_price', label: 'Avg Price', type: 'currency' },
    // Item-level twins, for the tabs already joined to order_items. Same labels
    // on purpose — the column reads the same to the user; `availableMeasures`
    // decides which one a given tab may use.
    { key: 'item_product_count', label: '# of product', type: 'number' },
    { key: 'item_product_quantity', label: 'Quantity', type: 'number' },
    { key: 'item_base_quantity', label: 'Base Quantity', type: 'number' },
    { key: 'item_gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'item_net_amount', label: 'Amount', type: 'currency' },
  ],
  
  kpis: ['net_amount', 'gross_amount', 'order_count'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'sales_type', label: 'Sales Type', type: 'select', section: 'SALES TYPE', options: [
      { label: 'Primary', value: 'primary' },
      { label: 'Secondary', value: 'secondary' },
    ]},
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Ordered by', type: 'user', section: 'USER' },
    { key: 'user_role', label: 'Ordered by role', type: 'select', section: 'USER', options: [
      { label: 'Admin', value: 'admin' },
      { label: 'Sales Rep', value: 'sales_rep' },
      { label: 'Manager', value: 'manager' },
    ]},
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
    { key: 'product', label: 'Product', type: 'product', section: 'PRODUCT' },
    { key: 'product_category', label: 'Category', type: 'select', section: 'PRODUCT' },
    { key: 'product_subcategory', label: 'Sub-Category', type: 'select', section: 'PRODUCT' },
  ],

  tabConfigs: [
    {
      key: 'customer',
      label: 'Customer',
      dimension: 'customer',
      defaultMeasures: ['order_count', 'product_quantity', 'product_count', 'gross_amount', 'net_amount'],
      availableMeasures: ORDER_LEVEL_MEASURES,
      hiddenMeasures: ['country', 'state', 'city', 'area'], // Note: these are dimension fields shown as extra columns, not measures
    },
    {
      key: 'user',
      label: 'User',
      dimension: 'user',
      defaultMeasures: ['order_count', 'customer_count', 'product_count', 'product_quantity', 'gross_amount', 'net_amount'],
      availableMeasures: ORDER_LEVEL_MEASURES,
    },
    {
      key: 'area',
      label: 'Area',
      dimension: 'area',
      defaultMeasures: ['order_count', 'customer_count', 'product_count', 'product_quantity', 'gross_amount', 'net_amount'],
      availableMeasures: ORDER_LEVEL_MEASURES,
    },
    {
      key: 'time',
      label: 'Period',
      dimension: 'date',
      defaultMeasures: ['order_count', 'customer_count', 'product_count', 'product_quantity', 'gross_amount', 'net_amount'],
      availableMeasures: ORDER_LEVEL_MEASURES,
    },
    {
      key: 'product',
      label: 'Product',
      dimension: 'product',
      defaultMeasures: ['order_count', 'customer_count', 'item_product_quantity', 'item_gross_amount', 'item_net_amount', 'avg_price'],
      availableMeasures: ITEM_LEVEL_MEASURES,
    },
    {
      key: 'product_category',
      label: 'Product Category',
      dimension: 'product_category',
      defaultMeasures: ['order_count', 'customer_count', 'item_product_count', 'item_product_quantity', 'item_gross_amount', 'item_net_amount'],
      availableMeasures: ITEM_LEVEL_MEASURES,
      requiresProductSettings: 'category',
    },
    {
      key: 'product_subcategory',
      label: 'Product Sub-Category',
      dimension: 'product_subcategory',
      defaultMeasures: ['order_count', 'customer_count', 'item_product_count', 'item_product_quantity', 'item_gross_amount', 'item_net_amount'],
      availableMeasures: ITEM_LEVEL_MEASURES,
      requiresProductSettings: 'subcategory',
    },
  ]
};
