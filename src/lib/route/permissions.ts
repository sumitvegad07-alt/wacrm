// Route Management — permission keys + helpers (Phase 2a).
// Granular, flat keys (no bundling), owner/admin bypass via the existing rbac.hasPermission
// (permissions.all === true). These are the SAME keys the RPCs check server-side
// (migrations 110-111); the UI uses them only to show/hide actions — the DB is authoritative.

import { hasPermission, type RolePermissions } from '@/lib/auth/rbac';

export const ROUTE_PERMISSIONS = {
  VIEW: 'view_routes',
  ADD: 'add_routes',
  EDIT: 'edit_routes',
  DELETE: 'delete_routes',
  CLONE: 'clone_routes',
  ASSIGN: 'assign_routes',
  APPROVE: 'approve_routes',
  ARCHIVE: 'archive_routes',
  MANAGE_CUSTOMERS: 'manage_route_customers',
  ADD_CUSTOMERS: 'add_route_customers',
  REMOVE_CUSTOMERS: 'remove_route_customers',
  REORDER_CUSTOMERS: 'reorder_route_customers',
  MANAGE_SCHEDULE: 'manage_route_schedule',
  VIEW_APPROVALS: 'view_route_approvals',
  VIEW_HEALTH: 'view_route_health',
  VIEW_EXECUTIONS: 'view_route_executions',
  EXECUTE: 'execute_route',
  SKIP_STOP: 'skip_route_stop',
  MODIFY_SEQUENCE: 'modify_route_sequence',
  RESTRICT_OFF_ROUTE: 'restrict_off_route_visits',
} as const;

export type RoutePermissionKey = (typeof ROUTE_PERMISSIONS)[keyof typeof ROUTE_PERMISSIONS];

/** Grouped for the Roles editor UI (team/roles). Order/labels are display-only. */
export const ROUTE_PERMISSION_GROUPS: {
  group: string;
  keys: { key: RoutePermissionKey; label: string }[];
}[] = [
  {
    group: 'Routes',
    keys: [
      { key: ROUTE_PERMISSIONS.VIEW, label: 'View routes' },
      { key: ROUTE_PERMISSIONS.ADD, label: 'Create routes' },
      { key: ROUTE_PERMISSIONS.EDIT, label: 'Edit routes' },
      { key: ROUTE_PERMISSIONS.DELETE, label: 'Delete routes' },
      { key: ROUTE_PERMISSIONS.CLONE, label: 'Clone routes' },
      { key: ROUTE_PERMISSIONS.ARCHIVE, label: 'Archive / restore routes' },
    ],
  },
  {
    group: 'Route customers',
    keys: [
      { key: ROUTE_PERMISSIONS.MANAGE_CUSTOMERS, label: 'Manage route customers' },
      { key: ROUTE_PERMISSIONS.ADD_CUSTOMERS, label: 'Add / import customers' },
      { key: ROUTE_PERMISSIONS.REMOVE_CUSTOMERS, label: 'Remove customers' },
      { key: ROUTE_PERMISSIONS.REORDER_CUSTOMERS, label: 'Reorder customers' },
    ],
  },
  {
    group: 'Planning & approval',
    keys: [
      { key: ROUTE_PERMISSIONS.ASSIGN, label: 'Assign in planner' },
      { key: ROUTE_PERMISSIONS.MANAGE_SCHEDULE, label: 'Manage schedule' },
      { key: ROUTE_PERMISSIONS.VIEW_APPROVALS, label: 'View approvals queue' },
      { key: ROUTE_PERMISSIONS.APPROVE, label: 'Approve / reject routes' },
    ],
  },
  {
    group: 'Execution & health',
    keys: [
      { key: ROUTE_PERMISSIONS.VIEW_HEALTH, label: 'View route health' },
      { key: ROUTE_PERMISSIONS.VIEW_EXECUTIONS, label: 'View route executions' },
      { key: ROUTE_PERMISSIONS.EXECUTE, label: 'Run routes (start / complete)' },
      { key: ROUTE_PERMISSIONS.SKIP_STOP, label: 'Skip route stop' },
      { key: ROUTE_PERMISSIONS.RESTRICT_OFF_ROUTE, label: 'Restrict off-route visits' },
    ],
  },
];

/** All route permission keys as a flat list. */
export const ALL_ROUTE_PERMISSION_KEYS: RoutePermissionKey[] = ROUTE_PERMISSION_GROUPS.flatMap(
  (g) => g.keys.map((k) => k.key)
);

/** UI gate for a single route action. Owner/admin (permissions.all) bypass. */
export function hasRoutePermission(
  permissions: RolePermissions | null | undefined,
  key: RoutePermissionKey
): boolean {
  return hasPermission(permissions, key);
}
