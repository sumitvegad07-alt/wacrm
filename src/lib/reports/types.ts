import type { ModuleSettings } from '@/hooks/use-auth';

export type ReportSharingMode = 'private' | 'team' | 'organization';

export interface SavedReport {
  id: string;
  account_id: string;
  user_id: string;
  module_name: string;
  name: string;
  config: ReportConfig;
  sharing_mode: ReportSharingMode;
  is_favorite: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportConfig {
  dimensions: string[]; // e.g. ["state", "city"]
  measures: string[]; // e.g. ["gross_amount", "net_amount"]
  filters: Record<string, any>;
  view: 'table' | 'bar' | 'donut';
  period: string;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  topN?: number | 'all';
  /** Which measure the bar/donut chart plots. A chart can only ever show one,
   *  and it used to be hardcoded to the first selected column — fine on a report
   *  with four columns, useless on the DSR, whose first column is
   *  "Assigned Customers". Falls back to the first measure when unset. */
  chartMeasure?: string;
}

export interface ReportDimension {
  key: string;
  label: string;
  category?: 'customer' | 'user' | 'area' | 'time' | 'product';
  requiredModule?: keyof ModuleSettings | string;
  requiredFeature?: string;
  requiredCustomField?: string;
  allowedChildDimensions?: string[];
}

export interface ReportMeasure {
  key: string;
  label: string;
  type: 'currency' | 'number' | 'percent';
  /** Set false for a number that must not be summed in the table footer — e.g.
   *  Ageing's "Days Since Last Order", where adding one customer's 40 days to
   *  another's 90 produces 130, which means nothing. `percent` measures get this
   *  behaviour automatically (§5e); this is for the non-percent cases. */
  additive?: boolean;
  requiredModule?: keyof ModuleSettings | string;
}

export interface ReportFilterDef {
  key: string;
  label: string;
  type: 'date_range' | 'select' | 'multiselect' | 'user' | 'customer' | 'lead' | 'product' | 'territory' | 'lookup';
  /** Drawer group heading. Free text so each module can name its own sections
   *  (payments have PAYMENT, orders have SALES TYPE / PRODUCT). PERIOD always
   *  renders first; remaining sections follow the order they appear in `filters`. */
  section?: string;
  options?: { label: string; value: string }[];
  /** For type 'select': build the options from a list held in the account's own
   *  settings rather than hardcoding them. Task activity types are per-account
   *  (`accounts.settings.task_types`) — this account uses "Payment follow up",
   *  which is not in the shipped default list, so a static list would make its
   *  own tasks unfilterable. Ignored if the setting is missing, in which case
   *  `options` is used as the fallback. */
  optionsFromSettings?: 'task_types';
  requiredModule?: keyof ModuleSettings | string;
  territoryLevel?: number;
  /** For type 'lookup': the table holding the account's configurable list
   *  (payment_types, lead_sources, lead_statuses, lead_industries, pipelines…).
   *  Values are looked up live rather than hardcoded, so options the account adds
   *  in settings appear without a code change. */
  lookupTable?: string;
  /** For type 'lookup': the column holding the human-readable label. Defaults to
   *  'name', which is what most of these tables use — but not all: expense types
   *  store their label in `expense_name`, and pointing the picker at a column
   *  that does not exist renders a list of blanks rather than an error. */
  lookupDisplayColumn?: string;
  /** For type 'lookup': the column stored in the filter payload. Defaults to
   *  'name' because most of these columns store the label as free text; use 'id'
   *  where the record stores a foreign key (e.g. a deal's pipeline). */
  lookupValueColumn?: 'name' | 'id';
}

export interface TabConfig {
  key: string;
  label: string;
  dimension: string; // The dimension key to set when this tab is active
  /** Additional dimension columns shown alongside the primary one — e.g. the
   *  Product tab also showing each product's category. Only use dimensions that
   *  are functionally determined by the primary one, otherwise grouping by them
   *  splits rows. */
  extraDimensions?: string[];
  defaultMeasures: string[]; // Measure keys shown by default
  hiddenMeasures?: string[]; // Measure keys available via Manage Column
  /** Restricts Manage Column to these measures on this tab. Needed where a module
   *  registers two arithmetics for the same column — quotations have record-level
   *  and item-level twins sharing a label, and only one is valid per tab.
   *  Omit to offer every measure (the default for all other reports). */
  availableMeasures?: string[];
  requiresProductSettings?: 'category' | 'subcategory'; // Show only if product category/subcategory enabled
  /** Execute this tab against a different registry module than the report's own.
   *  Tabs normally only change the dimension, because every tab of a report reads
   *  the same base table. Ageing breaks that: it lists master records that have
   *  NO orders, so its Customer/Area tabs read `contacts` while its Product tabs
   *  read `products` — two base tables, therefore two modules, one report.
   *  The saved default view stays keyed on the report's own moduleName. */
  moduleOverride?: string;
  /** KPI cards for this tab, when the tab's module measures something different
   *  from the report default (Ageing counts customers on one tab and products on
   *  another). Falls back to ReportDefinition.kpis. */
  kpis?: string[];
}

export interface ReportDefinition {
  moduleName: string;
  label: string;
  icon?: any; // Lucide icon
  requiredModule?: keyof ModuleSettings | string;
  dimensions: ReportDimension[];
  measures: ReportMeasure[];
  filters: ReportFilterDef[];
  kpis: string[]; // Array of measure keys to display as KPI cards
  tabConfigs?: TabConfig[];
  /** Tab the report opens on. Defaults to the first tab, which is not always the
   *  right landing screen: Quotations and Deals list Lead first because that is
   *  the pipeline order, but most accounts have far more customer records, so
   *  opening there would show an empty table on a perfectly healthy report. */
  defaultTab?: string;
  /** Period the report opens on. Defaults to 'this_month', which is right for
   *  every cumulative report but wrong for the DSR — a *daily* report that
   *  opened on a month would answer a different question than its name. Must be
   *  one of PERIOD_PRESETS' values. */
  defaultPeriod?: string;
}
