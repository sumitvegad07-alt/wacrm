// ------------------------------------------------------------
// Notification catalog — the single source of truth mapping a business event to
// its notification category, the right that gates it, who receives it, and the
// text shown. Kept declarative and free of IO so the generator's decisions are
// unit-testable without a database.
//
// Category == mute unit == gating right (1:1), so a user's "mute announcements"
// toggle and their "receive announcements" right always refer to the same set.
// ------------------------------------------------------------

import { PERMISSIONS } from '@/lib/auth/permissions-registry'

export const NOTIFICATION_CATEGORIES = [
  'task',
  'assignment',
  'announcement',
  'team_activity',
  'punch_alarm',
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

/** The right that must be held for a category to be generated for a user. */
export const CATEGORY_RIGHT: Record<NotificationCategory, string> = {
  task: PERMISSIONS.NOTIFICATIONS.RECEIVE_TASK,
  assignment: PERMISSIONS.NOTIFICATIONS.RECEIVE_ASSIGNMENT,
  announcement: PERMISSIONS.NOTIFICATIONS.RECEIVE_ANNOUNCEMENT,
  team_activity: PERMISSIONS.NOTIFICATIONS.RECEIVE_TEAM_ACTIVITY,
  punch_alarm: PERMISSIONS.NOTIFICATIONS.RECEIVE_PUNCH_ALARM,
}

/**
 * How an event's recipients are found:
 *  - 'assignee'  → the person the record was assigned to (assignment alerts).
 *  - 'team'      → the actor's manager + account admins (team-activity, item 3).
 *  - 'announcement' → the announcement's explicit targets, or everyone.
 */
export type RecipientStrategy = 'assignee' | 'team' | 'announcement'

export interface EventSpec {
  category: NotificationCategory
  strategy: RecipientStrategy
  /** Entity type used for the mobile/web deep-link. */
  entity: string
}

export const EVENT_SPECS: Record<string, EventSpec> = {
  // team-activity (item 3): rep did something → notify manager + admins
  order_created: { category: 'team_activity', strategy: 'team', entity: 'order' },
  customer_created: { category: 'team_activity', strategy: 'team', entity: 'contact' },
  lead_created: { category: 'team_activity', strategy: 'team', entity: 'lead' },
  deal_created: { category: 'team_activity', strategy: 'team', entity: 'deal' },
  expense_created: { category: 'team_activity', strategy: 'team', entity: 'expense' },
  payment_created: { category: 'team_activity', strategy: 'team', entity: 'payment' },
  task_completed: { category: 'team_activity', strategy: 'team', entity: 'task' },
  // assignment (item 2): notify the assignee
  task_assigned: { category: 'task', strategy: 'assignee', entity: 'task' },
  lead_assigned: { category: 'assignment', strategy: 'assignee', entity: 'lead' },
  deal_assigned: { category: 'assignment', strategy: 'assignee', entity: 'deal' },
  // announcement (item 2)
  announcement_published: { category: 'announcement', strategy: 'announcement', entity: 'announcement' },
}

type Snapshot = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function uuid(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function uuidArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/**
 * The raw id (either profiles.id or auth user_id — the generator normalises it)
 * of the person who caused the event. Used for team-activity hierarchy lookup
 * and for self-skip. Null when the source table records no actor.
 */
export function extractActorRawId(eventType: string, snap: Snapshot): string | null {
  switch (eventType) {
    case 'lead_created':
    case 'deal_created':
    case 'payment_created':
    case 'customer_created':
      return uuid(snap.user_id)
    case 'expense_created':
      return uuid(snap.employee_id)
    case 'task_completed':
    case 'task_assigned':
      // tasks.user_id is the creator (auth space); assigned_user_id is the assignee.
      return uuid(snap.user_id)
    case 'lead_assigned':
      return uuid(snap.user_id)
    case 'deal_assigned':
      return uuid(snap.user_id)
    case 'announcement_published':
      return uuid(snap.created_by)
    case 'order_created':
      // orders snapshot has no reliable single creator column; leave null.
      return null
    default:
      return null
  }
}

/** For assignment events: the raw id of the assignee to notify. */
export function extractAssigneeRawId(eventType: string, snap: Snapshot): string | null {
  switch (eventType) {
    case 'task_assigned':
      return uuid(snap.assigned_user_id)
    case 'lead_assigned':
      return uuid(snap.owner_id)
    case 'deal_assigned':
      return uuid(snap.assigned_to)
    default:
      return null
  }
}

/**
 * For announcement events: explicit employee ids and role ids the announcement
 * targets. Empty arrays mean "everyone in the account".
 */
export function extractAnnouncementTargets(snap: Snapshot): {
  employeeRawIds: string[]
  roleIds: string[]
} {
  return {
    employeeRawIds: uuidArray(snap.employee_ids),
    roleIds: uuidArray(snap.employee_role_ids),
  }
}

/** Title + body for a notification. `actorName` is optional enrichment. */
export function buildContent(
  eventType: string,
  snap: Snapshot,
  actorName?: string | null,
): { title: string; body: string } {
  const who = actorName ? actorName : 'A team member'
  switch (eventType) {
    case 'order_created':
      return { title: 'New order', body: `${who} created order ${str(snap.order_number) ?? ''}`.trim() }
    case 'customer_created':
      return { title: 'New customer', body: `${who} added ${str(snap.name) ?? 'a customer'}` }
    case 'lead_created':
      return { title: 'New lead', body: `${who} added lead ${str(snap.name) ?? ''}`.trim() }
    case 'deal_created':
      return { title: 'New deal', body: `${who} created deal ${str(snap.title) ?? ''}`.trim() }
    case 'expense_created':
      return { title: 'New expense', body: `${who} submitted expense ${str(snap.expense_number) ?? ''}`.trim() }
    case 'payment_created':
      return { title: 'Payment collected', body: `${who} recorded a payment` }
    case 'task_completed':
      return { title: 'Task completed', body: `${who} completed “${str(snap.title) ?? 'a task'}”` }
    case 'task_assigned':
      return { title: 'Task assigned to you', body: str(snap.title) ?? 'You have a new task' }
    case 'lead_assigned':
      return { title: 'Lead assigned to you', body: str(snap.name) ?? 'A lead was assigned to you' }
    case 'deal_assigned':
      return { title: 'Deal assigned to you', body: str(snap.title) ?? 'A deal was assigned to you' }
    case 'announcement_published':
      return { title: str(snap.title) ?? 'New announcement', body: (str(snap.content) ?? '').slice(0, 140) }
    default:
      return { title: 'Notification', body: '' }
  }
}
