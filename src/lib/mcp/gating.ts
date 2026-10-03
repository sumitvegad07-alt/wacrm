// ============================================================
// What this tenant's AI may see.
//
// Three independent gates, all read from the descriptor so they cannot
// drift from the catalog:
//   1. plan line      — PLAN_LINES from the plan catalog
//   2. module toggle  — accounts.settings module switches
//   3. privacy switch — the sensitive workforce data sets
//
// visibleDataSets() builds the menu. assertDataSetAllowed() is the
// enforcement point, and both must be used: hiding a name from the menu
// is not security, because the AI can simply guess it. A test asserts the
// two can never disagree.
//
// Both take an optional descriptor list. Production always uses the real
// catalog; the parameter exists so each gate can be tested on its own
// instead of through whichever real data set happens to carry the flag.
// ============================================================
import { planLines } from "@/lib/plans/catalog";
import { allDataSets } from "./catalog";
import type { DataSetDescriptor } from "./types";

export interface TenantContext {
  /**
   * The raw accounts.subscription_plan value, NOT a validated PlanId.
   *
   * Production holds at least one legacy plan ("Enterprise") that is not in
   * PLAN_IDS, and the product rule is that legacy plans get full access.
   * Indexing PLAN_LINES directly returns undefined for those and would hide
   * every data set, so that tenant's AI would report an empty menu rather
   * than the full one they are entitled to. planLines() encodes the rule.
   */
  plan: unknown;
  moduleSettings: Record<string, boolean>;
  allowWorkforceData: boolean;
}

function lineAllowed(s: DataSetDescriptor, ctx: TenantContext): boolean {
  return planLines(ctx.plan)[s.line] === true;
}

function moduleAllowed(s: DataSetDescriptor, ctx: TenantContext): boolean {
  if (!s.requiredModule) return true;
  // Absent means "not explicitly disabled". Only an explicit false hides it,
  // matching how the dashboard reads module_settings — a fresh account has an
  // empty object and must still see its own orders.
  return ctx.moduleSettings[s.requiredModule] !== false;
}

function sensitiveAllowed(s: DataSetDescriptor, ctx: TenantContext): boolean {
  return !s.sensitive || ctx.allowWorkforceData;
}

export function visibleDataSets(
  ctx: TenantContext,
  sets: DataSetDescriptor[] = allDataSets(),
): DataSetDescriptor[] {
  return sets.filter(
    (s) => lineAllowed(s, ctx) && moduleAllowed(s, ctx) && sensitiveAllowed(s, ctx),
  );
}

export function assertDataSetAllowed(
  name: string,
  ctx: TenantContext,
  sets: DataSetDescriptor[] = allDataSets(),
): DataSetDescriptor {
  const s = sets.find((x) => x.name === name);
  if (!s) {
    throw new Error(
      `Unknown data set "${name}". Call list_data for what is available.`,
    );
  }
  if (!lineAllowed(s, ctx)) {
    throw new Error(
      `"${name}" needs the ${s.line.toUpperCase()} plan, which this account does not have.`,
    );
  }
  if (!moduleAllowed(s, ctx)) {
    throw new Error(`"${name}" is switched off in this account's settings.`);
  }
  if (!sensitiveAllowed(s, ctx)) {
    throw new Error(
      `"${name}" contains employee location, attendance or device data, which is not enabled for AI tools on this account. The account owner can switch it on in Settings.`,
    );
  }
  return s;
}
