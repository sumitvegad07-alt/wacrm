/**
 * Account row lookup for AuthProvider, tolerant of a schema that predates the
 * DMS columns. If `account` came back null, every screen in the app would
 * break for every tenant, so a purely additive column must never cause that.
 */

export const ACCOUNT_COLUMNS_BASE =
  "id, customer_id, name, default_currency, subscription_status, subscription_plan, industry, is_provisioned, subscription_expires_at, module_settings, settings";
export const ACCOUNT_COLUMNS_FULL = `${ACCOUNT_COLUMNS_BASE}, addon_lines, portal_seats_limit`;

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

/** Run the account select; on an undefined-column error retry ONCE without the DMS columns. */
export async function selectAccountRow(run: Run): Promise<Result> {
  const first = await run(ACCOUNT_COLUMNS_FULL);
  if (!isUndefinedColumn(first.error)) return first;
  return run(ACCOUNT_COLUMNS_BASE);
}
