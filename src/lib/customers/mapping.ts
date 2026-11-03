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

export const MAPPING_MODES = ['off', 'manual', 'beat'] as const;
export type MappingMode = (typeof MAPPING_MODES)[number];

export const MAPPING_MODE_META: Record<MappingMode, { label: string; help: string }> = {
  off: {
    label: 'Off',
    help: 'No supplier is recorded on a customer. This is how OZZO has always worked.',
  },
  manual: {
    label: 'Set on each customer',
    help: 'The customer form gets a "Supplied By" box, and you pick the distributor yourself.',
  },
  beat: {
    label: 'From the beat',
    help: 'You give each beat a supplying distributor, and every customer permanently on that beat takes it automatically. The box on the customer form becomes read-only.',
  },
};

/** Anything unrecognised, missing or null reads as off. */
export function readMappingMode(accountSettings: unknown): MappingMode {
  const raw = (accountSettings as { extra_settings?: { customer_mapping_mode?: unknown } } | null)
    ?.extra_settings?.customer_mapping_mode;
  return raw === 'manual' || raw === 'beat' ? raw : 'off';
}

export function isMappingOn(accountSettings: unknown): boolean {
  return readMappingMode(accountSettings) !== 'off';
}

/** True when a human may type the supplier; false when a beat owns it. */
export function canEditParentByHand(accountSettings: unknown): boolean {
  return readMappingMode(accountSettings) === 'manual';
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
