// The Assets panel on the customer detail page — the pure decisions behind it (no React, no
// Supabase), so the one that matters most (should this panel fetch anything at all?) is unit-tested.

import { AssetError } from './errors';

/** Rows shown in the panel. More than this: the panel shows the first page and "View all" carries the rest. */
export const PANEL_PAGE_SIZE = 25;

export interface PanelGateInput {
  /** `useAuth().hasFSM`: the account's plan has the fsm line. False while the plan is still loading. */
  hasFSM: boolean;
  /** The user holds `view_service_assets` (owners and admins pass; the plan line is checked separately). */
  canView: boolean;
  accountId: string | null | undefined;
  contactId: string | null | undefined;
}

/**
 * Should the customer page mount the Assets panel (and therefore fetch)?
 * Every condition is required. A tenant without the fsm line, or a user without the right, never
 * mounts it, so the page issues no asset request for them. Fail closed: anything missing is false.
 */
export function shouldShowCustomerAssets(input: PanelGateInput): boolean {
  return (
    input.hasFSM === true &&
    input.canView === true &&
    typeof input.accountId === 'string' &&
    input.accountId !== '' &&
    typeof input.contactId === 'string' &&
    input.contactId !== ''
  );
}

/** "Assets", or "Assets (3)" once there are some. */
export function panelHeading(total: number): string {
  return total > 0 ? `Assets (${total})` : 'Assets';
}

/** Where Add Asset goes: Task 8's form, which locks the customer field to this id. */
export function addAssetHref(contactId: string): string {
  return `/service/assets/new?contactId=${encodeURIComponent(contactId)}`;
}

/** Where View all goes: Task 7's list, which parses `contactId` into its customer filter. */
export function viewAllAssetsHref(contactId: string): string {
  return `/service/assets?contactId=${encodeURIComponent(contactId)}`;
}

export function assetHref(assetId: string): string {
  return `/service/assets/${encodeURIComponent(assetId)}`;
}

/**
 * What sits under the table. View all appears whenever there is at least one asset; when the
 * customer has more than the panel shows, `hiddenCount` says how many are not on screen.
 */
export function panelFooter(total: number, shown: number): { showViewAll: boolean; hiddenCount: number } {
  return { showViewAll: total > 0, hiddenCount: Math.max(0, total - shown) };
}

/** What the panel says when the load fails. Never the raw database message. */
export function describePanelError(err: unknown): string {
  if (err instanceof AssetError) {
    if (err.kind === 'network') return err.message;
    if (err.kind === 'permission') return "You don't have permission to view assets.";
  }
  return 'Could not load assets. Please try again.';
}
