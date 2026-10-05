/**
 * Which fields block a duplicate save, per module, as the admin ticked them.
 *
 * Standard practice in this kind of software (Salesforce, Zoho) is independent
 * rules per field rather than one winning key: a save is rejected if ANY ticked
 * field already exists on another record. This module is the single place that
 * answers which fields those are.
 *
 * Contact Number appears in neither list. It is enforced unconditionally by a
 * unique index on both `contacts` and `leads`, so offering it as a tick would be
 * a lie — unticking it would change nothing. Settings shows it as a locked row
 * instead, so an admin can see the rule rather than guess at it.
 *
 * Products are deliberately untouched and keep their single-choice setting
 * (founder, 2026-10-05).
 */

export type CustomerUniqueKey = 'name' | 'code';
export type LeadUniqueKey = 'name' | 'email';

export interface UniqueKeyField<K extends string> {
  key: K;
  /** The table column this key guards. */
  column: string;
  /** What the admin sees, and what a rejection message names. */
  label: string;
}

export const CUSTOMER_UNIQUE_KEYS: UniqueKeyField<CustomerUniqueKey>[] = [
  { key: 'name', column: 'name', label: 'Name' },
  { key: 'code', column: 'customer_code', label: 'Customer Code' },
];

/** No Lead Code field exists, and the founder declined adding one (2026-10-05). */
export const LEAD_UNIQUE_KEYS: UniqueKeyField<LeadUniqueKey>[] = [
  { key: 'name', column: 'name', label: 'Name' },
  { key: 'email', column: 'email', label: 'Email' },
];

function extraSettings(settings: unknown): Record<string, unknown> | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  return (settings as Record<string, unknown>).extra_settings as Record<string, unknown> | undefined;
}

/** Keep only real keys, drop duplicates, return them in the declared order. */
function sanitize<K extends string>(
  value: unknown,
  allowed: UniqueKeyField<K>[],
): K[] | null {
  if (!Array.isArray(value)) return null;
  const chosen = new Set(value);
  return allowed.filter((f) => chosen.has(f.key)).map((f) => f.key);
}

/**
 * Customers have had duplicate prevention since it shipped, with
 * `customer_unique_key` defaulting to "name". An account that never opens the
 * new screen must keep blocking on name, so the old scalar is still honoured.
 *
 * An empty list is a legitimate choice here, unlike the outstanding rule: it
 * means "stop blocking on name and code". Contact Number still blocks, so it
 * cannot leave a tenant with no protection at all.
 */
export function readCustomerUniqueKeys(settings: unknown): CustomerUniqueKey[] {
  const extra = extraSettings(settings);

  const fromList = sanitize(extra?.customer_unique_keys, CUSTOMER_UNIQUE_KEYS);
  if (fromList !== null) return fromList;

  return extra?.customer_unique_key === 'code' ? ['code'] : ['name'];
}

/**
 * Leads had NO duplicate prevention before 2026-10-05 — the live table carried
 * only a primary key. Switching a default on would start rejecting saves across
 * every account for records they have always been allowed to create, so nothing
 * is ticked until an admin opts in.
 */
export function readLeadUniqueKeys(settings: unknown): LeadUniqueKey[] {
  return sanitize(extraSettings(settings)?.lead_unique_keys, LEAD_UNIQUE_KEYS) ?? [];
}
