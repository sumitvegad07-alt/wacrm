// ============================================================
// Which report columns this account's plan actually allows.
//
// A report measure is a correlated subquery over one module's table, so a
// column is only meaningful when the account owns the line that module is
// sold on: "New Leads" reads `leads` (CRM), "Order Amount" reads `orders`
// (SFA), "Days Present" reads `tracking_sessions` (WFA). Two of the DSR's
// columns read two tables at once — "Lead Visits" is a visit (WFA) against a
// lead (CRM), "Productive Visits" is a visit that produced an order (SFA) —
// and need BOTH lines.
//
// `ReportMeasure.requiredModule` was meant to be this gate. It has been
// declared in types.ts since the report engine was written (2026-08-12) and
// is read by nothing: `git log -S requiredModule -- report-viewer.tsx`
// returns no commit for the file's entire history. Its values were the wrong
// vocabulary anyway — report module names ('orders', 'leads') rather than
// `accounts.module_settings` keys ('order', 'payment') — the same trap the
// mobile app hit and fixed in 2026-10. So every report has always offered
// every column on every plan, and an SFA-only account read Lead and
// Quotation columns on its DSR.
//
// Rather than repair a fourth gating vocabulary, measures now carry the same
// `SurfaceGate` the sidebar, the command palette, the route guard and the
// settings tabs read, evaluated by the same `gatePasses`. One table, one
// meaning. See lib/plans/surface-gates.ts.
//
// This is the UX layer: it stops a column being offered. The database is the
// real ceiling — `execute_report` only reaches tables the account's RLS lets
// it read, and a line it does not own has no rows to return.
// ============================================================

import { gatePasses, type GateContext, type SurfaceGate } from "@/lib/plans/surface-gates";

/** The shape this module needs — anything carrying an optional gate. */
interface Gated {
  key: string;
  gate?: SurfaceGate;
}

/** The measures this account may be offered, in their original order. */
export function allowedMeasures<T extends Gated>(
  measures: readonly T[],
  ctx: GateContext,
): T[] {
  return measures.filter((m) => gatePasses(m.gate, ctx));
}

/** The same answer as a Set, for filtering a list of selected measure keys. */
export function allowedMeasureKeys(
  measures: readonly Gated[],
  ctx: GateContext,
): Set<string> {
  return new Set(allowedMeasures(measures, ctx).map((m) => m.key));
}

/**
 * Narrow a saved or default selection to what the plan allows.
 *
 * Needed as well as `allowedMeasures` because a selection outlives the plan:
 * `tabConfigs[].defaultMeasures` lists every DSR column, and a saved view can
 * carry a column from before a line was removed. Never returns an empty list
 * while any measure is allowed — a report with no columns renders as a blank
 * screen with no way back, so it falls back to the first allowed measure.
 */
export function narrowSelection(
  selected: readonly string[],
  measures: readonly Gated[],
  ctx: GateContext,
): string[] {
  const allowed = allowedMeasureKeys(measures, ctx);
  const kept = selected.filter((key) => allowed.has(key));
  if (kept.length > 0) return kept;
  const first = allowedMeasures(measures, ctx)[0];
  return first ? [first.key] : [];
}
