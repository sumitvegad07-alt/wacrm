/**
 * Account row lookup for AuthProvider, tolerant of a schema that predates the
 * newest additive columns. If `account` came back null, every screen in the app
 * would break for every tenant, so a purely additive column must never cause
 * that.
 *
 * The column sets are a LADDER, newest first, and the retry walks DOWN it one
 * rung at a time. The DMS columns used to be the only rung, and lumping
 * `custom_features` in with them would have meant that in the window between
 * this deploy and the migration being pasted into Supabase, every account also
 * lost `addon_lines` — switching the live DMS off for the client who bought it.
 * One new column therefore gets one new rung.
 */

export const ACCOUNT_COLUMNS_BASE =
  "id, customer_id, name, default_currency, subscription_status, subscription_plan, industry, is_provisioned, subscription_expires_at, module_settings, settings";
/** BASE + the DMS add-on columns (20261107, 20261108). */
export const ACCOUNT_COLUMNS_FULL = `${ACCOUNT_COLUMNS_BASE}, addon_lines, portal_seats_limit`;
/** FULL + per-client switches (20261127). What a current database has. */
export const ACCOUNT_COLUMNS_LATEST = `${ACCOUNT_COLUMNS_FULL}, custom_features`;

/** Newest first. Each rung drops exactly one migration's worth of columns. */
export const ACCOUNT_COLUMN_LADDER = [
  ACCOUNT_COLUMNS_LATEST,
  ACCOUNT_COLUMNS_FULL,
  ACCOUNT_COLUMNS_BASE,
] as const;

interface PgErr {
  code?: string | null;
  message?: string | null;
}

/** Narrow on purpose: RLS, network and auth failures must NOT be retried. */
export function isUndefinedColumn(err: PgErr | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42703" || /column .* does not exist/i.test(err.message ?? "");
}

type Result = { data: any; error: any };
type Run = (columns: string) => PromiseLike<Result>;

/**
 * Run the account select, stepping down the ladder on an undefined-column
 * error. Any other error (RLS, network, auth) is returned as-is on the spot.
 */
export async function selectAccountRow(run: Run): Promise<Result> {
  let last: Result | undefined;
  for (const columns of ACCOUNT_COLUMN_LADDER) {
    last = await run(columns);
    if (!isUndefinedColumn(last.error)) return last;
  }
  return last as Result;
}
