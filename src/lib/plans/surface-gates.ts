// ============================================================
// Surface gates — ONE table of "which plan line / module toggle does this
// screen need", shared by every surface that has to answer that question.
//
// Why this file exists. The gating used to be written out three times: the
// sidebar tree (`line` / `configModule` per nav item), the command palette
// (use-nav-items, mirroring it), and the direct-URL guard in dashboard-shell
// (a hand-written list of `pathname.startsWith(...)` tests). The three drifted,
// and every drift was a plan leak you could reach by typing the URL: /inbox,
// /flows, /price-lists, /stock, /reports/quotations, /reports/payments,
// /reports/expenses and /reports/stock were all hidden in the menu and served
// in full to a plan that had not bought them. Screens with no nav entry at all
// (the import wizards, the custom-field editors, the settings tabs) were never
// gated anywhere.
//
// So the route guard now reads this table, and so do the three families of
// screens that are addressed by a path or query segment rather than a nav item.
// Adding a screen means adding one row here.
//
// This is still the UX/navigation layer. The database is the real ceiling
// (account_has_line in RLS); these gates stop a user wandering into a screen
// that cannot work for them, with a clear reason, instead of letting it load
// and fail.
// ============================================================

import type { ModuleKey, ProductLine } from "@/lib/plans/catalog";

/**
 * What a surface needs. `line` requires exactly that product line; `anyLine`
 * requires at least one of several (the product catalogue is sold with CRM and
 * with SFA, so it needs either). `configModule` additionally requires the
 * admin's module toggle — which the server already clamps to the plan, so a
 * `configModule` on a single-line module doubles as a line check.
 */
export interface SurfaceGate {
  line?: ProductLine;
  anyLine?: readonly ProductLine[];
  /** Requires EVERY line listed. Lead Visits, for instance, are visits (WFA)
   *  against leads (CRM) — neither line alone can produce one. */
  allLines?: readonly ProductLine[];
  configModule?: ModuleKey;
}

export interface GateContext {
  /** Plan entitlement per line, from useAuth's hasCRM/hasWFA/hasSFA/hasFSM. */
  owns: Record<ProductLine, boolean>;
  /** Admin module toggle, already plan-clamped by /api/account/module-settings. */
  isModuleEnabled: (key: ModuleKey) => boolean;
}

/**
 * True if the account may open this surface. Deliberately has NO owner/admin
 * bypass: an owner on a CRM plan still must not reach the Order screens. Role
 * permissions are a separate, independent gate the callers apply themselves.
 */
export function gatePasses(gate: SurfaceGate | undefined, ctx: GateContext): boolean {
  if (!gate) return true;
  if (gate.line && !ctx.owns[gate.line]) return false;
  if (gate.anyLine && !gate.anyLine.some((l) => ctx.owns[l])) return false;
  if (gate.allLines && !gate.allLines.every((l) => ctx.owns[l])) return false;
  if (gate.configModule && !ctx.isModuleEnabled(gate.configModule)) return false;
  return true;
}

/** The catalogue (products, categories, units, catalogue settings) is sold in the
 *  CRM column ("Unlimited Products") and the SFA column, but NOT in WFA — a
 *  WFA-only tenant has no quotations and no orders to spend a catalogue on.
 *  Founder's Pricing, Packages & Plans sheet, 2026-09-26. */
export const CATALOG_LINES = ["crm", "sfa"] as const;

// ── Route gates ───────────────────────────────────────────────────────────────
//
// Matched longest-prefix-first so /reports/orders is tested before /reports and
// /location-tracking/attendance before /location-tracking. Paths absent from
// this table are base features available on every plan.
//
// Keep each entry in step with the matching nav item in sidebar.tsx. A screen
// that is gated in the menu and missing here is reachable by URL.
const ROUTE_GATES: readonly (SurfaceGate & { prefix: string })[] = [
  // ── CRM: WhatsApp suite ──
  { prefix: "/inbox", line: "crm", configModule: "whatsapp" },
  { prefix: "/whatsapp", line: "crm", configModule: "whatsapp" },
  { prefix: "/broadcasts", line: "crm", configModule: "whatsapp" },
  { prefix: "/automations", line: "crm", configModule: "whatsapp" },
  { prefix: "/flows", line: "crm", configModule: "whatsapp" },
  // ── CRM: leads & deals ──
  { prefix: "/leads", line: "crm" },
  { prefix: "/pipelines", line: "crm" },
  { prefix: "/deals", line: "crm" },
  { prefix: "/quotations", line: "crm", configModule: "quotation" },
  // ── Catalogue (CRM or SFA) ──
  { prefix: "/products", anyLine: CATALOG_LINES },
  { prefix: "/catalog", anyLine: CATALOG_LINES },
  // ── SFA ──
  { prefix: "/price-lists", line: "sfa" },
  { prefix: "/schemes", line: "sfa", configModule: "scheme" },
  { prefix: "/stock", line: "sfa", configModule: "stock" },
  { prefix: "/orders", line: "sfa" },
  { prefix: "/dispatches", line: "sfa", configModule: "dispatch" },
  { prefix: "/dispatch", line: "sfa", configModule: "dispatch" },
  { prefix: "/pending-dispatch", line: "sfa", configModule: "pending_dispatch" },
  { prefix: "/payments", line: "sfa", configModule: "payment" },
  { prefix: "/routes", line: "sfa", configModule: "route" },
  // ── FSM ──
  { prefix: "/service", line: "fsm" },
  // ── WFA ──
  { prefix: "/expenses", line: "wfa", configModule: "expense" },
  // User Attendance and Leaves live under /location-tracking but are base
  // features on every plan (the CRM column sells "Attendance, Leave & Holiday
  // Management"), so they carry no gate and must be listed FIRST.
  { prefix: "/location-tracking/attendance" },
  { prefix: "/location-tracking/leaves" },
  // Route Monitor shows route executions — Route Management is an SFA module.
  { prefix: "/location-tracking/executions", line: "sfa", configModule: "route" },
  { prefix: "/location-tracking", line: "wfa" },
  // ── Reports: each follows the module it reports on ──
  { prefix: "/reports/orders", line: "sfa" },
  { prefix: "/reports/sales", line: "sfa" },
  { prefix: "/reports/ageing", line: "sfa" },
  { prefix: "/reports/payments", line: "sfa", configModule: "payment" },
  { prefix: "/reports/stock", line: "sfa", configModule: "stock" },
  { prefix: "/reports/quotations", line: "crm", configModule: "quotation" },
  { prefix: "/reports/leads", line: "crm" },
  { prefix: "/reports/deals", line: "crm" },
  { prefix: "/reports/visits", line: "wfa" },
  { prefix: "/reports/dsr", line: "wfa" },
  { prefix: "/reports/expenses", line: "wfa", configModule: "expense" },
];

// Longest prefix wins, so a specific page beats the section it sits in.
const ROUTE_GATES_BY_SPECIFICITY = [...ROUTE_GATES].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

/** The gate for a pathname, or undefined when the path is a base feature. */
export function gateForPath(pathname: string): SurfaceGate | undefined {
  const hit = ROUTE_GATES_BY_SPECIFICITY.find(
    (g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`),
  );
  if (!hit) return undefined;
  const { prefix: _prefix, ...gate } = hit;
  return gate;
}

/** True if the account's plan does NOT allow this pathname. */
export function isRouteRestricted(pathname: string, ctx: GateContext): boolean {
  return !gatePasses(gateForPath(pathname), ctx);
}

// ── Import wizards (/import/<module>) ─────────────────────────────────────────
//
// The hub at /import filtered these; the wizard page itself did not, so
// /import/stock, /import/outstanding and /import/territories ran in full on a
// plan that owns none of them. Keyed by the same module keys as the hub.
export const IMPORT_GATES: Readonly<Record<string, SurfaceGate>> = {
  products: { anyLine: CATALOG_LINES },
  product_categories: { anyLine: CATALOG_LINES },
  product_units: { anyLine: CATALOG_LINES },
  leads: { line: "crm" },
  orders: { line: "sfa" },
  outstanding: { line: "sfa" },
  price_lists: { line: "sfa" },
  stock: { line: "sfa", configModule: "stock" },
  territories: { line: "wfa", configModule: "territory" },
  customer_assets: { line: "fsm" },
  // `contacts` and `tasks` are base imports on every plan.
};

// ── Custom-field editors (/custom-fields/<module>) ────────────────────────────
//
// Had no gating at all: a WFA-only tenant was offered the Sale Quotation, Lead,
// Deal, Order and Dispatch field builders; a CRM-only tenant the Order,
// Dispatch, Customer Visit, Lead Visit and Expense ones.
export const CUSTOM_FIELD_GATES: Readonly<Record<string, SurfaceGate>> = {
  product: { anyLine: CATALOG_LINES },
  quotation: { line: "crm", configModule: "quotation" },
  lead: { line: "crm" },
  deal: { line: "crm" },
  order: { line: "sfa" },
  dispatch: { line: "sfa", configModule: "dispatch" },
  customer_visit: { line: "wfa" },
  lead_visit: { allLines: ["crm", "wfa"] },
  expense: { line: "wfa", configModule: "expense" },
  // `user`, `contact` and `task` are base modules on every plan.
};
