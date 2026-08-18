import type { ReportDefinition } from './types';

/**
 * Task Report — activity planned versus activity done.
 *
 * Mirrors the Visit report's tab shape (Customer, Lead, Area, Period, User) plus
 * the two splits that only tasks have: Activity Type and Status.
 *
 * The counts are registered so that
 *   # completed + # pending + # cancelled = # task
 * exactly. `# overdue` is deliberately NOT part of that sum — it is a SUBSET of
 * pending (past its due date and still open), so adding it in would double-count.
 * It is a default column anyway, because it is the number a manager acts on.
 *
 * TASKS ARE DATED BY DUE DATE, falling back to created_at. 3 of 14 prod tasks
 * have no due date, and dating strictly by due_date would silently drop them
 * from every period — the report would under-report and look right. "When was it
 * meant to happen, else when was it raised."
 *
 * Activity types are per-account (`accounts.settings.task_types`), not a fixed
 * list — this account uses "Payment follow up", which is not among the shipped
 * defaults. The filter therefore builds its options from account settings
 * (`optionsFromSettings`), so an account that adds a type can filter by it
 * without a code change.
 *
 * Registered in migration 20260818160000_task_report_module.sql.
 */

/** The completion picture — identical on every tab. */
const COMPLETION_COLUMNS = [
  'task_count',
  'completed_count',
  'pending_count',
  'overdue_count',
  'completion_ratio',
] as const;

export const taskReportConfig: ReportDefinition = {
  moduleName: 'task',
  label: 'Task Reports',

  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'lead', label: 'Lead', category: 'customer' },
    { key: 'activity_type', label: 'Activity Type', category: 'customer' },
    { key: 'status', label: 'Status', category: 'customer' },
    { key: 'priority', label: 'Priority', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'created_by', label: 'Created By', category: 'user' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' },
  ],

  measures: [
    { key: 'task_count', label: '# task', type: 'number' },
    { key: 'completed_count', label: '# completed', type: 'number' },
    { key: 'pending_count', label: '# pending', type: 'number' },
    // A subset of pending, not a fourth bucket — see the file header.
    { key: 'overdue_count', label: '# overdue', type: 'number' },
    { key: 'cancelled_count', label: '# cancelled', type: 'number' },
    // Computed per group in SQL, never summed — the footer dashes it and the KPI
    // card recomputes it across the whole result set (§5e).
    { key: 'completion_ratio', label: 'Completed %', type: 'percent' },
  ],

  kpis: ['task_count', 'completed_count', 'overdue_count', 'completion_ratio'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      section: 'TASK',
      options: [
        { label: 'Pending', value: 'Pending' },
        { label: 'In Progress', value: 'In Progress' },
        { label: 'Waiting', value: 'Waiting' },
        { label: 'Completed', value: 'Completed' },
        { label: 'Cancelled', value: 'Cancelled' },
      ],
    },
    {
      key: 'activity_type',
      label: 'Activity Type',
      type: 'select',
      section: 'TASK',
      // Built from accounts.settings.task_types; these are only the fallback.
      optionsFromSettings: 'task_types',
      options: [
        { label: 'Task', value: 'Task' },
        { label: 'Call', value: 'Call' },
        { label: 'Visit', value: 'Visit' },
        { label: 'Meeting', value: 'Meeting' },
        { label: 'Follow up', value: 'Follow up' },
        { label: 'Note', value: 'Note' },
      ],
    },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      section: 'TASK',
      options: [
        { label: 'Urgent', value: 'Urgent' },
        { label: 'High', value: 'High' },
        { label: 'Medium', value: 'Medium' },
        { label: 'Low', value: 'Low' },
      ],
    },
    {
      key: 'overdue',
      label: 'Overdue',
      type: 'select',
      section: 'TASK',
      options: [
        { label: 'Overdue only', value: 'yes' },
        { label: 'Not overdue', value: 'no' },
      ],
    },
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Assigned to', type: 'user', section: 'USER' },
    { key: 'created_by', label: 'Created by', type: 'user', section: 'USER' },
  ],

  tabConfigs: [
    {
      key: 'customer',
      label: 'Customer',
      dimension: 'customer',
      defaultMeasures: [...COMPLETION_COLUMNS],
    },
    {
      key: 'lead',
      label: 'Lead',
      dimension: 'lead',
      defaultMeasures: [...COMPLETION_COLUMNS],
    },
    {
      key: 'activity_type',
      label: 'Activity Type',
      dimension: 'activity_type',
      defaultMeasures: [...COMPLETION_COLUMNS],
    },
    {
      key: 'status',
      label: 'Status',
      dimension: 'status',
      // Completed/pending columns on a status grouping would just restate the
      // row's own name, so this tab counts and nothing else.
      defaultMeasures: ['task_count', 'overdue_count'],
    },
    {
      key: 'area',
      label: 'Area',
      dimension: 'area',
      defaultMeasures: [...COMPLETION_COLUMNS],
    },
    {
      key: 'time',
      label: 'Period',
      dimension: 'date',
      defaultMeasures: [...COMPLETION_COLUMNS],
    },
    {
      key: 'user',
      label: 'User',
      dimension: 'user',
      defaultMeasures: [...COMPLETION_COLUMNS],
    },
  ],
};
