// Territory Master — shared types. See supabase/migrations/101_territory_master.sql
// and docs. Config lives in accounts.settings.territory_settings (jsonb), mirroring
// the order_settings pattern.

export type TerritoryStatus = 'active' | 'inactive' | 'archived';
export type AssignmentMode = 'area_wise' | 'direct';

/** One configurable hierarchy level (accounts.settings.territory_settings.levels[]). */
export interface TerritoryLevel {
  position: number; // 1..5, maps to territories.level
  name: string;
  enabled: boolean;
}

export interface TerritorySettings {
  levels: TerritoryLevel[];
  assignment_mode: AssignmentMode;
}

/** A row from public.territories. */
export interface Territory {
  id: string;
  account_id: string;
  parent_id: string | null;
  level: number;
  name: string;
  code: string | null;
  status: TerritoryStatus;
  notes: string | null;
  is_seed_data: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** A territory with its children nested — the shape getTerritoryTree returns. */
export interface TerritoryNode extends Territory {
  children: TerritoryNode[];
}

export interface EmployeeAreaAssignment {
  id: string;
  account_id: string;
  employee_id: string;
  territory_id: string;
  assigned_at: string;
  assigned_by: string | null;
}
