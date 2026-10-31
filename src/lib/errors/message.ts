/**
 * One place that turns anything thrown into a sentence worth showing.
 *
 * WHY THIS EXISTS. Every panel used to write:
 *
 *     toast.error(err instanceof Error ? err.message : 'Failed to save X');
 *
 * supabase-js never rejects with an `Error`. A failed query resolves with a
 * plain object — `{ code, message, details, hint }` — so `instanceof Error` was
 * false on every database failure in the app and the real reason was thrown
 * away. On 31 Oct 2026 a tenant's session expired while the Company Profile
 * page was open; PostgREST answered the save with
 *
 *     401 { code: 'PGRST301', message: 'No suitable key or wrong key type' }
 *
 * and the only thing anyone — the user, or us reading the report — ever saw was
 * "Failed to save company profile". The cause was invisible from the screen,
 * from the logs, and from the support ticket.
 *
 * Pass the fallback as the second argument and the real reason always wins.
 */

/** Shown whenever the sign-in has lapsed. Plain English, no error codes. */
export const SESSION_EXPIRED_MESSAGE =
  'Your sign-in has expired. Please sign in again and retry — nothing was saved.';

/** Shown when the browser could not reach the server at all. */
export const OFFLINE_MESSAGE =
  'Could not connect to the server. Check your internet connection and try again — nothing was saved.';

type Loose = Record<string, unknown>;

function asRecord(err: unknown): Loose | null {
  return err !== null && typeof err === 'object' ? (err as Loose) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * True when the failure means "this browser is no longer signed in" — an
 * expired access token, a refresh token another tab already spent, or a
 * rejected JWT. These are the ones worth recovering from rather than
 * reporting; see `src/lib/supabase/client.ts`.
 */
export function isSessionExpired(err: unknown): boolean {
  const e = asRecord(err);
  if (!e) return false;

  const code = text(e.code);
  if (code === 'PGRST301' || code === 'PGRST302') return true;
  // GoTrue and PostgREST both answer 401 for a session that no longer holds.
  if (e.status === 401 || e.statusCode === 401) return true;

  const message = `${text(e.message)} ${text(e.details)}`.toLowerCase();
  if (!message.trim()) return false;
  return (
    message.includes('jwt expired') ||
    message.includes('jwt is expired') ||
    message.includes('invalid claim') ||
    message.includes('refresh token') ||
    message.includes('session from session_id claim in jwt does not exist') ||
    message.includes('no suitable key or wrong key type')
  );
}

/** True when the request never reached the server. */
function isNetworkFailure(err: unknown): boolean {
  const e = asRecord(err);
  const message = (text(e?.message) || text(err)).toLowerCase();
  if (!message) return false;
  // Safari reports a dropped request as exactly "Load failed". Matched whole,
  // not as a substring: "Image upload failed" ends in those same two words.
  if (/^(typeerror:\s*)?load failed\.?$/.test(message)) return true;
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('err_internet_disconnected')
  );
}

/**
 * The sentence to show the user.
 *
 * `fallback` is used only when the thrown value carries nothing readable at
 * all — never in preference to a real database message.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const safeFallback = fallback.trim() || 'Something went wrong. Please try again.';

  if (isSessionExpired(err)) return SESSION_EXPIRED_MESSAGE;
  if (isNetworkFailure(err)) return OFFLINE_MESSAGE;

  if (typeof err === 'string') return err.trim() || safeFallback;

  const e = asRecord(err);
  if (!e) return safeFallback;

  const message = text(e.message);
  const details = text(e.details);
  const hint = text(e.hint);
  const code = text(e.code);

  if (!message && !details) return safeFallback;

  // The message names the failure; details usually names the row or column that
  // caused it, which is the half that makes a report actionable.
  const parts = [message || details];
  if (message && details && details !== message) parts.push(details);
  if (hint) parts.push(hint);

  let out = parts.join(' ');
  // Keep the database code — a support report that says 23505 can be answered
  // without a reproduction; one that says "Failed to save" cannot.
  if (code && !out.includes(code)) out = `${out} (${code})`;
  return out;
}
