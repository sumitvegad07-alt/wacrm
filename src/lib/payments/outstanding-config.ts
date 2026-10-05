/**
 * Which orders count as money owed, and which payments count as money received.
 *
 * Until 2026-10-05 this was hard-wired: `orders.status = 'Closed'` minus
 * `payments.status = 'Approved'`, repeated in ten places across web, mobile and
 * SQL. Distributors genuinely disagree about the right moment — some treat a
 * booked order as debt the instant a salesman writes it, others only once the
 * order closes — so the account chooses, the way it already chooses when stock
 * is depleted.
 *
 * This module is the single place that answers "which statuses count?". Anything
 * deriving an outstanding figure reads it from here rather than naming a status.
 */

/** Every status an order can hold. Canonical order — output is sorted by this. */
export const ORDER_STATUSES = [
  'Pending',
  'Approved',
  'Part Dispatch',
  'Dispatched',
  'Closed',
  'Cancelled',
  'Rejected',
] as const;

/** Every status a payment can hold. Canonical order — output is sorted by this. */
export const PAYMENT_STATUSES = ['Pending', 'Approved', 'Cancelled', 'Rejected'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface OutstandingConfig {
  /** Orders in these statuses ADD to what a customer owes. */
  orderStatuses: OrderStatus[];
  /** Payments in these statuses REDUCE what a customer owes. */
  paymentStatuses: PaymentStatus[];
}

/**
 * Shortcuts over the same status lists, so an admin picks a business moment
 * instead of reasoning about seven statuses.
 *
 * Cancelled and Rejected appear in no preset: an order that was called off is
 * not debt, and a rejected payment did not settle anything. They remain tickable
 * under Custom for an account with a workflow we have not met.
 */
export const ORDER_STATUS_PRESETS = {
  /** Debt the moment the order is written — everything that was not called off. */
  on_creation: ['Pending', 'Approved', 'Part Dispatch', 'Dispatched', 'Closed'],
  /** Debt once someone in the office has accepted the order. */
  on_approval: ['Approved', 'Part Dispatch', 'Dispatched', 'Closed'],
  /** Debt once any goods have physically left. */
  on_dispatch: ['Part Dispatch', 'Dispatched', 'Closed'],
  /** Debt only once the order is complete. The default, and the old behaviour. */
  on_close: ['Closed'],
} satisfies Record<string, OrderStatus[]>;

export const PAYMENT_STATUS_PRESETS = {
  /** Only money an approver has confirmed. The default, and the old behaviour. */
  approved_only: ['Approved'],
  /** Also credit cash a rep has collected but nobody has verified yet. */
  pending_and_approved: ['Pending', 'Approved'],
} satisfies Record<string, PaymentStatus[]>;

export type OrderPresetKey = keyof typeof ORDER_STATUS_PRESETS;
export type PaymentPresetKey = keyof typeof PAYMENT_STATUS_PRESETS;

/**
 * What every account did before this setting existed. An account that never
 * touches Settings must keep producing exactly these numbers — outstanding is
 * derived live on every screen, so a drifting default would silently restate
 * every customer's balance.
 */
export const DEFAULT_OUTSTANDING_CONFIG: OutstandingConfig = {
  orderStatuses: [...ORDER_STATUS_PRESETS.on_close],
  paymentStatuses: [...PAYMENT_STATUS_PRESETS.approved_only],
};

/**
 * Keep only real statuses, drop duplicates, and return them in canonical order.
 * Returns null when nothing usable survives, so the caller can fall back rather
 * than count nothing — an empty list would zero every customer's balance, which
 * a corrupt or half-written setting must never be able to do silently.
 */
function sanitize<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null;
  const chosen = new Set(value);
  const kept = allowed.filter((status) => chosen.has(status));
  return kept.length > 0 ? kept : null;
}

/** Read the account's rule from `accounts.settings`. */
export function readOutstandingConfig(settings: unknown): OutstandingConfig {
  const blob =
    settings && typeof settings === 'object'
      ? ((settings as Record<string, unknown>).outstanding_settings as
          | Record<string, unknown>
          | undefined)
      : undefined;

  return {
    orderStatuses:
      sanitize(blob?.order_statuses, ORDER_STATUSES) ?? DEFAULT_OUTSTANDING_CONFIG.orderStatuses,
    paymentStatuses:
      sanitize(blob?.payment_statuses, PAYMENT_STATUSES) ??
      DEFAULT_OUTSTANDING_CONFIG.paymentStatuses,
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((item) => seen.has(item));
}

/** Which preset an admin's chosen statuses correspond to, for showing in Settings. */
export function matchOrderPreset(statuses: readonly string[]): OrderPresetKey | 'custom' {
  const hit = (Object.keys(ORDER_STATUS_PRESETS) as OrderPresetKey[]).find((key) =>
    sameSet(ORDER_STATUS_PRESETS[key], statuses),
  );
  return hit ?? 'custom';
}

export function matchPaymentPreset(statuses: readonly string[]): PaymentPresetKey | 'custom' {
  const hit = (Object.keys(PAYMENT_STATUS_PRESETS) as PaymentPresetKey[]).find((key) =>
    sameSet(PAYMENT_STATUS_PRESETS[key], statuses),
  );
  return hit ?? 'custom';
}
