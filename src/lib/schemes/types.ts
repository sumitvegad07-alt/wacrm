// Scheme Management (Pricing Phase 4) — admin/DB shapes.
//
// These mirror the migration-075 tables (snake_case) and the form state the
// /schemes admin screens work with. The pricing ENGINE has its own camelCase
// SchemeDefinition in `@/lib/pricing/types` for detection; the shared enums are
// re-used from there so there is one source of truth for the literal unions.

import type { SchemeType, SlabMode, SchemeRewardType } from '@/lib/pricing/types';

export type { SchemeType, SlabMode, SchemeRewardType };
export type SchemeTargetType = 'all' | 'specific_customers';

/** A row of `scheme_slabs`. `id`/`scheme_id` absent for a not-yet-saved slab. */
export interface SchemeSlabRow {
  id?: string;
  scheme_id?: string;
  min_qty: number | null;
  max_qty: number | null;
  min_value: number | null;
  max_value: number | null;
  reward_type: SchemeRewardType;
  reward_value: number | null;
  free_product_id: string | null;
  free_qty: number | null;
}

/** A row of `schemes`. */
export interface SchemeRow {
  id: string;
  account_id: string;
  name: string;
  scheme_type: SchemeType;
  slab_mode: SlabMode;
  target_type: SchemeTargetType;
  max_free_units_per_order: number | null;
  priority: number;
  starts_on: string; // YYYY-MM-DD
  ends_on: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** A scheme loaded with its children, for the list and the edit form. */
export interface SchemeWithDetails extends SchemeRow {
  slabs: SchemeSlabRow[];
  productIds: string[];
  customerIds: string[];
}

/** The shape the form edits and submits. */
export interface SchemeFormValues {
  name: string;
  schemeType: SchemeType;
  slabMode: SlabMode;
  targetType: SchemeTargetType;
  maxFreeUnitsPerOrder: number | null;
  priority: number;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  productIds: string[];
  customerIds: string[];
  slabs: SchemeSlabRow[];
}

export interface ProductOption {
  id: string;
  name: string;
  price: number;
}

export interface CustomerOption {
  id: string;
  label: string;
}

/** The live/scheduled/expired badge shown in the list, derived from dates + active. */
export type SchemeStatus = 'live' | 'scheduled' | 'expired' | 'inactive';

export function schemeStatus(scheme: SchemeRow, today: string): SchemeStatus {
  if (!scheme.active) return 'inactive';
  if (scheme.starts_on > today) return 'scheduled';
  if (scheme.ends_on !== null && scheme.ends_on < today) return 'expired';
  return 'live';
}

export const SCHEME_TYPE_LABELS: Record<SchemeType, string> = {
  quantity_slab: 'Quantity slab',
  free_goods: 'Free goods',
  value_slab: 'Order value slab',
};

export const REWARD_TYPE_LABELS: Record<SchemeRewardType, string> = {
  discount_percent: '% discount',
  discount_amount: 'Amount off (per unit)',
  special_price: 'Special price',
  free_goods: 'Free goods',
};

/** The reward types valid for a given scheme type. */
export function rewardTypesFor(schemeType: SchemeType): SchemeRewardType[] {
  if (schemeType === 'free_goods') return ['free_goods'];
  if (schemeType === 'value_slab') return ['discount_percent', 'discount_amount'];
  return ['discount_percent', 'discount_amount', 'special_price']; // quantity_slab
}

/** Quantity-based schemes use qty bounds; value_slab uses value bounds. */
export function usesValueBounds(schemeType: SchemeType): boolean {
  return schemeType === 'value_slab';
}
