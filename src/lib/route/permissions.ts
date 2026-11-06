// Route Management — permission keys + helpers.
//
// NINE RIGHTS, NOT TWENTY (2026-11-05). The Roles editor used to show twenty
// route checkboxes under four sub-headings. The founder, reviewing his own
// screen: "currently it is too much confusing... we have rights for route and
// customers in those routes which creates confusion to me also IDK about my
// clients how will they feel".
//
// He was right. Nobody grants "Reorder customers" while withholding "Remove
// customers" — both are the one job of editing a route. The twenty keys
// enumerated every RPC rather than every decision an admin actually takes.
//
// HOW THE COLLAPSE IS DONE. The constant NAMES below are all still here, so
// every call site (route-workspace, planner-board, route-list, the mobile
// guards) compiles and behaves unchanged. What changed is the STRING several
// of them resolve to: CLONE is now 'add_routes', ARCHIVE is 'delete_routes',
// ADD_CUSTOMERS / REMOVE_CUSTOMERS / REORDER_CUSTOMERS / MANAGE_CUSTOMERS /
// MANAGE_SCHEDULE are all 'edit_routes', and so on. Asking "can this user
// reorder customers?" is now literally asking "can they edit routes?".
//
// Server-side, migrations 110 and 111 still check the original granular
// strings inside the RPCs. Rewriting eleven RPCs to rename a string is pure
// risk for no gain, so migration 20261105130000 teaches has_permission a route
// alias map instead: asked for a retired key, it also accepts the survivor.
// The RPCs were not touched. That migration also backfills every existing
// role, so a role that held only 'reorder_route_customers' gains 'edit_routes'
// and loses nothing on deploy day.
//
// The DB remains authoritative; these keys only show and hide UI.

import { hasPermission, type RolePermissions } from '@/lib/auth/rbac';

export const ROUTE_PERMISSIONS = {
  // ── The nine real rights ───────────────────────────────────
  VIEW: 'view_routes',
  ADD: 'add_routes',
  EDIT: 'edit_routes',
  DELETE: 'delete_routes',
  APPROVE: 'approve_routes',
  EXECUTE: 'execute_route',
  MODIFY_SEQUENCE: 'modify_route_sequence',
  RESTRICT_OFF_ROUTE: 'restrict_off_route_visits',
  /** Nearest-customer suggestion on the mobile Active Route screen. */
  OPTIMIZE: 'optimize_routes',

  // ── Retired names, kept so call sites need no edit ─────────
  // Each now resolves to the right that covers it. Do not reintroduce these as
  // separate checkboxes; they exist only so existing code reads naturally.
  /** @deprecated A clone is a new route. Resolves to ADD. */
  CLONE: 'add_routes',
  /** @deprecated Assigning in the planner is the same manager decision as approving. */
  ASSIGN: 'approve_routes',
  /** @deprecated Archiving is a soft delete. */
  ARCHIVE: 'delete_routes',
  /** @deprecated Managing a route's customers is editing the route. */
  MANAGE_CUSTOMERS: 'edit_routes',
  /** @deprecated */
  ADD_CUSTOMERS: 'edit_routes',
  /** @deprecated */
  REMOVE_CUSTOMERS: 'edit_routes',
  /** @deprecated */
  REORDER_CUSTOMERS: 'edit_routes',
  /** @deprecated A route's schedule is part of the route. */
  MANAGE_SCHEDULE: 'edit_routes',
  /** @deprecated Seeing the queue is part of approving. */
  VIEW_APPROVALS: 'approve_routes',
  /** @deprecated Health is a read-only view of routes you can already see. */
  VIEW_HEALTH: 'view_routes',
  /** @deprecated Executions likewise. */
  VIEW_EXECUTIONS: 'view_routes',
  /** @deprecated Skipping a stop and visiting out of order are one freedom. */
  SKIP_STOP: 'modify_route_sequence',
} as const;

export type RoutePermissionKey = (typeof ROUTE_PERMISSIONS)[keyof typeof ROUTE_PERMISSIONS];

/**
 * What the Roles editor renders. One flat list — the four sub-headings were
 * half the confusion, because "Route customers" read like a separate module.
 * Order is the order an admin thinks in: look, build, change, remove, approve,
 * run, bend the rules.
 */
export const ROUTE_PERMISSION_GROUPS: {
  group: string;
  keys: { key: RoutePermissionKey; label: string; hint?: string }[];
}[] = [
  {
    group: 'Route Management',
    keys: [
      { key: ROUTE_PERMISSIONS.VIEW, label: 'View routes',
        hint: 'Also covers route health and past route runs.' },
      { key: ROUTE_PERMISSIONS.ADD, label: 'Create routes',
        hint: 'Includes copying an existing route.' },
      { key: ROUTE_PERMISSIONS.EDIT, label: 'Edit routes',
        hint: 'Add or remove customers, change their order, change the schedule.' },
      { key: ROUTE_PERMISSIONS.DELETE, label: 'Delete routes',
        hint: 'Includes archiving and restoring.' },
      { key: ROUTE_PERMISSIONS.APPROVE, label: 'Assign & approve routes',
        hint: 'Give a route to a salesman in the planner, and approve or reject it.' },
      { key: ROUTE_PERMISSIONS.EXECUTE, label: 'Run routes',
        hint: 'Start the day, check in at each stop, complete the route.' },
      { key: ROUTE_PERMISSIONS.MODIFY_SEQUENCE, label: 'Skip or visit stops out of order',
        hint: 'Without this, stops must be visited in the planned order.' },
      { key: ROUTE_PERMISSIONS.RESTRICT_OFF_ROUTE, label: 'Restrict off-route visits',
        hint: "Blocks visiting a customer who is not on today's route." },
      { key: ROUTE_PERMISSIONS.OPTIMIZE, label: 'Use route optimization',
        hint: 'Shows the nearest unvisited customer on the mobile Active Route screen.' },
    ],
  },
];

/** All route permission keys as a flat list — the nine, de-duplicated. */
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
