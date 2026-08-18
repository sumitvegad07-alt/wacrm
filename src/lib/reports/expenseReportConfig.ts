import type { ReportDefinition } from './types';

/** The status pivot plus expense count — identical on every tab, which is the
 *  point of this report. Spread per tab so no two tabs share a mutable array. */
const STATUS_COLUMNS = [
  'pending_amount',
  'approved_amount',
  'rejected_amount',
  'total_amount',
  'expense_count',
] as const;

/**
 * Expense Report — claims broken down by approval status.
 *
 * Built on the same status-pivot shape as Payments (report-engine.md §5c): every
 * tab shows one column per status then a reconciling Total, so a row always
 * reads "of this much claimed by X, this much is approved and this much is still
 * pending". The engine guarantees
 *   Total = Pending + Approved + Rejected
 * because each expense falls in exactly one status bucket and the Total's CASE
 * mirrors the buckets' choice of column.
 *
 * Note the deliberate asymmetry, inherited from Payments: Approved reads
 * `approved_amount` — what the approver actually sanctioned, which can be less
 * than what was claimed — falling back to `amount`. Pending and Rejected have no
 * sanctioned figure, so they use `amount`. `Claimed` (Manage Column) is the raw
 * requested total, so Claimed − Total is exactly what approvers trimmed.
 *
 * THERE IS NO AREA TAB, and that is deliberate. An expense has no geography of
 * its own — no customer, no site, no territory column. The only route to one is
 * `employee_area_assignments`, which is many-to-many; one employee on prod
 * already covers six areas, so joining it would multiply their every amount by
 * six, and there is no honest way to split one hotel bill across six areas.
 * Area is therefore a FILTER only (registered as EXISTS, so no fan-out), meaning
 * "claims by employees who cover this area". Grouping by it would be fabricated.
 *
 * Department / Branch / Designation are real 1:1 attributes of the employee and
 * are available as dimensions, but are not tabs: all three columns are empty for
 * every profile on prod today, so each would render one "Unassigned" row. They
 * start working the moment those HR fields are filled in.
 *
 * Registered in migration 20260818140000_expense_report_module.sql. The engine
 * had resolved `expense` to the expenses table since the original engine
 * migration, but nothing was ever registered against it.
 */
export const expenseReportConfig: ReportDefinition = {
  moduleName: 'expense',
  label: 'Expense Reports',
  requiredModule: 'expense',

  dimensions: [
    { key: 'user', label: 'Employee', category: 'user' },
    { key: 'approver', label: 'Approved By', category: 'user' },
    { key: 'expense_type', label: 'Expense Type', category: 'customer' },
    { key: 'allowance_type', label: 'Allowance Type', category: 'customer' },
    { key: 'status', label: 'Status', category: 'customer' },
    { key: 'date', label: 'Period', category: 'time' },
    // Real, 1:1 with the employee — but empty on prod today, hence no tab.
    { key: 'department', label: 'Department', category: 'user' },
    { key: 'branch', label: 'Branch', category: 'user' },
    { key: 'designation', label: 'Designation', category: 'user' },
  ],

  measures: [
    // The status pivot — the default columns on every tab.
    { key: 'pending_amount', label: 'Pending', type: 'currency' },
    { key: 'approved_amount', label: 'Approved', type: 'currency' },
    { key: 'rejected_amount', label: 'Rejected', type: 'currency' },
    { key: 'total_amount', label: 'Total', type: 'currency' },
    { key: 'expense_count', label: '# of expenses', type: 'number' },
    // Available via Manage Column.
    { key: 'claimed_amount', label: 'Claimed', type: 'currency' },
    { key: 'pending_count', label: '# pending', type: 'number' },
    { key: 'approved_count', label: '# approved', type: 'number' },
    { key: 'rejected_count', label: '# rejected', type: 'number' },
    { key: 'travel_km', label: 'Travel (km)', type: 'number' },
    // Computed per group in SQL, never summed — the footer dashes it and the KPI
    // card recomputes it across the whole result set (§5e).
    { key: 'approval_ratio', label: 'Approved %', type: 'percent' },
  ],

  kpis: ['total_amount', 'approved_amount', 'pending_amount', 'approval_ratio'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      section: 'EXPENSE',
      options: [
        { label: 'Pending', value: 'Pending' },
        { label: 'Approved', value: 'Approved' },
        { label: 'Rejected', value: 'Rejected' },
      ],
    },
    {
      key: 'expense_type',
      label: 'Expense Type',
      type: 'lookup',
      section: 'EXPENSE',
      lookupTable: 'expense_types',
      // expense_types stores the label in expense_name, not name.
      lookupDisplayColumn: 'expense_name',
      lookupValueColumn: 'id',
    },
    {
      key: 'allowance_type',
      label: 'Allowance Type',
      type: 'select',
      section: 'EXPENSE',
      options: [
        { label: 'Regular', value: 'REGULAR' },
        { label: 'Travelling', value: 'TRAVELLING' },
      ],
    },
    // Set membership, not a grouping — see the file header.
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Claimed by', type: 'user', section: 'USER' },
    { key: 'approver', label: 'Approved by', type: 'user', section: 'USER' },
  ],

  tabConfigs: [
    {
      key: 'user',
      label: 'Employee',
      dimension: 'user',
      defaultMeasures: [...STATUS_COLUMNS],
    },
    {
      key: 'expense_type',
      label: 'Expense Type',
      dimension: 'expense_type',
      defaultMeasures: [...STATUS_COLUMNS],
    },
    {
      key: 'allowance_type',
      label: 'Allowance Type',
      dimension: 'allowance_type',
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
    {
      key: 'approver',
      label: 'Approved By',
      dimension: 'approver',
      defaultMeasures: [...STATUS_COLUMNS],
    },
  ],
};
