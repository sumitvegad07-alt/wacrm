// Asset data layer — typed error mapping. Framework-agnostic (reusable on mobile), same idea as
// src/lib/route/errors.ts: turn a raw PostgREST/Postgres error into a small typed set so screens
// render friendly, actionable messages without inspecting SQLSTATEs themselves.
//
// SQLSTATEs come from the customer_assets migration (20260929152000):
//   23505  customer_assets_uniq_serial / customer_assets_uniq_code (partial unique indexes)
//   23503  trigger tenant-integrity RAISE (contact / asset type / product / territory / created_by)
//   42501  RLS denial, or the trigger's archive/restore guard (needs delete_service_assets)
//   23514  CHECK constraints (name not blank, warranty order, install date)
//   22023  trigger: account_id or a live asset_code changed (the data layer never sends either)
//   22P02  malformed uuid / enum text (e.g. a hand-edited URL filter)

export type AssetErrorKind =
  | 'duplicate_serial'
  | 'duplicate_code'
  | 'reference_invalid'
  | 'permission'
  | 'validation'
  | 'not_found'
  | 'network'
  | 'unknown';

/** The live asset that already holds a serial number. */
export interface AssetConflict {
  id: string;
  asset_code: string;
}

export class AssetError extends Error {
  readonly kind: AssetErrorKind;
  readonly code?: string;
  /** duplicate_serial only: the serial the caller tried to save, exactly as sent. */
  readonly serial?: string;
  /** duplicate_serial only: the asset that already has it, once api.ts has looked it up. */
  readonly conflict?: AssetConflict | null;
  /** The raw database message, for logs. Never show this to a user. */
  readonly raw?: string;
  readonly retryable: boolean;

  constructor(
    kind: AssetErrorKind,
    message: string,
    opts: { code?: string; serial?: string; conflict?: AssetConflict | null; raw?: string } = {},
  ) {
    super(message);
    this.name = 'AssetError';
    this.kind = kind;
    this.code = opts.code;
    this.serial = opts.serial;
    this.conflict = opts.conflict;
    this.raw = opts.raw;
    this.retryable = kind === 'network';
  }

  /** duplicate_serial: a copy carrying the conflicting asset and the "already exists on asset X" message. */
  withConflict(conflict: AssetConflict | null): AssetError {
    if (this.kind !== 'duplicate_serial') return this;
    return new AssetError('duplicate_serial', duplicateSerialMessage(this.serial, conflict), {
      code: this.code,
      serial: this.serial,
      conflict,
      raw: this.raw,
    });
  }
}

function duplicateSerialMessage(serial: string | undefined, conflict: AssetConflict | null): string {
  const s = serial ? `Serial ${serial}` : 'That serial number';
  return conflict ? `${s} already exists on asset ${conflict.asset_code}` : `${s} already exists on another asset`;
}

interface RawPgError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/** Which reference a 23503 is about, read from the trigger message or the FK constraint name. */
function referenceLabel(text: string): string | null {
  if (/contact/i.test(text)) return 'customer';
  if (/asset_type/i.test(text)) return 'asset type';
  if (/product/i.test(text)) return 'product';
  if (/territor/i.test(text)) return 'territory';
  if (/created_by|profiles/i.test(text)) return 'creator';
  return null;
}

/**
 * Convert a raw Supabase/Postgres error into a typed AssetError with a user-facing message.
 * `ctx.serial` is the serial the caller was saving; it cannot be read back reliably from the
 * database error (the unique index is on lower(serial_no), so the reported key is lower-cased).
 */
export function mapAssetError(error: unknown, ctx: { serial?: string } = {}): AssetError {
  if (error instanceof AssetError) return error;
  const e = (error ?? {}) as RawPgError;
  const code = e.code || undefined;
  const raw = e.message || 'Something went wrong.';
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ');

  // supabase-js reports a failed fetch either as a thrown TypeError or as an error with no SQLSTATE.
  if (
    (error as Error | null)?.name === 'TypeError' ||
    (!code && /failed to fetch|fetch failed|networkerror|network request failed/i.test(raw))
  ) {
    return new AssetError('network', 'Network error — please check your connection and try again.', { raw });
  }

  switch (code) {
    case '23505':
      if (/customer_assets_uniq_serial/.test(text)) {
        return new AssetError('duplicate_serial', duplicateSerialMessage(ctx.serial, null), {
          code,
          serial: ctx.serial,
          raw,
        });
      }
      if (/customer_assets_uniq_code/.test(text)) {
        return new AssetError(
          'duplicate_code',
          'That asset code is already in use. Please try saving again.',
          { code, raw },
        );
      }
      return new AssetError('unknown', raw, { code, raw });

    case '23503': {
      const what = referenceLabel(text);
      return new AssetError(
        'reference_invalid',
        what ? `That ${what} is not in this account.` : 'A selected customer, product, type or territory is not in this account.',
        { code, raw },
      );
    }

    case '42501':
      if (/archiving or restoring/i.test(text)) {
        return new AssetError('permission', "You don't have permission to archive or restore assets.", { code, raw });
      }
      return new AssetError('permission', "You don't have permission to do that.", { code, raw });

    case '23514':
      if (/warranty_order/.test(text)) {
        return new AssetError('validation', 'Warranty end cannot be before warranty start.', { code, raw });
      }
      if (/install_date/.test(text)) {
        return new AssetError('validation', 'Installation date cannot be in the future.', { code, raw });
      }
      if (/name_not_blank/.test(text)) {
        return new AssetError('validation', 'Asset name is required.', { code, raw });
      }
      return new AssetError('validation', raw, { code, raw });

    case '22023':
    case '22P02':
      return new AssetError('validation', 'One of the values is not valid.', { code, raw });

    default:
      return new AssetError('unknown', raw, { code, raw });
  }
}
