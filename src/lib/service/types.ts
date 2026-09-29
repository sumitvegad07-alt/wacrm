// Field Service Management (FSM) — row shapes. Mirrors spec §4.2 / §4.3
// (docs/engineering/specifications/ozzo-fsm-phase-1-2-assets-and-jobs.md).
// Shapes model what a Supabase select returns: uuid/date/timestamptz are strings.

// asset_types.status reuses the existing `territory_status` enum, so reuse its
// TS type instead of declaring a duplicate that could drift from the DB enum.
import type { TerritoryStatus } from '@/lib/territories/types';

export type AssetStatus = 'active' | 'under_repair' | 'replaced' | 'scrapped' | 'inactive';
export type JobPriority = 'low' | 'medium' | 'high' | 'critical';

/** public.asset_types (spec §4.2). */
export interface AssetType {
  id: string;
  account_id: string;
  name: string;
  code: string | null;
  status: TerritoryStatus;
  is_seed_data: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** public.customer_assets (spec §4.3). */
export interface CustomerAsset {
  id: string;
  account_id: string;
  asset_code: string;
  contact_id: string;
  asset_type_id: string | null;
  product_id: string | null;
  name: string;
  make: string | null;
  model_no: string | null;
  serial_no: string | null;
  installation_date: string | null; // date
  warranty_start: string | null; // date
  warranty_end: string | null; // date
  status: AssetStatus;
  /** Write-once at INSERT. History/search only — never render as the customer; resolve via contact_id. */
  customer_name_snapshot: string | null;
  /** Write-once at INSERT. History/search only — never render as the customer; resolve via contact_id. */
  customer_phone_snapshot: string | null;
  site_label: string | null;
  territory_id: string | null;
  notes: string | null;
  created_by: string | null; // profiles.id
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
