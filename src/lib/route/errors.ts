// Route Management — typed error mapping (Phase 2a).
// The SDK maps raw PostgREST/Postgres errors into a small typed set so the UI can
// render friendly, actionable messages without inspecting SQLSTATE codes itself.
// Framework-agnostic (shared with mobile). See the RPCs in migrations 110-111 for the
// SQLSTATE conventions: 42501 permission/module, 40001 concurrency, 23514 validation,
// 23505 duplicate/cross-route, 23503 missing contact.

export type RouteErrorKind =
  | 'permission'
  | 'module_disabled'
  | 'concurrency'
  | 'validation'
  | 'conflict'
  | 'contact_missing'
  | 'not_found'
  | 'network'
  | 'unknown';

export class RouteError extends Error {
  readonly kind: RouteErrorKind;
  readonly code?: string;
  readonly retryable: boolean;
  constructor(kind: RouteErrorKind, message: string, code?: string) {
    super(message);
    this.name = 'RouteError';
    this.kind = kind;
    this.code = code;
    this.retryable = kind === 'network';
  }
}

interface RawPgError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

// Transient-detection lives in the generic SDK layer (@/lib/sdk/retry). RouteError sets
// `retryable` on 'network' errors so the generic isTransient() picks them up.

/** Convert a raw Supabase/Postgres error into a typed RouteError with a user-facing message. */
export function mapPostgrestError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  const e = (error ?? {}) as RawPgError;
  const code = e.code;
  const raw = e.message || 'Something went wrong.';

  if (code === undefined && (error as Error)?.name === 'TypeError') {
    return new RouteError('network', 'Network error — please check your connection and try again.');
  }

  switch (code) {
    case '40001':
      return new RouteError(
        'concurrency',
        'This route was changed by someone else. Reload and try again.',
        code
      );
    case '23505':
      return new RouteError(
        'conflict',
        'That customer already belongs to another route.',
        code
      );
    case '23503':
      return new RouteError('contact_missing', 'That customer no longer exists.', code);
    case '42501':
      if (/not enabled/i.test(raw)) {
        return new RouteError('module_disabled', 'Route Management is turned off for this account.', code);
      }
      if (/not found/i.test(raw)) {
        return new RouteError('not_found', 'That route could not be found.', code);
      }
      return new RouteError('permission', "You don't have permission to do that.", code);
    case '23514':
      // Our RPCs raise 23514 with already-friendly messages (e.g. "Route name is
      // required", "A reason is required to skip a stop"). Surface them directly.
      return new RouteError('validation', raw, code);
    default:
      return new RouteError('unknown', raw, code);
  }
}
