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
  requiredModule?: keyof ModuleSettings | string;
  territoryLevel?: number;
  /** For type 'lookup': the table holding the account's configurable list
   *  (payment_types, lead_sources, lead_statuses, lead_industries, pipelines…).
   *  Values are looked up live rather than hardcoded, so options the account adds
   *  in settings appear without a code change. */
  lookupTable?: string;
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
}
