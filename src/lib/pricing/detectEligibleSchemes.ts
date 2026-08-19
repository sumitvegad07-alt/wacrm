import { round2 } from './calculateOrderPricing';
import type {
  LineSchemeSuggestion,
  OrderSchemeSuggestion,
  PricingProduct,
  SchemeDefinition,
  SchemeDetectionLine,
  SchemeDetectionResult,
  SchemeNudge,
  SchemeSlab,
} from './types';

/**
 * ADVISORY scheme-detection brain — the offline twin of the SQL
 * `detect_eligible_schemes` function (Phase 4).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS PROPOSES; IT NEVER DECIDES AN ORDER TOTAL.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Given a draft order it returns the schemes it qualifies for and the reward
 * each would produce. The salesman confirms a subset; those confirmed effects
 * are then fed into calculateOrderPricing() as trusted inputs. Keeping ALL
 * slab/reward logic here (and nowhere in the pricing engine) means there is one
 * place that understands schemes, mirrored in exactly one SQL function, pinned
 * by the shared fixture suite. On the phone this runs with no signal, off the
 * scheme definitions cached on the device.
 *
 * Resolution rules (founder-confirmed 2026-08-19):
 *   • quantity_slab / free_goods: BEST SINGLE scheme per product line, chosen by
 *     priority, then reward value to the customer, then scheme id (deterministic).
 *   • value_slab: a whole-order discount; best single value slab (they do not
 *     stack with each other) may sit ON TOP of the per-line scheme.
 *   • slab_mode only changes quantity-scaled rewards (free_goods, per-unit
 *     amount): 'step_up' = the single highest slab the qty reaches; 'repeat' =
 *     complete sets only. A percent / special_price reward is a rate and applies
 *     to the whole qualifying line regardless of slab_mode.
 *   • free_goods default to opt-IN; money discounts default to accepted.
 *   • max_free_units_per_order caps the scheme's total free units across lines.
 *
 * engine_version is 3, matching calculateOrderPricing and the SQL twin.
 */

const ENGINE_VERSION = 3;

type ProductLookup = Map<string, PricingProduct> | Record<string, PricingProduct>;

function lookupProduct(products: ProductLookup, id: string): PricingProduct | undefined {
  return products instanceof Map ? products.get(id) : products[id];
}

/** A scheme is live when active AND today falls inside [starts_on, ends_on]. */
function isLive(scheme: SchemeDefinition, asOf: string): boolean {
  return (
    scheme.active &&
    scheme.startsOn <= asOf &&
    (scheme.endsOn === null || scheme.endsOn >= asOf)
  );
}

function targetsContact(scheme: SchemeDefinition, contactId: string | null): boolean {
  if (scheme.targetType === 'all') return true;
  return contactId !== null && scheme.customerIds.includes(contactId);
}

function coversProduct(scheme: SchemeDefinition, productId: string): boolean {
  // An empty product set means the scheme covers every product.
  return scheme.productIds.length === 0 || scheme.productIds.includes(productId);
}

const qtySlabs = (scheme: SchemeDefinition): SchemeSlab[] =>
  scheme.slabs.filter((s) => s.minQty !== null || s.maxQty !== null);

const valueSlabs = (scheme: SchemeDefinition): SchemeSlab[] =>
  scheme.slabs.filter((s) => s.minValue !== null || s.maxValue !== null);

/** The highest qty slab whose band contains `qty` (step_up / repeat entry). */
function matchQtySlab(slabs: SchemeSlab[], qty: number): SchemeSlab | null {
  const candidates = slabs.filter(
    (s) => qty >= (s.minQty ?? 0) && (s.maxQty === null || qty <= s.maxQty),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, s) => ((s.minQty ?? 0) > (best.minQty ?? 0) ? s : best));
}

/** The highest value slab whose band contains `value`. */
function matchValueSlab(slabs: SchemeSlab[], value: number): SchemeSlab | null {
  const candidates = slabs.filter(
    (s) => value >= (s.minValue ?? 0) && (s.maxValue === null || value <= s.maxValue),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, s) => ((s.minValue ?? 0) > (best.minValue ?? 0) ? s : best));
}

/** The next qty slab above `qty`, for the "add N more" nudge. */
function nextQtySlab(slabs: SchemeSlab[], qty: number): SchemeSlab | null {
  const above = slabs.filter((s) => (s.minQty ?? 0) > qty);
  if (above.length === 0) return null;
  return above.reduce((lowest, s) => ((s.minQty ?? 0) < (lowest.minQty ?? 0) ? s : lowest));
}

function nextValueSlab(slabs: SchemeSlab[], value: number): SchemeSlab | null {
  const above = slabs.filter((s) => (s.minValue ?? 0) > value);
  if (above.length === 0) return null;
  return above.reduce((lowest, s) => ((s.minValue ?? 0) < (lowest.minValue ?? 0) ? s : lowest));
}

function rewardLabel(slab: SchemeSlab, freeProductName: string | null): string {
  switch (slab.rewardType) {
    case 'free_goods':
      return `${slab.freeQty ?? 0} × ${freeProductName ?? 'free goods'} free`;
    case 'discount_percent':
      return `${slab.rewardValue ?? 0}% off`;
    case 'discount_amount':
      return `₹${slab.rewardValue ?? 0}/unit off`;
    case 'special_price':
      return `special price ₹${slab.rewardValue ?? 0}`;
    default:
      return 'reward';
  }
}

/**
 * How many free units this slab yields for `qty`, before the per-order cap.
 * step_up gives the slab's flat free_qty; repeat gives free_qty per complete set.
 */
function rawFreeUnits(slab: SchemeSlab, qty: number, mode: SchemeDefinition['slabMode']): number {
  const per = slab.freeQty ?? 0;
  if (mode === 'repeat') {
    const setSize = slab.minQty ?? 0;
    if (setSize <= 0) return 0;
    return per * Math.floor(qty / setSize);
  }
  return per;
}

interface Candidate {
  suggestion: LineSchemeSuggestion;
  priority: number;
  /** Value to the customer, for the tie-break. */
  customerValue: number;
}

export function detectEligibleSchemes(
  lines: SchemeDetectionLine[],
  products: ProductLookup,
  schemes: SchemeDefinition[],
  contactId: string | null,
  asOf: string,
): SchemeDetectionResult {
  const live = (schemes ?? []).filter((s) => isLive(s, asOf) && targetsContact(s, contactId));

  // ── Per-line schemes (quantity_slab / free_goods): gather every candidate,
  //    then keep the single best per line. ────────────────────────────────────
  const candidatesByPosition = new Map<number, Candidate[]>();

  (lines ?? []).forEach((line, index) => {
    const position = index + 1;
    const qty = Math.max(Number(line.quantity) || 0, 0);
    if (qty <= 0) return;
    const product = lookupProduct(products, line.productId);
    const cataloguePrice = Number(product?.price ?? 0);

    for (const scheme of live) {
      if (scheme.schemeType === 'value_slab') continue;
      if (!coversProduct(scheme, line.productId)) continue;

      const slabs = qtySlabs(scheme);
      const slab = matchQtySlab(slabs, qty);
      if (!slab) continue;

      const freeProduct = slab.freeProductId ? lookupProduct(products, slab.freeProductId) : undefined;
      const freeProductName = freeProduct?.name ?? null;

      let schemeDiscountAmount = 0;
      let freeQty = 0;
      let customerValue = 0;
      let defaultSelected = true;

      switch (slab.rewardType) {
        case 'free_goods': {
          freeQty = rawFreeUnits(slab, qty, scheme.slabMode);
          if (freeQty <= 0) continue;
          customerValue = round2(freeQty * Number(freeProduct?.price ?? 0));
          defaultSelected = false; // free goods are opt-in
          break;
        }
        case 'discount_percent': {
          schemeDiscountAmount = round2((cataloguePrice * qty * (slab.rewardValue ?? 0)) / 100);
          customerValue = schemeDiscountAmount;
          break;
        }
        case 'discount_amount': {
          // Per unit, consistent with the salesman amount discount (mig. 084).
          schemeDiscountAmount = round2((slab.rewardValue ?? 0) * qty);
          customerValue = schemeDiscountAmount;
          break;
        }
        case 'special_price': {
          schemeDiscountAmount = Math.max(
            0,
            round2((cataloguePrice - (slab.rewardValue ?? 0)) * qty),
          );
          customerValue = schemeDiscountAmount;
          break;
        }
      }
      if (customerValue <= 0 && freeQty <= 0) continue;

      // "Add N more" nudge from the next slab up.
      let nudge: SchemeNudge | null = null;
      if (scheme.slabMode === 'repeat') {
        const setSize = slab.minQty ?? 0;
        const remainder = setSize > 0 ? qty % setSize : 0;
        if (setSize > 0 && remainder > 0) {
          nudge = {
            unitsToNext: setSize - remainder,
            nextRewardLabel: rewardLabel(slab, freeProductName),
          };
        }
      } else {
        const next = nextQtySlab(slabs, qty);
        if (next) {
          nudge = {
            unitsToNext: (next.minQty ?? 0) - qty,
            nextRewardLabel: rewardLabel(next, freeProductName),
          };
        }
      }

      const suggestion: LineSchemeSuggestion = {
        position,
        productId: line.productId,
        schemeId: scheme.id,
        schemeName: scheme.name,
        schemeType: scheme.schemeType,
        rewardType: slab.rewardType,
        rewardValue: slab.rewardValue ?? 0,
        matchedSlabId: slab.id,
        schemeDiscountAmount,
        freeProductId: slab.freeProductId,
        freeProductName,
        freeQty,
        defaultSelected,
        nudge,
      };

      const bucket = candidatesByPosition.get(position) ?? [];
      bucket.push({ suggestion, priority: scheme.priority, customerValue });
      candidatesByPosition.set(position, bucket);
    }
  });

  // Best single scheme per line: priority ↓, customer value ↓, scheme id ↑.
  const lineSchemes: LineSchemeSuggestion[] = [];
  for (const position of [...candidatesByPosition.keys()].sort((a, b) => a - b)) {
    const bucket = candidatesByPosition.get(position)!;
    const best = bucket.reduce((winner, c) => {
      if (c.priority !== winner.priority) return c.priority > winner.priority ? c : winner;
      if (c.customerValue !== winner.customerValue)
        return c.customerValue > winner.customerValue ? c : winner;
      return c.suggestion.schemeId < winner.suggestion.schemeId ? c : winner;
    });
    lineSchemes.push(best.suggestion);
  }

  // Apply each scheme's max_free_units_per_order cap across the chosen lines,
  // in position order (deterministic).
  const freeRunningByScheme = new Map<string, number>();
  for (const ls of lineSchemes) {
    if (ls.rewardType !== 'free_goods' || ls.freeQty <= 0) continue;
    const scheme = live.find((s) => s.id === ls.schemeId);
    const cap = scheme?.maxFreeUnitsPerOrder ?? null;
    if (cap === null) continue;
    const used = freeRunningByScheme.get(ls.schemeId) ?? 0;
    const allowed = Math.max(0, cap - used);
    ls.freeQty = Math.min(ls.freeQty, allowed);
    freeRunningByScheme.set(ls.schemeId, used + ls.freeQty);
  }

  // ── Value-slab (whole-order) schemes: single best across the order. ─────────
  const orderCandidates: Array<{ suggestion: OrderSchemeSuggestion; priority: number }> = [];
  for (const scheme of live) {
    if (scheme.schemeType !== 'value_slab') continue;

    const positions: number[] = [];
    let qualifyingSubtotal = 0;
    (lines ?? []).forEach((line, index) => {
      if (!coversProduct(scheme, line.productId)) return;
      const qty = Math.max(Number(line.quantity) || 0, 0);
      if (qty <= 0) return;
      const product = lookupProduct(products, line.productId);
      positions.push(index + 1);
      qualifyingSubtotal += round2(Number(product?.price ?? 0) * qty);
    });
    qualifyingSubtotal = round2(qualifyingSubtotal);
    if (positions.length === 0) continue;

    const slabs = valueSlabs(scheme);
    const slab = matchValueSlab(slabs, qualifyingSubtotal);
    const next = nextValueSlab(slabs, qualifyingSubtotal);
    const nudge: SchemeNudge | null = next
      ? {
          valueToNext: round2((next.minValue ?? 0) - qualifyingSubtotal),
          nextRewardLabel: rewardLabel(next, null),
        }
      : null;

    if (!slab) continue;
    if (slab.rewardType !== 'discount_percent' && slab.rewardType !== 'discount_amount') continue;

    const discountAmount =
      slab.rewardType === 'discount_percent'
        ? round2((qualifyingSubtotal * (slab.rewardValue ?? 0)) / 100)
        : round2(slab.rewardValue ?? 0);
    if (discountAmount <= 0) continue;

    orderCandidates.push({
      priority: scheme.priority,
      suggestion: {
        schemeId: scheme.id,
        schemeName: scheme.name,
        rewardType: slab.rewardType,
        rewardValue: slab.rewardValue ?? 0,
        qualifyingSubtotal,
        discountAmount,
        appliesToPositions: positions,
        defaultSelected: true,
        nudge,
      },
    });
  }

  // Value slabs do not stack with each other — keep the single best.
  const orderSchemes: OrderSchemeSuggestion[] = [];
  if (orderCandidates.length > 0) {
    const best = orderCandidates.reduce((winner, c) => {
      if (c.priority !== winner.priority) return c.priority > winner.priority ? c : winner;
      if (c.suggestion.discountAmount !== winner.suggestion.discountAmount)
        return c.suggestion.discountAmount > winner.suggestion.discountAmount ? c : winner;
      return c.suggestion.schemeId < winner.suggestion.schemeId ? c : winner;
    });
    orderSchemes.push(best.suggestion);
  }

  return { lineSchemes, orderSchemes, engineVersion: ENGINE_VERSION };
}
