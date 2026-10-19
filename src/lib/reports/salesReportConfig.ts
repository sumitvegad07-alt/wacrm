import type { ReportDefinition } from './types';

/**
 * Sales Report — the Order Report, restricted to revenue that has shipped.
 *
 * An order counts as a sale once it reaches status 'Closed'. The dispatch trigger
 * auto-closes an order the moment its last outstanding item ships (migration
 * 20260814151500_autoclose_fully_dispatched.sql). The `sales` module in
 * `execute_report` hard-wires `status = 'Closed'` into every query — it is not a
 * filter the UI can drop.
 *
 * Two deliberate differences from orderReportConfig, both founder decisions
 * (2026-08-16, see migration 20260816210000_sales_report_module.sql):
 *
 *  1. The Period filter and the Time tab run on the DISPATCH COMPLETION date (the
 *     order's latest dispatch), not the order date. An order placed 9 Aug and
 *     fully dispatched 14 Aug is August-14 revenue. So Sales totals will NOT
 *     reconcile row-for-row against Order Reports for the same period — that is
 *     intended, not a bug.
 *  2. A partially dispatched order contributes nothing until it completes, then
 *     contributes its full order value.
 *
 * Everything else (dimensions, measures, area/user/customer/product filters, tabs)
 * is identical, and the DB reuses the same registry rows so the two reports cannot
 * drift apart.
 *
 * Third thing to know: the Product, Category and Sub-Category tabs use the
 * `item_*` measure twins, because grouping by a product column joins
 * `order_items` and repeats the order's own totals once per line (§5 fan-out).
 * Those twins are registered on module `order` and inherited here, same as
 * everything else. See orderReportConfig.ts and migration
 * 20261019150000_order_sales_item_level_measures.sql for the measured before and
 * after. Never put an order-level quantity or amount on an item-level tab.
 */

/** Customer / User / Area / Period: the order IS the grain, so the order-level
 *  rollups are correct here. */
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

/** Product / Category / Sub-Category: the order line is the grain. No
 *  `discount_amount` / `tax_amount` — those are order-level only, so there is no
 *  correct column to offer on these tabs. */
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

export const salesReportConfig: ReportDefinition = {
  moduleName: 'sales',
  label: 'Sales Reports',
  requiredModule: 'orders',

  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' }, // groups by dispatch completion date, not order date
    { key: 'product', label: 'Product', category: 'product' },
    { key: 'product_category', label: 'Product Category', category: 'product' },
    { key: 'product_subcategory', label: 'Product Sub-Category', category: 'product' },
  ],

  measures: [
    { key: 'order_count', label: '# of order', type: 'number' },
    { key: 'product_count', label: '# of product', type: 'number' },
    { key: 'product_quantity', label: 'Quantity', type: 'number' },
    // Multi Unit: converted base-unit quantity (equals Quantity for single-unit lines).
    { key: 'base_quantity', label: 'Base Quantity', type: 'number' },
    { key: 'gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'net_amount', label: 'Sales Amount', type: 'currency' },
    { key: 'discount_amount', label: 'Discount Amount', type: 'currency' },
    { key: 'tax_amount', label: 'Tax Amount', type: 'currency' },
    { key: 'customer_count', label: '# of customer', type: 'number' },
    { key: 'avg_price', label: 'Avg Price', type: 'currency' },
    // Item-level twins, for the tabs already joined to order_items. Same labels
    // on purpose — the column reads the same to the user; `availableMeasures`
    // decides which one a given tab may use. 'Sales Amount' mirrors this
    // report's own wording for net_amount, not the registry's label.
    { key: 'item_product_count', label: '# of product', type: 'number' },
    { key: 'item_product_quantity', label: 'Quantity', type: 'number' },
    { key: 'item_base_quantity', label: 'Base Quantity', type: 'number' },
    { key: 'item_gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'item_net_amount', label: 'Sales Amount', type: 'currency' },
  ],

  kpis: ['net_amount', 'gross_amount', 'order_count'],

  filters: [
    { key: 'date_range', label: 'Dispatch Period', type: 'date_range', section: 'PERIOD' },
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
