// Asset detail screen — the pure decisions behind /service/assets/[id] (no React, no Supabase), so
// the parts that are easy to get subtly wrong are unit-tested instead of eyeballed.

import { AssetError, type AssetConflict } from './errors';
import { assetStatusLabel } from './list-view';
import type { AssetStatus } from '../types';

const present = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== '';

// ── The customer: live first, snapshot only as history ─────────────────────────

/** The part of an asset row the customer display reads. */
export interface AssetCustomerSource {
  contact: { name: string | null; phone: string } | null;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
}

export type CustomerSource = 'live' | 'snapshot' | 'none';

/**
 * Who to name as the customer, and where that name came from.
 *  - live:     the joined contact (name, else phone). The only time the name is the CURRENT customer.
 *  - snapshot: the viewer's data scope hides the contact, so the frozen creation-time values are the
 *              best available. The screen must say so rather than present them as current.
 *  - none:     nothing to show.
 * contacts.name is NULL for customers imported from a phone list; contacts.phone is NOT NULL.
 */
export function customerDisplay(row: AssetCustomerSource): { label: string; source: CustomerSource } {
  if (row.contact) {
    if (present(row.contact.name)) return { label: row.contact.name.trim(), source: 'live' };
    if (present(row.contact.phone)) return { label: row.contact.phone.trim(), source: 'live' };
  }
  if (present(row.customer_name_snapshot)) return { label: row.customer_name_snapshot.trim(), source: 'snapshot' };
  if (present(row.customer_phone_snapshot)) return { label: row.customer_phone_snapshot.trim(), source: 'snapshot' };
  return { label: '—', source: 'none' };
}

const norm = (v: string | null | undefined): string => (present(v) ? v.trim() : '');

/**
 * The "recorded at creation" line, or null when there is nothing worth adding.
 *
 * Shown ONLY when the live customer is readable AND the snapshot differs from it (the customer was
 * renamed or got a new phone since the asset was created). That makes the snapshot visible as
 * history without letting it pose as the current customer. Null when:
 *  - the live contact is hidden (the snapshot is already what the header falls back to), or
 *  - the asset has no snapshot at all, or
 *  - the snapshot matches the live name and phone.
 */
export function creationSnapshotNote(row: AssetCustomerSource): string | null {
  const { contact } = row;
  if (!contact) return null;
  const snapName = norm(row.customer_name_snapshot);
  const snapPhone = norm(row.customer_phone_snapshot);
  if (!snapName && !snapPhone) return null;
  if (snapName === norm(contact.name) && snapPhone === norm(contact.phone)) return null;
  return [snapName, snapPhone].filter(Boolean).join(' · ');
}

// ── Actions: what the viewer is offered ────────────────────────────────────────

export interface AssetActionGates {
  edit: boolean;
  archive: boolean;
  restore: boolean;
}

/**
 * Which action buttons to show, from the SERVER-resolved rights (require-access.ts) and whether the
 * asset is archived. Edit needs `edit_service_assets`. Archive and Restore both need
 * `delete_service_assets` (the database requires it for each), and only one of them ever applies:
 * a live asset can be archived, an archived one can be restored. An archived asset can still be
 * edited: that is how its code is changed.
 */
export function assetActionGates(rights: { edit: boolean; delete: boolean }, archived: boolean): AssetActionGates {
  return {
    edit: rights.edit,
    archive: rights.delete && !archived,
    restore: rights.delete && archived,
  };
}

// ── Read-only fields, grouped as the form groups them ──────────────────────────

export interface DetailAssetFields extends AssetCustomerSource {
  asset_code: string;
  name: string;
  asset_type_id: string | null;
  asset_type: { name: string } | null;
  product_id: string | null;
  product: { name: string } | null;
  make: string | null;
  model_no: string | null;
  serial_no: string | null;
  installation_date: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  status: AssetStatus;
  site_label: string | null;
  territory_id: string | null;
  territory: { name: string } | null;
  notes: string | null;
}

export interface DetailField {
  /** `customer` and `asset_code` get special rendering (a link / monospace); the rest are text. */
  key: string;
  label: string;
  /** Already formatted. Null means "nothing recorded": the screen shows a dash. */
  value: string | null;
}

export interface DetailGroup {
  title: 'Identity' | 'Lifecycle' | 'Placement' | 'Notes';
  fields: DetailField[];
}

// A DATE column carries no zone. Format it as the UTC calendar day it names (the same anchoring
// warrantyState and the warranty pill use), so a viewer west of UTC never sees the day before.
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-10-05" -> "5 Oct 2026". Null for blank; an unparseable value is shown as written. */
export function formatDetailDate(date: string | null): string | null {
  if (!present(date)) return null;
  const ms = Date.parse(`${date.trim()}T00:00:00Z`);
  return Number.isNaN(ms) ? date : DATE_FORMAT.format(ms);
}

const text = (v: string | null | undefined): string | null => (present(v) ? v.trim() : null);

/**
 * A joined name, or, when the id is set but the join came back empty (the row is hidden or was
 * removed), an honest "Not available" rather than a dash that would read as "never set".
 */
function joined(id: string | null, row: { name: string } | null): string | null {
  if (row && present(row.name)) return row.name.trim();
  return id ? 'Not available' : null;
}

/** The same four groups, in the same order, as the add/edit form: Identity, Lifecycle, Placement, Notes. */
export function buildDetailGroups(asset: DetailAssetFields): DetailGroup[] {
  const customer = customerDisplay(asset);
  return [
    {
      title: 'Identity',
      fields: [
        { key: 'asset_code', label: 'Asset code', value: asset.asset_code },
        { key: 'customer', label: 'Customer', value: customer.source === 'none' ? null : customer.label },
        { key: 'name', label: 'Asset name', value: text(asset.name) },
        { key: 'asset_type', label: 'Asset type', value: joined(asset.asset_type_id, asset.asset_type) },
        { key: 'product', label: 'Product', value: joined(asset.product_id, asset.product) },
        { key: 'make', label: 'Make', value: text(asset.make) },
        { key: 'model_no', label: 'Model no.', value: text(asset.model_no) },
        { key: 'serial_no', label: 'Serial no.', value: text(asset.serial_no) },
      ],
    },
    {
      title: 'Lifecycle',
      fields: [
        { key: 'installation_date', label: 'Installation date', value: formatDetailDate(asset.installation_date) },
        { key: 'warranty_start', label: 'Warranty start', value: formatDetailDate(asset.warranty_start) },
        { key: 'warranty_end', label: 'Warranty end', value: formatDetailDate(asset.warranty_end) },
        { key: 'status', label: 'Status', value: assetStatusLabel(asset.status) },
      ],
    },
    {
      title: 'Placement',
      fields: [
        { key: 'site_label', label: 'Site label', value: text(asset.site_label) },
        { key: 'territory', label: 'Territory', value: joined(asset.territory_id, asset.territory) },
      ],
    },
    {
      title: 'Notes',
      fields: [{ key: 'notes', label: 'Notes', value: text(asset.notes) }],
    },
  ];
}

// ── Restore: what a failure means and what to do next ──────────────────────────

export type RestoreOutcome =
  /** The archived asset's code now belongs to a live asset. Ask for a new code and restore with it. */
  | { kind: 'needs-new-code'; clashingCode: string | null; holder: AssetConflict | null }
  | { kind: 'failed'; message: string };

export const GENERIC_RESTORE_FAILURE = 'Could not re-activate the asset. Please try again.';

/**
 * Read a restore failure. A code collision (`duplicate_code`) is the one case the user can fix on
 * the spot, so it gets its own outcome; everything else carries a readable message. Raw database
 * text is never returned: AssetError messages are already worded for people, and anything that is
 * not an AssetError gets the generic line.
 *
 * Used twice: for the plain restore (the clash is the asset's OWN old code) and for restore with a
 * new code (the clash is the code the user just typed). `clashingCode` is whichever collided.
 */
export function interpretRestoreError(err: unknown): RestoreOutcome {
  if (err instanceof AssetError) {
    if (err.kind === 'duplicate_code') {
      return { kind: 'needs-new-code', clashingCode: err.assetCode ?? null, holder: err.conflict ?? null };
    }
    return { kind: 'failed', message: err.message };
  }
  return { kind: 'failed', message: GENERIC_RESTORE_FAILURE };
}

export const MAX_ASSET_CODE_LENGTH = 40;

/**
 * Check the code typed into the restore dialog before any request. The database only insists that a
 * code is not blank and is unique among live assets, so that, plus a sane length and "not the code
 * that just clashed", is all that is enforced here. No invented format rule.
 */
export function validateNewAssetCode(
  raw: string,
  clashingCode: string | null,
  /** What the box was pre-filled with (newCodeStart). Leaving only that is "no number typed". */
  startedWith = '',
): { ok: true; code: string } | { ok: false; message: string } {
  const code = raw.trim();
  if (!code) return { ok: false, message: 'Enter a new asset code.' };
  if (startedWith && code === startedWith.trim()) {
    return { ok: false, message: `Add a number after ${startedWith.trim()}` };
  }
  if (code.length > MAX_ASSET_CODE_LENGTH) {
    return { ok: false, message: `Keep the code to ${MAX_ASSET_CODE_LENGTH} characters or fewer.` };
  }
  if (clashingCode && code === clashingCode.trim()) {
    return { ok: false, message: `${code} is the code that is already taken. Type a different one.` };
  }
  return { ok: true, code };
}

/**
 * Where to start the new-code box: the old code up to and including its last hyphen ("AST-"), so the
 * user only types the number. Empty when the code has no hyphen.
 */
export function newCodeStart(oldCode: string): string {
  const i = oldCode.lastIndexOf('-');
  return i >= 0 ? oldCode.slice(0, i + 1) : '';
}
