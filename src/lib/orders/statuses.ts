// ------------------------------------------------------------
// The order status list — single source of truth.
//
// Order status is NOT configurable. It was briefly built as an editable list
// (the `order_statuses` table), but a per-account status list can't work: the
// transitions are enforced in the database by `order_status_transition_allowed`,
// which hardcodes these exact names. Renaming a status in a settings screen
// would silently strand every order on a value the state machine has never
// heard of. The editable list was retired from the UI, and the table itself was
// dropped in migration 20260810123000.
//
// Anything that needs the status list — the orders screen, filters, the
// automation field catalog — must import it from here rather than re-declaring
// the array, so the six names can never drift apart across screens.
//
// Founder decision, 2026-08-10: keep these six exactly as they are.
// ------------------------------------------------------------

export const ORDER_STATUSES = [
  'Pending',
  'Approved',
  'Part Dispatch',
  'Dispatched',
  'Rejected',
  'Cancelled',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/**
 * Transitions the DATABASE permits, mirroring `order_status_transition_allowed`.
 *
 * Kept here so server-side code (the automation preview, validation) can reason
 * about reachable statuses without a round trip. It must stay in step with the
 * SQL function — if you change one, change both.
 *
 * NOTE this is deliberately WIDER than what the orders screen offers as manual
 * actions. Reaching 'Dispatched' happens through the dispatch flow, not a status
 * dropdown, so the screen hides it while the database still allows it.
 */
export const ORDER_STATUS_TRANSITIONS: Record<string, readonly OrderStatus[]> = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Dispatched', 'Rejected', 'Cancelled', 'Part Dispatch'],
  'Part Dispatch': ['Dispatched', 'Approved', 'Cancelled', 'Rejected'],
  Dispatched: ['Part Dispatch', 'Approved'],
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}
