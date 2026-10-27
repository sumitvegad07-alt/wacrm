/**
 * The three states a permission gate can be in.
 *
 * "loading" is the one that was missing. A gate that only knows
 * allowed/denied has to call the initial-load window a denial, which is
 * how the account owner got "Access Denied" on a cold load.
 */
export type PermissionGateState = "loading" | "allowed" | "denied";

export interface PermissionGateInput {
  /** `profileLoading` from `useAuth()` — NOT the session-level `loading`. */
  profileLoading: boolean;
  /**
   * The page's own verdict, e.g. `hasPermission("view_x")` or
   * `hasPermission("view_x") || isSuperadmin`. Only consulted once the
   * profile has settled, because until then it is false for everybody.
   */
  allowed: boolean;
}

/**
 * Decide whether to render a page, refuse it, or wait.
 *
 * `use-auth` flips session `loading` to false without waiting for the
 * profile row, so there is a window where `permissions` and `accountRole`
 * are both null. In that window `hasPermission()` returns false for
 * everyone — including owners and superadmins, whose short-circuit reads
 * the same null profile. Deciding on it produces a false refusal.
 *
 * So the profile is checked FIRST, and `allowed` is only consulted once it
 * means something. This fails closed in both directions: an unidentified
 * user is never refused, and never shown gated content either.
 *
 * Mirrors `components/auth/require-role.tsx`, which already does this for
 * account roles.
 */
export function permissionGateState({
  profileLoading,
  allowed,
}: PermissionGateInput): PermissionGateState {
  if (profileLoading) return "loading";
  return allowed ? "allowed" : "denied";
}
