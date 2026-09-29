// ============================================================
// OZZO Plan Catalog — canonical plan → product-line → module map.
//
// Single source of truth for what each commercial plan unlocks. Pure data and
// pure functions only: no DB, no React, no Supabase. The super-admin write
// path, the tenant module-settings guard, and the client-side gating in
// use-auth all derive from here so the three can never drift.
//
// Commercial model (see OZZO Pricing & Feature Catalogue v1.0):
//   Four product lines — CRM, WFA (Workforce Automation), SFA, FSM (Field
//   Service Management).
//   SFA and FSM both always include WFA. A plan is a combination of lines.
// ============================================================

export type ProductLine = "crm" | "wfa" | "sfa" | "fsm";

// The eight sellable plans. There is no separate "Trial" plan: a paid trial is
// just a real plan (e.g. SFA) with a subscription_expires_at set to the trial
// end date. New signups default to CRM.
export type PlanId =
  | "CRM"
  | "WFA"
  | "CRM_WFA"
  | "SFA"
  | "CRM_SFA"
  | "FSM"
  | "CRM_FSM"
  | "SFA_FSM";

export const PLAN_IDS: readonly PlanId[] = [
  "CRM",
  "WFA",
  "CRM_WFA",
  "SFA",
  "CRM_SFA",
  "FSM",
  "CRM_FSM",
  "SFA_FSM",
] as const;

/** Human label as shown in super-admin and on invoices. */
export const PLAN_LABEL: Record<PlanId, string> = {
  CRM: "CRM",
  WFA: "WFA",
  CRM_WFA: "CRM + WFA",
  SFA: "SFA",
  CRM_SFA: "CRM + SFA",
  FSM: "FSM",
  CRM_FSM: "CRM + FSM",
  SFA_FSM: "SFA + FSM",
};

/** Per-user monthly price in INR (annual base). */
export const PLAN_PRICE: Record<PlanId, number> = {
  CRM: 100,
  WFA: 150,
  CRM_WFA: 200,
  SFA: 300,
  CRM_SFA: 400,
  // PLACEHOLDERS — not founder-approved (FSM spec section 10 ruling 1).
  // Do not publish these prices until they are confirmed.
  FSM: 500,
  CRM_FSM: 600,
  SFA_FSM: 800,
};

/**
 * Which product lines each plan turns on. SFA includes WFA, so the SFA plan
 * has wfa:true.
 */
export const PLAN_LINES: Record<PlanId, Record<ProductLine, boolean>> = {
  CRM: { crm: true, wfa: false, sfa: false, fsm: false },
  WFA: { crm: false, wfa: true, sfa: false, fsm: false },
  CRM_WFA: { crm: true, wfa: true, sfa: false, fsm: false },
  SFA: { crm: false, wfa: true, sfa: true, fsm: false },
  CRM_SFA: { crm: true, wfa: true, sfa: true, fsm: false },
  // FSM includes WFA, exactly as SFA does.
  FSM: { crm: false, wfa: true, sfa: false, fsm: true },
  CRM_FSM: { crm: true, wfa: true, sfa: false, fsm: true },
  SFA_FSM: { crm: false, wfa: true, sfa: true, fsm: true },
};

// ── The 9 admin-configurable module keys (existing module_settings shape) ──
export type ModuleKey =
  | "whatsapp"
  | "quotation"
  | "expense"
  | "dispatch"
  | "pending_dispatch"
  | "territory"
  | "reporting_hierarchy"
  | "route"
  | "payment"
  | "scheme"
  | "stock"
  | "service";

export const MODULE_KEYS: readonly ModuleKey[] = [
  "whatsapp",
  "quotation",
  "expense",
  "dispatch",
  "pending_dispatch",
  "territory",
  "reporting_hierarchy",
  "route",
  "payment",
  "scheme",
  "stock",
  "service",
] as const;

/** Which product line owns each configurable module. */
export const MODULE_LINE: Record<ModuleKey, ProductLine> = {
  // CRM line
  whatsapp: "crm",
  quotation: "crm",
  // WFA line
  expense: "wfa",
  territory: "wfa",
  reporting_hierarchy: "wfa",
  // SFA line
  // Route Management (RTM) is sold with SFA, not WFA — see the founder's
  // Pricing, Packages & Plans sheet (2026-09-26). Moved here from the WFA
  // line; no WFA or CRM+WFA account had it enabled when this changed.
  route: "sfa",
  dispatch: "sfa",
  pending_dispatch: "sfa",
  payment: "sfa",
  scheme: "sfa",
  stock: "sfa",
  // FSM line
  service: "fsm",
};

/**
 * Modules that stay OFF when a plan is first applied even though their line is
 * on, because they are optional or Available-Soon. They remain *allowable* —
 * the tenant admin may switch them on — but are not defaulted on.
 */
const DEFAULT_OFF: ReadonlySet<ModuleKey> = new Set([
  "route", // Beat Planning: optional, free-visit mode is the default
  "reporting_hierarchy", // User Hierarchy: Available Soon, ships off
  "scheme", // Scheme Management: opt-in from Catalogue Settings, ships off
  "stock", // Stock Management: opt-in from Catalogue Settings, ships off
]);

// ── Legacy plan names still present in the DB (pre-migration) ──
// Free / Basic / Pro / Enterprise / Premium predate the line model. Until a
// super-admin assigns a real new plan, `planLines` treats any non-new value as
// FULL access so no live tenant loses features on deploy. `isNewPlan`
// distinguishes the new sellable plans from those legacy values.
export function isNewPlan(raw: unknown): raw is PlanId {
  return typeof raw === "string" && (PLAN_IDS as readonly string[]).includes(raw);
}

/**
 * Product lines granted by a stored subscription_plan value.
 * - A known new PlanId → its line map.
 * - A legacy/unknown value → full access to crm/wfa/sfa (safe default; nothing
 *   locks out until the account is explicitly re-planned). NOT fsm: that line
 *   was invented after those tenants signed up, so it was never part of their
 *   "full access", and granting it would switch the unfinished `service` module
 *   on for every legacy tenant.
 */
export function planLines(rawPlan: unknown): Record<ProductLine, boolean> {
  if (isNewPlan(rawPlan)) return { ...PLAN_LINES[rawPlan] };
  return { crm: true, wfa: true, sfa: true, fsm: false };
}

/** True if the plan grants the given product line. */
export function planHasLine(rawPlan: unknown, line: ProductLine): boolean {
  return planLines(rawPlan)[line];
}

/** The module keys a plan is *allowed* to enable (its line is on). */
export function allowedModules(rawPlan: unknown): Set<ModuleKey> {
  const lines = planLines(rawPlan);
  return new Set(MODULE_KEYS.filter((k) => lines[MODULE_LINE[k]]));
}

/**
 * The module_settings a plan starts with when it is first applied:
 * every allowed module ON, except the DEFAULT_OFF ones.
 */
export function defaultModuleSettings(
  rawPlan: unknown,
): Record<ModuleKey, boolean> {
  const allowed = allowedModules(rawPlan);
  const out = {} as Record<ModuleKey, boolean>;
  for (const k of MODULE_KEYS) {
    out[k] = allowed.has(k) && !DEFAULT_OFF.has(k);
  }
  return out;
}

/**
 * Hard-lock: clamp a *desired* module_settings map to what the plan allows.
 * The tenant admin may turn allowed modules on or off, but any module outside
 * the plan is forced false regardless of what was requested or previously
 * stored. This is the server-side ceiling that makes plans enforceable.
 */
export function clampModuleSettings(
  rawPlan: unknown,
  desired: Partial<Record<ModuleKey, boolean>> | null | undefined,
): Record<ModuleKey, boolean> {
  const allowed = allowedModules(rawPlan);
  const out = {} as Record<ModuleKey, boolean>;
  for (const k of MODULE_KEYS) {
    out[k] = allowed.has(k) ? desired?.[k] === true : false;
  }
  return out;
}
