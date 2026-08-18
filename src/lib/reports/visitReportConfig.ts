import type { ReportDefinition } from './types';

/**
 * Visit Report — field coverage and what came of it.
 *
 * Feedback is a STATUS PIVOT, not a grouping (report-engine.md §5c): every tab
 * carries one column per feedback type rather than one row per type, so a row
 * reads "of these N visits, X went Excellent and Y went Poor". The mobile app
 * offers a fixed list — Excellent / Good / Average / Poor (mobile
 * app/visit/[id].tsx, FEEDBACK_OPTIONS) — and a visit can be closed without
 * choosing one, so the fifth "No Feedback" column makes the five reconcile
 * exactly against `# visit`.
 *
 * A PRODUCTIVE VISIT is one that produced an order. `orders.site_visit_id`
 * already records that link, so productivity is read, not inferred (founder
 * decision, 2026-08-18). The Lead tab omits it deliberately.
 *
 * `# customer visit` + `# lead visit` = `# visit` — they split VISITS by who was
 * visited. For distinct people rather than visits, use `# unique customer` /
 * `# unique lead` from Manage Column.
 *
 * Visits are dated by check-in. Registered in migration
 * 20260818090000_visit_and_ageing_report_modules.sql.
 */

/** The feedback pivot — identical on every tab, and sums to `# visit`. */
const FEEDBACK_COLUMNS = [
  'feedback_excellent',
  'feedback_good',
  'feedback_average',
  'feedback_poor',
  'feedback_none',
] as const;

/** Area / Period / User all answer the same question: coverage of a slice of the
 *  field, split by who was seen and how it went. */
const COVERAGE_COLUMNS = [
  'visit_count',
  'productive_visit_count',
  'customer_visit_count',
  'lead_visit_count',
  ...FEEDBACK_COLUMNS,
] as const;

export const visitReportConfig: ReportDefinition = {
  moduleName: 'visit',
  label: 'Visit Reports',

  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'lead', label: 'Lead', category: 'customer' },
    { key: 'feedback', label: 'Feedback', category: 'customer' },
    { key: 'visit_for', label: 'Visited', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' },
  ],

  measures: [
    { key: 'visit_count', label: '# visit', type: 'number' },
    { key: 'productive_visit_count', label: '# productive visit', type: 'number' },
    { key: 'customer_visit_count', label: '# customer visit', type: 'number' },
    { key: 'lead_visit_count', label: '# lead visit', type: 'number' },
    { key: 'feedback_excellent', label: 'Excellent', type: 'number' },
    { key: 'feedback_good', label: 'Good', type: 'number' },
    { key: 'feedback_average', label: 'Average', type: 'number' },
    { key: 'feedback_poor', label: 'Poor', type: 'number' },
    { key: 'feedback_none', label: 'No Feedback', type: 'number' },
    { key: 'unique_customer_count', label: '# unique customer', type: 'number' },
    { key: 'unique_lead_count', label: '# unique lead', type: 'number' },
    { key: 'order_amount', label: 'Order Amount', type: 'currency' },
    // Computed per group in SQL, never summed — the footer dashes it and the KPI
    // card recomputes it across the whole result set (§5e).
    { key: 'productivity_ratio', label: 'Productivity %', type: 'percent' },
  ],

  kpis: ['visit_count', 'productive_visit_count', 'productivity_ratio', 'unique_customer_count'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    {
      key: 'visit_for',
      label: 'Visited',
      type: 'select',
      section: 'VISIT',
      options: [
        { label: 'Customer', value: 'Customer' },
        { label: 'Lead', value: 'Lead' },
      ],
    },
    {
      key: 'feedback_type',
      label: 'Feedback',
      type: 'select',
      section: 'VISIT',
      options: [
        { label: 'Excellent', value: 'Excellent' },
        { label: 'Good', value: 'Good' },
        { label: 'Average', value: 'Average' },
        { label: 'Poor', value: 'Poor' },
      ],
    },
    {
      key: 'productive',
      label: 'Productive',
      type: 'select',
      section: 'VISIT',
      options: [
        { label: 'Produced an order', value: 'yes' },
        { label: 'No order', value: 'no' },
      ],
    },
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Visited by', type: 'user', section: 'USER' },
  ],

  tabConfigs: [
    {
      key: 'customer',
      label: 'Customer',
      dimension: 'customer',
      defaultMeasures: ['visit_count', 'productive_visit_count', ...FEEDBACK_COLUMNS],
    },
    {
      key: 'lead',
      label: 'Lead',
      dimension: 'lead',
      // No productivity column: orders are raised against customers, so a lead
      // tab full of zeroes would read as a failure rather than as "not applicable".
      defaultMeasures: ['visit_count', ...FEEDBACK_COLUMNS],
    },
    {
      key: 'area',
      label: 'Area',
      dimension: 'area',
      defaultMeasures: [...COVERAGE_COLUMNS],
    },
    {
      key: 'time',
      label: 'Period',
      dimension: 'date',
      defaultMeasures: [...COVERAGE_COLUMNS],
    },
    {
      key: 'user',
      label: 'User',
      dimension: 'user',
      defaultMeasures: [...COVERAGE_COLUMNS],
    },
  ],
};
