/**
 * Proves a write actually happened.
 *
 * PostgREST answers an UPDATE or DELETE that row-level security filtered out
 * with `204 No Content` and **no error**: the statement ran, it simply matched
 * no row. supabase-js passes that back as `{ data: null, error: null }`, which
 * every call site in this app read as success. So a tenant could press Save,
 * see "Saved", and have written nothing — the silent half of the 31 Oct 2026
 * report from tenant 001300 ("data is not saving", with no error on screen).
 *
 * Usage: ask the write to return what it touched, then check it.
 *
 *     const result = await supabase
 *       .from('accounts')
 *       .update({ settings })
 *       .eq('id', accountId)
 *       .select('id');
 *     ensureWritten(result, 'company profile');
 *
 * The `.select()` matters: without it `data` is always null and there is
 * nothing to verify.
 */

import { errorMessage } from './message';

export const NOT_PERMITTED_MESSAGE = (what: string) =>
  `Could not save the ${what} — the change did not reach the database. ` +
  `You may not have permission to edit it, or it may have been removed. Nothing was saved.`;

export interface WriteResult<T> {
  data: T | T[] | null;
  error: unknown;
}

/**
 * Throws unless the write both succeeded and touched at least one row.
 * `what` names the thing being saved, for the message the user reads.
 */
export function ensureWritten<T>(result: WriteResult<T>, what: string): void {
  if (result.error) {
    throw new Error(errorMessage(result.error, `Could not save the ${what}.`));
  }

  const rows = result.data;
  const touched = Array.isArray(rows) ? rows.length > 0 : rows != null;
  if (!touched) {
    throw new Error(NOT_PERMITTED_MESSAGE(what));
  }
}
