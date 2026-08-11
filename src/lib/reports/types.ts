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
  type: 'date_range' | 'select' | 'multiselect' | 'user' | 'customer' | 'product';
  section?: 'PERIOD' | 'SALES TYPE' | 'AREA' | 'USER' | 'CUSTOMER' | 'PRODUCT';
  options?: { label: string; value: string }[];
  requiredModule?: keyof ModuleSettings | string;
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
}
