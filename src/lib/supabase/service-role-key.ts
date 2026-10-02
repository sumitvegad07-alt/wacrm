// ============================================================
// Where the Supabase service-role key is read from.
//
// The canonical name is SUPABASE_SERVICE_ROLE_KEY, and that is the only name
// any new environment should use. Production additionally answers to the
// legacy name `service_role`, because that is what the key was called when it
// was re-added to Vercel during the Singapore → Mumbai move on 27 September
// 2026. Vercel will not rename a Secret variable — the key field is read-only
// and the value is write-only — so the alias lives here instead.
//
// The cost of the mismatch was the whole superadmin panel: serviceClient()
// threw on a missing key, toErrorResponse() collapsed that to a generic 500,
// and every cross-tenant screen read "Internal server error" with nothing to
// say which setting was wrong.
//
// Pure env reads, no imports: safe to call from any server module.
// ============================================================

/** Every variable name that may hold the key, in order of precedence. */
export const SERVICE_ROLE_KEY_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
] as const;

/**
 * The service-role key, or undefined when nothing holds one.
 *
 * A variable that exists but is blank counts as absent, so an empty
 * SUPABASE_SERVICE_ROLE_KEY cannot shadow a usable fallback.
 */
export function serviceRoleKey(): string | undefined {
  for (const name of SERVICE_ROLE_KEY_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.trim()) return value;
  }
  return undefined;
}
