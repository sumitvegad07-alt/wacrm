import type { ReportDefinition } from './types';

/**
 * DSR — Daily Sales Report.
 *
 * The only CROSS-MODULE report in the suite. Every other report has one base
 * table; the DSR has one row per EMPLOYEE and pulls each column from a different
 * module — visits, attendance, leave, orders, payments, expenses, leads,
 * quotations, deals — so a manager can read one line and know what a rep did
 * that day.
 *
 * How it avoids the obvious disaster: joining nine modules to `profiles` would
 * fan out catastrophically (a rep with 10 orders and 5 visits would produce 50
 * rows and multiply every total by 5). Instead **every measure is its own
 * correlated subquery** that carries the date window itself — see
 * report-engine.md §5k. Nothing is joined, so nothing can fan out, and grouping
 * by User or by Role is equally correct.
 *
 * Because the base table is `profiles`, which has no date of its own, the
 * `date_range` filter is a deliberate NO-OP on the base; the window lives inside
 * each measure.
 *
 * IT OPENS ON TODAY (`defaultPeriod`), unlike every other report. A *daily*
 * report that opened on a month would answer a different question than its name.
 *
 * Two figures that are deliberately NOT date-bound or NOT what you might assume:
 *
 * - **Assigned Customers** is a CURRENT count — how many customers this person
 *   owns right now, not how many were assigned during the window. Missed =
 *   Assigned − Visited, floored at zero.
 * - **Payment Collected = Approved + Pending + Rejected, EXCLUDING Cancelled.**
 *   A cancelled payment is a voided entry and was never collected. This is
 *   deliberately different from the Payment report's Total, which does include
 *   Cancelled because it reconciles every row ever written. Cancelled is still
 *   shown in its own column rather than dropped.
 * - **Distance is odometer-based**, not GPS: it is the figure travel allowance is
 *   paid on, and it only counts sessions where BOTH readings were captured.
 *
 * Registered in migration 20260818180000_dsr_report_module.sql.
 */

/** The full DSR line, in the order the founder specified it. */
const DSR_COLUMNS = [
  'assigned_customers',
  'visited_customers',
  'missed_customers',
  'days_present',
  'leave_days',
  'total_visits',
  'productive_visits',
  'distance_km',
  'new_customers',
  'order_amount',
  'order_quantity',
  'payment_collected',
  'new_leads',
  'lead_visits',
  'quotation_amount',
  'approved_quotation_amount',
  'new_deals',
  'deal_amount',
] as const;

export const dsrReportConfig: ReportDefinition = {
  moduleName: 'dsr',
  label: 'DSR (Daily Sales Report)',
  // A daily report must open on a day.
  defaultPeriod: 'today',

  dimensions: [
    { key: 'user', label: 'User', category: 'user' },
    { key: 'role', label: 'User Role', category: 'user' },
    { key: 'department', label: 'Department', category: 'user' },
    { key: 'branch', label: 'Branch', category: 'user' },
  ],

  measures: [
    // Coverage
    { key: 'assigned_customers', label: 'Assigned Customers', type: 'number' },
    { key: 'visited_customers', label: 'Visited Customers', type: 'number' },
    { key: 'missed_customers', label: 'Missed Customers', type: 'number' },
    // Attendance
    { key: 'days_present', label: 'Days Present', type: 'number' },
    { key: 'leave_days', label: 'Leave Days', type: 'number' },
    { key: 'distance_km', label: 'Distance (km)', type: 'number' },
    // Visits
    { key: 'total_visits', label: 'Total Visits', type: 'number' },
    { key: 'productive_visits', label: 'Productive Visits', type: 'number' },
    { key: 'lead_visits', label: 'Lead Visits', type: 'number' },
    // Acquisition
    { key: 'new_customers', label: 'New Customers', type: 'number' },
    { key: 'new_leads', label: 'New Leads', type: 'number' },
    // Orders
    { key: 'order_count', label: 'Orders', type: 'number' },
    { key: 'order_amount', label: 'Order Amount', type: 'currency' },
    { key: 'order_quantity', label: 'Order Quantity', type: 'number' },
    // Payments — Collected = Approved + Pending + Rejected (see header).
    { key: 'payment_collected', label: 'Payment Collected', type: 'currency' },
    { key: 'payment_approved', label: 'Payment Approved', type: 'currency' },
    { key: 'payment_pending', label: 'Payment Pending', type: 'currency' },
    { key: 'payment_rejected', label: 'Payment Rejected', type: 'currency' },
    { key: 'payment_cancelled', label: 'Payment Cancelled', type: 'currency' },
    // Expenses — Claimed = Approved + Pending + Rejected.
    { key: 'expense_claimed', label: 'Expense Claimed', type: 'currency' },
    { key: 'expense_approved', label: 'Expense Approved', type: 'currency' },
    { key: 'expense_pending', label: 'Expense Pending', type: 'currency' },
    { key: 'expense_rejected', label: 'Expense Rejected', type: 'currency' },
    // Quotations & deals
    { key: 'quotation_amount', label: 'Quotation Amount', type: 'currency' },
    { key: 'approved_quotation_amount', label: 'Approved Quotation Amount', type: 'currency' },
    { key: 'new_deals', label: 'New Deals', type: 'number' },
    { key: 'deal_amount', label: 'Deal Amount', type: 'currency' },
  ],

  kpis: ['total_visits', 'productive_visits', 'order_amount', 'payment_collected'],

  filters: [
    // Applies inside every measure, not to the base — see the header.
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'user', label: 'User', type: 'user', section: 'USER' },
    {
      key: 'employee_status',
      label: 'Employee Status',
      type: 'select',
      section: 'USER',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
      ],
    },
    // Set membership, never a grouping: an employee covers many areas (§5h).
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
  ],

  tabConfigs: [
    {
      key: 'user',
      label: 'User',
      dimension: 'user',
      defaultMeasures: [...DSR_COLUMNS],
    },
    {
      key: 'role',
      label: 'User Role',
      dimension: 'role',
      defaultMeasures: [...DSR_COLUMNS],
    },
  ],
};
