/**
 * Customer mapping — which customer supplies which.
 *
 * Founder: "We need customer mapping through the beat mapping and manually
 * both option in our OZZO organisation settings. If admin selects manually,
 * add one field in customer creation — a parent id in customer. If admin
 * selects beat/route mapping, a simple beat/route selection option to map the
 * customers. That is how we will map the primary and secondary channel for
 * sales."
 *
 * One column holds the answer in both modes (`contacts.parent_id`); the mode
 * decides who writes it — a human in manual mode, a trigger in beat mode
 * (migration 20261103160000).
 *
 * This is NOT hierarchy_level. hierarchy_level says what KIND of customer this
 * is, and drives whether an order is primary, secondary or direct. parent_id
 * says WHO SUPPLIES THEM, which the product could not say at all before. The
 * two work together: the level says an order is secondary, the parent says
 * through whom.
 */

export const MAPPING_MODES = ['off', 'manual', 'beat', 'area'] as const;
export type MappingMode = (typeof MAPPING_MODES)[number];

/**
 * The modes an admin may actually choose.
 *
 * `beat` is missing on purpose. It shipped on 3 Nov and was replaced the next
 * day, because a beat is not the thing the founder's channel model is built on:
 *
 *   "in our system beat/route is not a different — Area/territory is Beat/route
 *    simple. For example 150 feet ring road is area assigned to salesman and
 *    same assigned to customer."
 *
 * The area layer he is describing is real and already exists (territories +
 * employee_area_assignments + contacts.territory_id). A beat is a layer ON TOP
 * of it — the Route wizard builds one "from a salesman's territory customers"
 * and skips anyone "outside territory" — so one area holds many beats and a
 * customer can have an area and no beat at all. Mapping the channel off the
 * beat therefore asked tenants to create beats they did not otherwise need.
 *
 * `beat` is still honoured everywhere (the database still has its triggers) so
 * no tenant who set it breaks; it just cannot be newly chosen.
 */
export const OFFERED_MAPPING_MODES = ['off', 'manual', 'area'] as const satisfies readonly MappingMode[];

export const MAPPING_MODE_META: Record<MappingMode, { label: string; help: string }> = {
  off: {
    label: 'Off',
    help: 'No supplier is recorded on a customer. This is how OZZO has always worked.',
  },
  manual: {
    label: 'Set on each customer',
    help: 'The customer form gets a "Supplied By" box, and you pick the supplier yourself.',
  },
  area: {
    label: 'By area',
    help: 'You say who holds each level in each area — "in 150 Feet Ring Road the Distributor is C" — and every customer in that area takes the level above them automatically. Set it once at City level and the areas under it inherit.',
  },
  beat: {
    label: 'From the beat (old)',
    help: 'Replaced by "By area". Still works for anyone already using it, but a beat is a visit route inside an area, not the area itself.',
  },
};

/** Anything unrecognised, missing or null reads as off. */
export function readMappingMode(accountSettings: unknown): MappingMode {
  const raw = (accountSettings as { extra_settings?: { customer_mapping_mode?: unknown } } | null)
    ?.extra_settings?.customer_mapping_mode;
  return raw === 'manual' || raw === 'beat' || raw === 'area' ? raw : 'off';
}

/**
 * True when the system owns `contacts.parent_id` for this customer, so the form
 * must show it read-only.
 *
 * In area mode a single customer can be taken back by hand — the real case
 * being one area that genuinely holds two Distributors — which is what
 * `parent_locked` records.
 */
export function isParentOwnedBySystem(
  accountSettings: unknown,
  contact?: { parent_locked?: boolean | null } | null,
): boolean {
  const mode = readMappingMode(accountSettings);
  if (mode === 'beat') return true;
  if (mode === 'area') return !contact?.parent_locked;
  return false;
}

/** The RPC that re-maps a whole account for this mode, or null when there is none. */
export function remapRpcFor(mode: MappingMode): string | null {
  if (mode === 'area') return 'resync_account_area_parents';
  if (mode === 'beat') return 'resync_account_beat_parents';
  return null;
}

/**
 * Whether secondary sales is really configured, as opposed to merely switched
 * on. A customer with no level classifies as `direct`, and one with no supplier
 * has no channel — so a tenant can turn this on, see nothing change, and
 * conclude the feature is broken.
 */
export type SecondarySalesSetup = {
  total: number;
  no_level: number;
  no_parent: number;
  no_area: number;
  locked: number;
  /**
   * Unmapped ONLY because their area holds several possible suppliers — a
   * deliberate subset of no_parent, so a screen can say "9 unmapped, 4 of them
   * waiting on you to choose". Added 2026-11-05 with many-holders-per-area;
   * reads 0 against a database where 20261105120000 has not been applied,
   * which is the right answer there rather than an error.
   */
  needs_choice: number;
};

export function readSetupStatus(raw: unknown): SecondarySalesSetup {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
  return {
    total: num(o.total),
    no_level: num(o.no_level),
    no_parent: num(o.no_parent),
    no_area: num(o.no_area),
    locked: num(o.locked),
    needs_choice: num(o.needs_choice),
  };
}

/**
 * Secondary sales needs at least two levels. The founder's own reasoning:
 *
 *   "i don't think if any company has only one level of customers they do not
 *    need of secondary sales"
 *
 * With one level every order is primary, so there is nothing secondary to
 * report — the switch would be on and change nothing, which is worse than being
 * off. His list said "1, 2, 3 or 4"; this follows the reasoning rather than the
 * list. The maximum stays 5 because the old screen already allowed 5 and a
 * tenant may have used it.
 */
export const MIN_LEVELS = 2;
export const MAX_LEVELS = 5;

export function levelsProblem(
  enabled: boolean,
  levels: readonly { name?: string | null }[],
): string | null {
  if (!enabled) return null;
  const named = levels.filter((l) => (l.name ?? '').trim()).length;
  if (named < MIN_LEVELS) {
    return `Secondary sales needs at least ${MIN_LEVELS} named levels. With one level every order is primary, so there is nothing secondary to report.`;
  }
  if (named > MAX_LEVELS) return `At most ${MAX_LEVELS} levels.`;
  return null;
}

export function isMappingOn(accountSettings: unknown): boolean {
  return readMappingMode(accountSettings) !== 'off';
}

/**
 * True when a human may type the supplier.
 *
 * Manual mode: always. Area mode: yes, but doing so is an override and sets
 * `parent_locked`, which is how one area that really holds two Distributors is
 * expressed. Beat mode: never — the beat owns the column outright.
 */
export function canEditParentByHand(accountSettings: unknown): boolean {
  const mode = readMappingMode(accountSettings);
  return mode === 'manual' || mode === 'area';
}

/**
 * Who may supply this customer, for the picker.
 *
 * A supplier has to sit ABOVE the customer in the hierarchy — a dealer cannot
 * supply a distributor — and nobody supplies themselves. Lower number is
 * higher up, so level 1 is the top of the chain.
 *
 * The same rule is enforced in the database (is_legal_customer_parent), so this
 * only narrows the list to spare somebody a rejected save; it is not the
 * guarantee. Loops are not filtered here: they need the whole chain, which the
 * database already walks.
 *
 * When either side has no level — which is every customer on an account with
 * order hierarchy switched off — the rule cannot mean anything, so the
 * candidate is allowed and the database agrees.
 */
export function eligibleParents<
  T extends { id: string; hierarchy_level?: number | null },
>(candidates: readonly T[], child: { id?: string; hierarchy_level?: number | null }): T[] {
  return candidates.filter((c) => {
    if (child.id && c.id === child.id) return false;
    if (c.hierarchy_level == null || child.hierarchy_level == null) return true;
    return c.hierarchy_level < child.hierarchy_level;
  });
}
