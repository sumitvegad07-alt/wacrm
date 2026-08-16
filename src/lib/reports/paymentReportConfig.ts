import type { ReportDefinition } from './types';

/** The status pivot plus payment count — identical on every tab, which is the
 *  point of this report. Spread per tab so no two tabs share a mutable array. */
const STATUS_COLUMNS = [
  'pending_amount',
  'approved_amount',
  'rejected_amount',
  'cancelled_amount',
  'total_amount',
  'payment_count',
] as const;

/**
 * Payment Report — collections broken down by status.
 *
 * Every tab shows the same columns: one per payment status, then a reconciling
 * Total. A row therefore always reads "of this much collected from X, this much
 * is approved and this much is still pending". The engine guarantees
 *   Total = Pending + Approved + Rejected + Cancelled
 * because each payment falls in exactly one status bucket. Approved uses
 * verified_amount (what was actually confirmed) falling back to the requested
 * amount; the other statuses have no verified figure so they use the requested
 * amount. The table's footer row totals every column.
 *
 * Filters are scoped to what payments actually have. There are deliberately no
 * product / category / sub-category filters — payments carry no product
 * dimension, so those would only ever return empty reports.
 *
 * Registered in migration 20260817090000_payment_report_module.sql. Until then
 * this module was the one report that bypassed the engine entirely, aggregating
 * in TypeScript.
 */
export const paymentReportConfig: ReportDefinition = {
  moduleName: 'payment',
  label: 'Payment Reports',
  requiredModule: 'payments',

  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'user', label: 'Collected By', category: 'user' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' },
    { key: 'status', label: 'Status', category: 'customer' },
    { key: 'payment_type', label: 'Payment Type', category: 'customer' },
    { key: 'source', label: 'Source', category: 'customer' },
  ],

  measures: [
    // The status pivot — the default columns on every tab.
    { key: 'pending_amount', label: 'Pending', type: 'currency' },
    { key: 'approved_amount', label: 'Approved', type: 'currency' },
    { key: 'rejected_amount', label: 'Rejected', type: 'currency' },
    { key: 'cancelled_amount', label: 'Cancelled', type: 'currency' },
    { key: 'total_amount', label: 'Total', type: 'currency' },
    // Available via Manage Column.
    { key: 'payment_count', label: '# of payments', type: 'number' },
    { key: 'customer_count', label: '# of customers', type: 'number' },
    { key: 'amount', label: 'Requested Amount', type: 'currency' },
    { key: 'verified_amount', label: 'Verified Amount', type: 'currency' },
    { key: 'avg_payment', label: 'Avg Payment', type: 'currency' },
  ],

  kpis: ['approved_amount', 'pending_amount', 'total_amount'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'status', label: 'Status', type: 'select', section: 'PAYMENT', options: [
      { label: 'Pending', value: 'Pending' },
      { label: 'Approved', value: 'Approved' },
      { label: 'Rejected', value: 'Rejected' },
      { label: 'Cancelled', value: 'Cancelled' },
    ]},
    { key: 'payment_type', label: 'Payment Type', type: 'payment_type', section: 'PAYMENT' },
    { key: 'source', label: 'Source', type: 'select', section: 'PAYMENT', options: [
      { label: 'Admin', value: 'admin' },
      { label: 'Visit', value: 'visit' },
      { label: 'Customer', value: 'customer' },
    ]},
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Collected by', type: 'user', section: 'USER' },
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
  ],

  // Same columns on every tab — that is the point of this report.
  tabConfigs: [
    {
      key: 'customer',
      label: 'Customer',
      dimension: 'customer',
      defaultMeasures: [...STATUS_COLUMNS],
    },
    {
      key: 'user',
      label: 'User',
      dimension: 'user',
      defaultMeasures: [...STATUS_COLUMNS],
    },
    {
      key: 'area',
      label: 'Area',
      dimension: 'area',
      defaultMeasures: [...STATUS_COLUMNS],
    },
    {
      key: 'time',
      label: 'Period',
      dimension: 'date',
      defaultMeasures: [...STATUS_COLUMNS],
    },
    {
      key: 'status',
      label: 'Status',
      dimension: 'status',
      defaultMeasures: [...STATUS_COLUMNS],
    },
  ],
};

