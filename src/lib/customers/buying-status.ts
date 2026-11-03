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

export const BUYING_STATUSES = ['buyer', 'yet_to_buy', 'blacklist'] as const;
export type BuyingStatus = (typeof BUYING_STATUSES)[number];

export const BUYING_STATUS_LABELS: Record<BuyingStatus, string> = {
  buyer: 'Buyer',
  yet_to_buy: 'Yet to Buy',
  blacklist: 'Blacklisted',
};

/** For a select filter, in the order a user would think of them. */
export const BUYING_STATUS_OPTIONS = BUYING_STATUSES.map((value) => ({
  value,
  label: BUYING_STATUS_LABELS[value],
}));

/**
 * Anything unexpected reads as "yet to buy", which is the safe claim: saying
 * somebody has bought when the data does not say so would stop a rep calling
 * on a shop that never ordered.
 *
 * Blacklist is never inferred — only an exact match counts, because it is a
 * human judgement and guessing it would cut off a trading customer.
 */
export function normalizeBuyingStatus(raw: unknown): BuyingStatus {
  if (raw === 'buyer') return 'buyer';
  if (raw === 'blacklist') return 'blacklist';
  return 'yet_to_buy';
}

/**
 * A blacklist must say why. Enforced in the database too
 * (contacts_blacklist_needs_reason, migration 20261103150000) — "mandatory"
 * written only into a form is a promise the mobile app, the importer and any
 * future API caller get to break.
 */
export function requiresReason(status: BuyingStatus): boolean {
  return status === 'blacklist';
}

/** Whitespace is not a reason. Mirrors the CHECK constraint exactly. */
export function hasValidReason(reason: string | null | undefined): boolean {
  return (reason ?? '').trim().length > 0;
}

export function buyingStatusLabel(raw: unknown): string {
  return BUYING_STATUS_LABELS[normalizeBuyingStatus(raw)];
}

/**
 * Badge colours. Blacklisted is the only one that should stop someone in their
 * tracks, so it is the only destructive-coloured badge of the three.
 */
export const BUYING_STATUS_BADGE: Record<BuyingStatus, string> = {
  buyer: 'bg-sky-600 text-white shadow-sm border-transparent',
  yet_to_buy: 'bg-amber-500/15 text-amber-700 dark:text-amber-500 border-border',
  blacklist: 'bg-destructive text-destructive-foreground shadow-sm border-transparent',
};

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
