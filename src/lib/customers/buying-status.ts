/**
 * Buying Status — Buyer / Yet to Buy.
 *
 * "Has this customer ever bought?" — a different question from Active /
 * Inactive, which asks "is this record still in use?".
 *
 * The two must not be conflated. A dealer who has never ordered is a perfectly
 * current customer, and the rep is calling on him BECAUSE he has not ordered
 * yet. Marking him Inactive would remove him from the lists of the very people
 * whose job it is to open him.
 *
 * "Yet to Buy" is deliberately an instruction rather than a label: Inactive
 * tells a rep to ignore someone, Yet to Buy tells him to go and sell.
 *
 * The value is maintained by the database (trg_sync_buying_status on orders,
 * migration 20261103140000) from real order history — an order counts unless it
 * was Cancelled or Rejected. A human may override it, which locks the row so
 * the automatic rule stops arguing; only the set_buying_status RPC may write
 * it, because the lock and the who/when have to be recorded in the same breath.
 */

export const BUYING_STATUSES = ['buyer', 'yet_to_buy'] as const;
export type BuyingStatus = (typeof BUYING_STATUSES)[number];

export const BUYING_STATUS_LABELS: Record<BuyingStatus, string> = {
  buyer: 'Buyer',
  yet_to_buy: 'Yet to Buy',
};

/** For a select filter, in the order a user would think of them. */
export const BUYING_STATUS_OPTIONS = BUYING_STATUSES.map((value) => ({
  value,
  label: BUYING_STATUS_LABELS[value],
}));

/** Anything unexpected reads as "yet to buy", which is the safe claim. */
export function normalizeBuyingStatus(raw: unknown): BuyingStatus {
  return raw === 'buyer' ? 'buyer' : 'yet_to_buy';
}

export function buyingStatusLabel(raw: unknown): string {
  return BUYING_STATUS_LABELS[normalizeBuyingStatus(raw)];
}

/**
 * Off until an admin switches it on in Organisation Settings. Until then no
 * list, filter, form or report shows any of it — the column is still being
 * maintained underneath, so the day it is switched on the answer is already
 * right rather than starting from "nobody has ever bought".
 */
export function isBuyingStatusEnabled(accountSettings: unknown): boolean {
  const extra = (accountSettings as { extra_settings?: { buying_status_enabled?: unknown } } | null)
    ?.extra_settings;
  return extra?.buying_status_enabled === true;
}
