// ============================================================
// Which plans the price calculator may quote.
//
// PLAN_IDS is the entitlement list — every plan the product can grant. That is
// not the same as every plan with an approved price: lib/plans/pricing.ts marks
// the FSM rates PROVISIONAL, and lib/proposals/registry.ts only builds a
// template once a plan's price and sales copy exist.
//
// The calculator is a quoting tool, so it follows the registry. Otherwise
// adding a product line to PLAN_IDS puts an unapproved price in front of the
// founder mid-call, with a "Create proposal" button that cannot produce a
// document.
// ============================================================

import type { PlanId } from "@/lib/plans/catalog";
import { listTemplates } from "@/lib/proposals/registry";

/** The plans with an approved price, in catalogue order. */
export function quotablePlans(): PlanId[] {
  return listTemplates().map((t) => t.plan);
}
