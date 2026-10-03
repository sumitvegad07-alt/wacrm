// Asset create/edit form — the pure decisions behind <AssetForm> (no React, no Supabase), so the
// parts that are easy to get subtly wrong are unit-tested instead of eyeballed:
//   - what the form starts with,
//   - what blocks a save BEFORE any request,
//   - exactly which fields are sent (and which never are),
//   - how every failure is worded for a person.
//
// The write path itself (createAsset / updateAsset in api.ts) already enforces the allowlist; this
// file decides what is handed to it.

import type { AssetStatus, CustomerAsset } from '../types';
import type { CreateAssetInput, UpdateAssetInput } from './api';
import { AssetError, mapAssetError, type AssetConflict } from './errors';

// ── Values ─────────────────────────────────────────────────────────────────────

/** Every editable field as the form holds it: all strings, blank meaning "not set". */
export interface AssetFormValues {
  contact_id: string;
  name: string;
  asset_type_id: string;
  product_id: string;
  make: string;
  model_no: string;
  serial_no: string;
  installation_date: string; // YYYY-MM-DD, from <input type="date">
  warranty_start: string;
  warranty_end: string;
  status: AssetStatus;
  site_label: string;
  territory_id: string;
  notes: string;
}

export type AssetFormField = keyof AssetFormValues;

export const EMPTY_ASSET_FORM: AssetFormValues = {
  contact_id: '',
  name: '',
  asset_type_id: '',
  product_id: '',
  make: '',
  model_no: '',
  serial_no: '',
  installation_date: '',
  warranty_start: '',
  warranty_end: '',
  status: 'active',
  site_label: '',
  territory_id: '',
  notes: '',
};

type EditableRow = Pick<
  CustomerAsset,
  | 'contact_id'
  | 'name'
  | 'asset_type_id'
  | 'product_id'
  | 'make'
  | 'model_no'
  | 'serial_no'
  | 'installation_date'
  | 'warranty_start'
  | 'warranty_end'
  | 'status'
  | 'site_label'
  | 'territory_id'
  | 'notes'
>;

/**
 * What the form opens with. Create: empty, with the customer filled when it is locked. Edit: the
 * stored row. Territory is NEVER pre-filled from the customer on create: the database inherits it
 * when it is left blank, and pre-filling would turn every asset into one with an explicit territory
 * (a machine can sit somewhere other than its owner's area).
 */
export function initialValues(asset?: EditableRow | null, lockedContactId?: string): AssetFormValues {
  if (!asset) return { ...EMPTY_ASSET_FORM, contact_id: lockedContactId ?? '' };
  return {
    contact_id: asset.contact_id,
    name: asset.name,
    asset_type_id: asset.asset_type_id ?? '',
    product_id: asset.product_id ?? '',
    make: asset.make ?? '',
    model_no: asset.model_no ?? '',
    serial_no: asset.serial_no ?? '',
    installation_date: asset.installation_date ?? '',
    warranty_start: asset.warranty_start ?? '',
    warranty_end: asset.warranty_end ?? '',
    status: asset.status,
    site_label: asset.site_label ?? '',
    territory_id: asset.territory_id ?? '',
    notes: asset.notes ?? '',
  };
}

// ── Labels ─────────────────────────────────────────────────────────────────────

/** contacts.name is NULL for customers imported from a phone list; contacts.phone is NOT NULL. */
export function customerLabel(contact: { name: string | null; phone: string }): string {
  return contact.name?.trim() || contact.phone;
}

// ── Dates ──────────────────────────────────────────────────────────────────────

/**
 * Today's calendar date on THIS device as YYYY-MM-DD. Not toISOString(): that is the UTC date, which
 * for an Indian user between midnight and 05:30 is still "yesterday".
 */
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// ── Validation (before any request) ────────────────────────────────────────────

export type AssetFormErrors = Partial<Record<AssetFormField, string>>;

/** Display order, so the first error in the form is the one that gets focus. */
export const FIELD_ORDER: AssetFormField[] = [
  'contact_id',
  'name',
  'asset_type_id',
  'product_id',
  'make',
  'model_no',
  'serial_no',
  'installation_date',
  'warranty_start',
  'warranty_end',
  'status',
  'site_label',
  'territory_id',
  'notes',
];

export function firstErrorField(errors: AssetFormErrors): AssetFormField | null {
  return FIELD_ORDER.find((f) => errors[f]) ?? null;
}

/**
 * Everything the database would refuse that we can know without asking it. Each rule mirrors a
 * constraint, so a save that passes here cannot fail for these reasons (it can still fail for
 * others, e.g. a duplicate serial, which only the database can know).
 *
 * `today` is the device's calendar date (localIsoDate). The database allows an installation date up
 * to one day ahead of ITS date, to forgive a timezone edge; this is deliberately a little stricter
 * (today at the latest) because "installed tomorrow" is never right, and it can never be looser
 * than the database, so a passing form is not refused for the date.
 */
export function validateAssetForm(values: AssetFormValues, today: string): AssetFormErrors {
  const errors: AssetFormErrors = {};

  if (!values.contact_id.trim()) errors.contact_id = 'Choose a customer.';
  if (!values.name.trim()) errors.name = 'Enter a name for this asset.';

  const dateFields = ['installation_date', 'warranty_start', 'warranty_end'] as const;
  for (const f of dateFields) {
    if (values[f] && !isRealIsoDate(values[f])) errors[f] = 'Enter a valid date.';
  }

  if (!errors.installation_date && values.installation_date && values.installation_date > today) {
    errors.installation_date = 'Installation date cannot be in the future.';
  }

  if (
    !errors.warranty_start &&
    !errors.warranty_end &&
    values.warranty_start &&
    values.warranty_end &&
    values.warranty_end < values.warranty_start
  ) {
    errors.warranty_end = 'Warranty end cannot be before warranty start.';
  }

  return errors;
}

// ── Payload shaping ────────────────────────────────────────────────────────────

const blankToNull = (s: string): string | null => {
  const t = s.trim();
  return t === '' ? null : t;
};
const blankToUndefined = (s: string): string | undefined => blankToNull(s) ?? undefined;

/**
 * The row to INSERT. Blank optional fields are left out entirely. Never present, whatever the
 * values: asset_code, customer_name_snapshot, customer_phone_snapshot, deleted_at (the database
 * owns the first three; archiving is a targeted action). territory_id is present only when the user
 * picked one, so a blank still lets the database inherit the customer's.
 */
export function buildCreateInput(
  values: AssetFormValues,
  ctx: { accountId: string; createdBy?: string | null },
): CreateAssetInput {
  return {
    account_id: ctx.accountId,
    created_by: ctx.createdBy ?? null,
    contact_id: values.contact_id.trim(),
    name: values.name.trim(),
    asset_type_id: blankToUndefined(values.asset_type_id),
    product_id: blankToUndefined(values.product_id),
    make: blankToUndefined(values.make),
    model_no: blankToUndefined(values.model_no),
    serial_no: blankToUndefined(values.serial_no),
    installation_date: blankToUndefined(values.installation_date),
    warranty_start: blankToUndefined(values.warranty_start),
    warranty_end: blankToUndefined(values.warranty_end),
    status: values.status,
    site_label: blankToUndefined(values.site_label),
    territory_id: blankToUndefined(values.territory_id),
    notes: blankToUndefined(values.notes),
  };
}

const OPTIONAL_FIELDS = [
  'asset_type_id',
  'product_id',
  'make',
  'model_no',
  'serial_no',
  'installation_date',
  'warranty_start',
  'warranty_end',
  'site_label',
  'notes',
] as const satisfies readonly AssetFormField[];

/**
 * The UPDATE: only the fields the user actually changed. Sending untouched fields would overwrite
 * a colleague's concurrent edit to them, and would re-send a territory the picker may not even be
 * able to display (an archived one).
 *
 * - An emptied optional field is sent as null (clears it).
 * - territory_id is sent only when a different, non-blank territory was picked. Blank is never
 *   sent: once set, a territory cannot be cleared while the customer has one (the trigger would
 *   re-inherit it), so "clear" would silently do nothing.
 * - Never present: deleted_at, asset_code, either snapshot, account_id. An ordinary save must not
 *   post deleted_at: the archive guard compares it by value, and a millisecond-precision Date read
 *   from an archived row registers as a change and is refused for edit-only users.
 *
 * Returns an empty object when nothing changed.
 */
export function buildUpdateInput(values: AssetFormValues, original: EditableRow): UpdateAssetInput {
  const before = initialValues(original);
  const out: UpdateAssetInput = {};

  if (values.contact_id.trim() !== before.contact_id) out.contact_id = values.contact_id.trim();
  if (values.name.trim() !== before.name.trim()) out.name = values.name.trim();
  if (values.status !== before.status) out.status = values.status;

  for (const f of OPTIONAL_FIELDS) {
    if (blankToNull(values[f]) !== blankToNull(before[f])) {
      (out as Record<string, string | null>)[f] = blankToNull(values[f]);
    }
  }

  const territory = blankToNull(values.territory_id);
  if (territory && territory !== blankToNull(before.territory_id)) out.territory_id = territory;

  return out;
}

// ── Failures, worded for a person ──────────────────────────────────────────────

export type SaveFailure =
  /** A serial that already exists: rendered under the serial field with a link to the other asset. */
  | { kind: 'duplicate_serial'; serial: string | undefined; conflict: AssetConflict | null; message: string }
  /** A problem with one field: rendered under that field. */
  | { kind: 'field'; field: AssetFormField; message: string }
  /** Anything else: a banner above the form. `log` is true when the raw error is worth keeping in the console. */
  | { kind: 'banner'; message: string; retryable: boolean; log: boolean };

const GENERIC_SAVE_FAILURE = 'Something went wrong while saving this asset. Please try again.';

/**
 * Turn whatever a save threw into one of three renderings. A raw database or constraint string is
 * never returned: AssetError messages are ours, but an unmapped check violation carries the
 * database text as its message, so a validation error whose message IS the raw text is replaced.
 */
export function describeSaveError(err: unknown): SaveFailure {
  const e = err instanceof AssetError ? err : mapAssetError(err);

  switch (e.kind) {
    case 'duplicate_serial':
      return { kind: 'duplicate_serial', serial: e.serial, conflict: e.conflict ?? null, message: e.message };

    case 'duplicate_code':
      return { kind: 'banner', message: e.message, retryable: true, log: false };

    case 'reference_invalid':
      return {
        kind: 'banner',
        message: `${e.message} Reload the page and choose it again.`,
        retryable: false,
        log: false,
      };

    case 'permission':
      return {
        kind: 'banner',
        message: "You don't have permission to save assets. Ask an administrator to update your role.",
        retryable: false,
        log: false,
      };

    case 'not_found':
      return {
        kind: 'banner',
        message: 'This asset could not be found. It may have been removed, or you may not have permission to edit it.',
        retryable: false,
        log: false,
      };

    case 'network':
      return { kind: 'banner', message: e.message, retryable: true, log: false };

    case 'validation': {
      // First: an unmapped violation carries the database's own text as its message. Test for that
      // BEFORE looking for field keywords, or a table name like "customer_assets" in the raw text
      // would be taken for a customer error and shown verbatim.
      if (e.raw && e.message === e.raw) {
        return { kind: 'banner', message: 'Some values are not valid. Check the form and try again.', retryable: false, log: true };
      }
      const field = fieldForValidation(e.message);
      if (field) return { kind: 'field', field, message: e.message };
      return { kind: 'banner', message: e.message, retryable: false, log: false };
    }

    default:
      return { kind: 'banner', message: GENERIC_SAVE_FAILURE, retryable: true, log: true };
  }
}

/** Which field one of the data layer's validation messages is about. */
function fieldForValidation(message: string): AssetFormField | null {
  if (/warranty/i.test(message)) return 'warranty_end';
  if (/installation/i.test(message)) return 'installation_date';
  if (/name is required/i.test(message)) return 'name';
  if (/customer/i.test(message)) return 'contact_id';
  return null;
}
