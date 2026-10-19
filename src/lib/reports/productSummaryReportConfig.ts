import type { ReportDefinition } from './types';

/**
 * Product Summary — which customer bought which product, how many, how much.
 *
 * Every other report has ONE dimension per tab, because two independent
 * dimensions multiply the rows. This report's whole purpose is that
 * multiplication: the founder wants a flat daily list reading
 * "customer / product / quantity / amount", which the Order report cannot
 * produce — it has a Customer tab and a Product tab and no way to show both.
 * So `extraDimensions` is used deliberately here to split rows, the opposite of
 * its use everywhere else (where the extra column is functionally determined by
 * the primary one and therefore cannot split anything).
 *
 * That changes the GRAIN to the order line, which is why the module registers
 * its own measures instead of inheriting them. On module `order`,
 * `product_quantity` is `SUM(COALESCE(isum.product_quantity, 0))` — one order's
 * whole quantity, read off a pre-aggregated subquery and repeated once per
 * product row. Correct for a Customer tab, overstated on a product row, which
 * is the known fan-out on the Order and Sales Product tabs. Here the same keys
 * resolve to item-level twins (`SUM(i.quantity)`, `SUM(i.total)`), so the
 * numbers are right at this grain. Everything else — all 12 dimensions, the
 * filters, the joins — is inherited from `order` through module aliasing.
 *
 * Amount is the LINE's final amount (`order_items.total`, after tax), not the
 * order's. Summing the order total per line would multiply one order's value by
 * its number of products.
 *
 * Opens on Today: the founder asked for this as a daily sheet.
 *
 * Registered in migration 20261019120000_summary_report_modules.sql.
 * Sub-Category is deliberately absent — `order.product_subcategory` is
 * registered as `COALESCE(p.category, 'General')`, identical to Category, a
 * pre-existing bug this report does not inherit by simply not offering it.
 */
export const productSummaryReportConfig: ReportDefinition = {
  moduleName: 'product_summary',
  label: 'Product Summary',
  requiredModule: 'orders',

  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'product', label: 'Product', category: 'product' },
    { key: 'product_category', label: 'Product Category', category: 'product' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'day', label: 'Day', category: 'time' },
    { key: 'date', label: 'Period', category: 'time' },
  ],

  measures: [
    { key: 'product_quantity', label: 'Quantity', type: 'number' },
    { key: 'net_amount', label: 'Amount', type: 'currency' },
    // Multi Unit: 2 BOX of 12 reads as 24. Equals Quantity on single-unit and
    // legacy lines, whose base_quantity is NULL.
    { key: 'base_quantity', label: 'Base Quantity', type: 'number' },
    { key: 'gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'tax_amount', label: 'Tax Amount', type: 'currency' },
    { key: 'product_count', label: '# of product', type: 'number' },
    { key: 'customer_count', label: '# of customer', type: 'number' },
    { key: 'order_count', label: '# of order', type: 'number' },
    // Money over pieces. A rate is a ratio, so the footer dashes it rather than
    // adding one row's ₹/kg to another's (§5e).
    { key: 'avg_rate', label: 'Avg Rate', type: 'currency', additive: false },
  ],

  kpis: ['net_amount', 'product_quantity', 'order_count'],
  defaultChartMeasure: 'net_amount',
  defaultPeriod: 'today',

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'status', label: 'Status', type: 'select', section: 'ORDER', options: [
      { label: 'Pending', value: 'Pending' },
      { label: 'Approved', value: 'Approved' },
      { label: 'Part Dispatch', value: 'Part Dispatch' },
      { label: 'Dispatched', value: 'Dispatched' },
      { label: 'Closed', value: 'Closed' },
      { label: 'Cancelled', value: 'Cancelled' },
      { label: 'Rejected', value: 'Rejected' },
    ]},
    { key: 'sales_type', label: 'Sales Type', type: 'select', section: 'SALES TYPE', options: [
      { label: 'Primary', value: 'primary' },
      { label: 'Secondary', value: 'secondary' },
    ]},
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
    { key: 'product', label: 'Product', type: 'product', section: 'PRODUCT' },
    { key: 'product_category', label: 'Category', type: 'select', section: 'PRODUCT' },
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Ordered by', type: 'user', section: 'USER' },
  ],

  tabConfigs: [
    {
      key: 'customer',
      label: 'Customer wise',
      dimension: 'customer',
      extraDimensions: ['product'],
      // "Balaji Enterprise total" under that customer's products.
      showSubtotals: true,
      defaultMeasures: ['product_quantity', 'net_amount'],
      hiddenMeasures: ['base_quantity', 'gross_amount', 'tax_amount', 'avg_rate', 'order_count'],
      // # of customer is 1 on every row of this tab (the grain already includes
      // the customer), so it would be a column of ones.
      availableMeasures: ['product_quantity', 'net_amount', 'base_quantity', 'gross_amount',
                          'tax_amount', 'avg_rate', 'order_count', 'product_count'],
    },
    {
      key: 'product',
      label: 'Product wise',
      dimension: 'product',
      extraDimensions: ['customer'],
      // The founder's own example: Toothbrush — Balaji 50, Kanta 20,
      // Ramesh 190, then "Toothbrush total 260".
      showSubtotals: true,
      defaultMeasures: ['product_quantity', 'net_amount'],
      hiddenMeasures: ['base_quantity', 'gross_amount', 'tax_amount', 'avg_rate', 'order_count'],
      // Same reasoning in reverse: # of product is 1 per row here.
      availableMeasures: ['product_quantity', 'net_amount', 'base_quantity', 'gross_amount',
                          'tax_amount', 'avg_rate', 'order_count', 'customer_count'],
    },
    {
      // Product totals with no customer breakdown, for when the whole answer
      // should fit on one page. No subtotals here: one row per product already
      // IS the product's total, so a subtotal line would repeat every row.
      key: 'product_total',
      label: 'Product total',
      dimension: 'product',
      defaultMeasures: ['product_quantity', 'net_amount', 'customer_count'],
      hiddenMeasures: ['base_quantity', 'gross_amount', 'tax_amount', 'avg_rate', 'order_count'],
      availableMeasures: ['product_quantity', 'net_amount', 'base_quantity', 'gross_amount',
                          'tax_amount', 'avg_rate', 'order_count', 'customer_count'],
    },
  ],
};
