import type { ReportDefinition } from './types';

/**
 * Customer Outstanding — who owes money, on which order, and their phone number.
 *
 * The hard part is that `payments` has a `contact_id` and NO `order_id`: in OZZO
 * a payment settles a CUSTOMER, not an invoice, so a per-order balance has never
 * existed. Founder decision 2026-10-19: derive one by oldest-first allocation.
 * A customer's received payments settle their opening balance first, then their
 * oldest counted order, then the next. Each row shows what is still unpaid on
 * that order.
 *
 * The maths lives in `order_outstanding_amount(order_id)`, deliberately NOT in
 * the registry SQL:
 *   - it needs the customer's whole ledger, so it is SECURITY DEFINER like its
 *     sibling `customer_outstanding()`. Under the engine's SECURITY INVOKER a
 *     rep who can only see their own orders would compute a smaller prior debt,
 *     allocate too much, and read a different balance than their manager for
 *     the same order;
 *   - which statuses count as debt and which payments count as received comes
 *     from the account's own rule (`outstanding_order_statuses()` /
 *     `outstanding_payment_statuses()`), so this report can never disagree with
 *     the customer list or the dashboard.
 *
 * Period selects WHICH ORDERS ARE LISTED. It never changes the allocation, which
 * is always lifetime — narrowing to last month does not pretend the customer's
 * older debt was paid. Opens on Last 365 Days rather than This Month, because a
 * collections list that hides anything older than four weeks is the wrong list.
 *
 * Two things a reader has to know, both consequences of opening balance being
 * debt with no order row to sit on:
 *   - SUM(Outstanding) over a customer's orders equals their balance MINUS any
 *     unsettled opening balance. The Customer wise tab therefore offers
 *     "Customer Balance" (the stored `contacts.outstanding_balance`) for the
 *     true full figure.
 *   - Customer Balance is MAX() of one value per customer, so it is only valid
 *     where the grain IS the customer. `availableMeasures` keeps it off the
 *     Order / Area / User tabs, where repeating or maxing it would make the
 *     footer lie.
 *
 * An order in a status the account does not count as debt (Cancelled, Rejected)
 * shows Outstanding 0. That is guarded inside the function, not by a filter, so
 * no caller can remove it.
 *
 * Registered in migration 20261019120000_summary_report_modules.sql.
 */
export const outstandingReportConfig: ReportDefinition = {
  moduleName: 'order_outstanding',
  label: 'Customer Outstanding',
  requiredModule: 'orders',

  dimensions: [
    // No `category`: the registry's five categories (customer/user/area/time/
    // product) have no slot for the order itself, and the field is decorative.
    { key: 'order_number', label: 'Order Number' },
    { key: 'order_date', label: 'Order Date', category: 'time' },
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'customer_phone', label: 'Contact Number', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' },
  ],

  measures: [
    { key: 'order_amount', label: 'Order Amount', type: 'currency' },
    { key: 'outstanding_amount', label: 'Outstanding', type: 'currency' },
    { key: 'received_amount', label: 'Received Amount', type: 'currency' },
    { key: 'customer_balance', label: 'Customer Balance', type: 'currency' },
    { key: 'order_count', label: '# of order', type: 'number' },
    { key: 'customer_count', label: '# of customer', type: 'number' },
  ],

  kpis: ['order_amount', 'outstanding_amount', 'order_count'],
  defaultChartMeasure: 'outstanding_amount',
  defaultPeriod: 'last_365_days',

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'only_outstanding', label: 'Only unpaid orders', type: 'select', section: 'OUTSTANDING', options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ]},
    { key: 'status', label: 'Order Status', type: 'select', section: 'ORDER', options: [
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
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Ordered by', type: 'user', section: 'USER' },
  ],

  tabConfigs: [
    {
      key: 'order',
      label: 'Order wise',
      dimension: 'order_number',
      extraDimensions: ['order_date', 'customer', 'customer_phone'],
      defaultMeasures: ['order_amount', 'outstanding_amount'],
      hiddenMeasures: ['received_amount'],
      // One row per order: # of order and # of customer are both 1, and
      // Customer Balance would repeat across a customer's rows.
      availableMeasures: ['order_amount', 'outstanding_amount', 'received_amount'],
    },
    {
      key: 'customer',
      label: 'Customer wise',
      dimension: 'customer',
      extraDimensions: ['customer_phone'],
      defaultMeasures: ['order_count', 'order_amount', 'outstanding_amount', 'customer_balance'],
      hiddenMeasures: ['received_amount'],
      // The one grain where Customer Balance is meaningful.
      availableMeasures: ['order_count', 'order_amount', 'outstanding_amount',
                          'received_amount', 'customer_balance'],
    },
    {
      key: 'area',
      label: 'Area wise',
      dimension: 'area',
      defaultMeasures: ['customer_count', 'order_count', 'order_amount', 'outstanding_amount'],
      hiddenMeasures: ['received_amount'],
      // Customer Balance is MAX of one value per customer — across an area that
      // is the largest single debtor, not the area's total. Kept out.
      availableMeasures: ['customer_count', 'order_count', 'order_amount',
                          'outstanding_amount', 'received_amount'],
    },
    {
      key: 'user',
      label: 'User wise',
      dimension: 'user',
      defaultMeasures: ['customer_count', 'order_count', 'order_amount', 'outstanding_amount'],
      hiddenMeasures: ['received_amount'],
      availableMeasures: ['customer_count', 'order_count', 'order_amount',
                          'outstanding_amount', 'received_amount'],
    },
  ],
};
