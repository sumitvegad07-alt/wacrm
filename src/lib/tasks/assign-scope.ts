/**
 * WHO may a user hand an activity to — the decision, on its own.
 *
 * Pulled out of the hook so the rule can be tested without a session, a
 * Supabase client or a rendered form, and so the web and mobile copies can be
 * compared line by line. Mirrored at
 * wacrm-mobile/src/lib/tasks/assignScope.ts — change one, change the other.
 *
 * The founder's rule (2026-11-09): assigning work is directional, exactly as
 * reading it is.
 *
 *   assign_tasks_all    → anyone in the account
 *   assign_tasks_child  → the people reporting to you, down the tree
 *   assign_tasks_parent → your managers, up the chain
 *   none of them        → only yourself
 *
 * and the two DIRECTIONAL rights mean nothing while Reporting Hierarchy is
 * off: with no manager tree there is no up and no down, so they fall back to
 * yourself. `assign_tasks_all` is not directional and needs no hierarchy.
 */

export interface AssignRights {
  /** Owner / admin / superadmin / a role with `all`. */
  unrestricted: boolean;
  assignAll: boolean;
  assignChild: boolean;
  assignParent: boolean;
  /** accounts.module_settings.reporting_hierarchy */
  hierarchyOn: boolean;
}

export type AssignMode =
  /** Everyone in the account. */
  | 'all'
  /** The viewer plus their reporting tree, in the directions they hold. */
  | 'tree'
  /** The viewer alone — the assignee control is hidden entirely. */
  | 'self';

export function decideAssignMode(rights: AssignRights): AssignMode {
  if (rights.unrestricted || rights.assignAll) return 'all';
  if (!rights.hierarchyOn) return 'self';
  if (rights.assignChild || rights.assignParent) return 'tree';
  return 'self';
}
