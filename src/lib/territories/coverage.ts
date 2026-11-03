/**
 * Who covers a customer, when the customer's territory and the salesman's
 * assignment sit at different levels of the hierarchy.
 *
 * Founder, 2026-11-03: "Customers Area assignment ... the Area is not
 * mandatory. Agar salesman ko area assign kia he or customer ko khali City
 * assign kia he than wo customers unassigned rahenge. It is not a bug, it is an
 * implementation error."
 *
 * He is right. The walk used to go UP only — from the customer's territory to
 * the first assigned ancestor — which answers "the rep holds the State, the
 * customer is in a City inside it". It cannot answer the reverse: the rep holds
 * an Area, the customer is recorded with only the City ABOVE that area. The
 * assignment is the customer's descendant, so no amount of walking up reaches
 * it, and the customer reads "unassigned" forever. The only cure available to
 * an admin was to re-tag every customer down to area level, which is exactly
 * the mandatory-Area requirement being removed.
 *
 * So the walk now looks up first and, finding nobody, looks down.
 *
 * A fallback rather than a union, deliberately: a customer who already resolves
 * to somebody keeps resolving to exactly the same person, so no assignment
 * shown today changes. This only ever fills in a blank.
 *
 * The database rule this mirrors is `employee_covered_territory_ids`
 * (20261103120000), which contacts/leads RLS and route eligibility now read.
 * Siblings are excluded in both: assign one area to Dhaval and the next to
 * someone else and each still covers only his own.
 */

export type TerritoryLink = { id: string; parent_id: string | null };

export type TerritoryIndex = {
  parentOf: Record<string, string | null>;
  childrenOf: Record<string, string[]>;
};

/** Depth guard. The deepest hierarchy OZZO offers is 5 (country → sub-area). */
const MAX_DEPTH = 8;

export function indexTerritories(territories: TerritoryLink[]): TerritoryIndex {
  const parentOf: Record<string, string | null> = {};
  const childrenOf: Record<string, string[]> = {};
  for (const t of territories) {
    parentOf[t.id] = t.parent_id ?? null;
    if (t.parent_id) (childrenOf[t.parent_id] ||= []).push(t.id);
  }
  return { parentOf, childrenOf };
}

/**
 * Resolves a customer's territory to whoever covers it, given a map of
 * whatever-you-like (names, profile ids) keyed by the territory it is assigned
 * to. Returns [] when nobody covers it at any level.
 */
export function coverageWalk<T>(
  index: TerritoryIndex,
  byTerritory: Record<string, T[]>,
): (territoryId: string | null | undefined) => T[] {
  return (territoryId) => {
    // Upward: the rep holds this territory or something above it.
    let cur = territoryId ?? null;
    let guard = 0;
    while (cur && guard < MAX_DEPTH) {
      if (byTerritory[cur]?.length) return byTerritory[cur];
      cur = index.parentOf[cur] ?? null;
      guard += 1;
    }
    if (!territoryId) return [];

    // Downward, breadth-first: the reps holding areas inside this territory.
    // Nearest level wins, so a city-level customer resolves to the reps holding
    // its areas, not to everybody in every sub-area beneath them.
    let frontier = index.childrenOf[territoryId] ?? [];
    let depth = 0;
    while (frontier.length && depth < MAX_DEPTH) {
      const found: T[] = [];
      for (const id of frontier) {
        for (const v of byTerritory[id] ?? []) {
          if (!found.includes(v)) found.push(v);
        }
      }
      if (found.length) return found;
      frontier = frontier.flatMap((id) => index.childrenOf[id] ?? []);
      depth += 1;
    }
    return [];
  };
}
