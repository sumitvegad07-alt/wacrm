// Who may open the FSM asset screens. Pure on purpose: the server guard
// (require-access.ts) feeds it real data, and the unit test feeds it fixtures.
//
// Two conditions, both required (spec section 7.1, "Permission denied"):
//   1. the account's plan includes the `fsm` product line, and
//   2. the user holds `view_service_assets`.
//
// Owner and admin bypass the permission check, exactly as `useAuth().hasPermission` does on the
// client (src/hooks/use-auth.tsx), so the server and the nav item can never disagree about them.
// They do NOT bypass the plan line: an owner on a CRM plan still has no Service module.
//
// Deliberately NOT checked here: `isModuleEnabled('service')`. ModuleSettings has no `service`
// key until the settings task adds one, so it could not return true yet.

import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { hasPermission, type RolePermissions } from '@/lib/auth/rbac';
import type { AccountRole } from '@/lib/auth/roles';
import { planHasLine } from '@/lib/plans/catalog';

export interface ServiceAccessInput {
  /** accounts.subscription_plan, raw. Legacy / unknown values resolve to "no fsm" (see planLines). */
  plan: unknown;
  accountRole: AccountRole;
  /** employee_roles.permissions for the user, or null when they have no employee role. */
  permissions: RolePermissions | null;
}

export function canViewServiceAssets({ plan, accountRole, permissions }: ServiceAccessInput): boolean {
  if (!planHasLine(plan, 'fsm')) return false;
  if (accountRole === 'owner' || accountRole === 'admin') return true;
  return hasPermission(permissions, PERMISSIONS.SERVICE_ASSETS.VIEW);
}
