// ============================================================
// rbac.ts - Employee Role (Business Role) Evaluator
//
// Evaluates the granular JSON permissions assigned to an Employee Role.
// This acts as the source of truth for UI visibility and API checks.
// Data scoping (Own, Team, Company, All) is also extracted here.
// ============================================================

export type DataScope = "own" | "team" | "department" | "company" | "all";

export type RolePermissions = {
  all?: boolean; // Super Admin override
  [key: string]: boolean | string | undefined;
};

/**
 * Validates if the current employee role has a specific permission.
 * 
 * @param permissions The parsed JSONB permissions from employee_roles
 * @param key The specific permission key (e.g., 'view_leads', 'mobile_logout')
 */
export function hasPermission(
  permissions: RolePermissions | null | undefined,
  key: string
): boolean {
  if (!permissions) return false;

  // Super Admin / Owner override
  if (permissions.all === true) return true;

  if (permissions[key] === true) return true;

  // Creation rights were stored as `add_<module>` before the move to `create_<module>`,
  // and roles in the wild still carry either spelling. Installed mobile builds check the
  // legacy keys directly and cannot be updated retroactively, so both prefixes must keep
  // resolving instead of renaming the stored data out from under them.
  const alias = key.startsWith("create_")
    ? `add_${key.slice("create_".length)}`
    : key.startsWith("add_")
      ? `create_${key.slice("add_".length)}`
      : null;

  return alias !== null && permissions[alias] === true;
}

/**
 * Generic multi-key helpers — the building blocks module-specific permission APIs
 * (e.g. route/permissions.ts) compose. Owner/admin (permissions.all) bypass via hasPermission.
 */
export function hasAnyPermission(
  permissions: RolePermissions | null | undefined,
  keys: string[]
): boolean {
  return keys.some((k) => hasPermission(permissions, k));
}

export function hasAllPermissions(
  permissions: RolePermissions | null | undefined,
  keys: string[]
): boolean {
  return keys.every((k) => hasPermission(permissions, k));
}

/**
 * Returns the data visibility scope for a given module.
 * Defaults to 'own' if not explicitly defined.
 */
export function getDataScope(
  permissions: RolePermissions | null | undefined,
  module: string
): DataScope {
  if (!permissions) return "own";
  
  if (permissions.all === true) return "all";

  const scope = permissions[`${module}_scope`];
  if (!scope || typeof scope !== "string") return "own";

  return scope as DataScope;
}
