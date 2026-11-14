/**
 * Where a distributor signs in.
 *
 * ONE place. The moment this address appears in two files it will appear in
 * two forms — one with a trailing slash, one on http, one left on a staging
 * host — and the one an admin copies will be whichever file was edited last.
 * The CRM shows it, the invitation wording uses it, and anything later that
 * needs it imports from here.
 *
 * Overridable by `NEXT_PUBLIC_DMS_PORTAL_URL` so a staging CRM can point at a
 * staging portal, and so this is not a code change the day the address moves.
 */

const FALLBACK = "https://dms.ozzo.co.in";

/**
 * The portal's address, with no trailing slash.
 *
 * Takes the raw value rather than reading process.env itself, so the test can
 * drive every branch without touching the environment — and so a caller can
 * pass a value from somewhere else later without this growing a second door.
 */
export function normalizePortalUrl(raw?: string | null): string {
  const value = (raw ?? "").trim();
  if (value === "") return FALLBACK;
  // A bare host is the likeliest way this gets mis-set, and `dms.ozzo.co.in`
  // in an href resolves against the CRM's own origin — it would send the admin
  // to app.ozzo.co.in/dms.ozzo.co.in and look like a broken portal.
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

export function portalUrl(): string {
  return normalizePortalUrl(process.env.NEXT_PUBLIC_DMS_PORTAL_URL);
}
