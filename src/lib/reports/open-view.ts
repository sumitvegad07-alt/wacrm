// ============================================================
// Opening a report: which layout it lands on, and whether a query has already
// been answered.
//
// Both rules used to live inside the viewer's hydration effect, which meant the
// server could not know what the client was about to ask for — so opening a
// report cost two round trips in sequence: fetch the saved view, then, once the
// client had made sense of it, fetch the rows. A Vercel function here measures
// 300-600 ms warm and about 1.4 s cold, so that second trip was most of the
// spinner. (The database was never the problem: `execute_report` answers in
// 140-230 ms against the largest tenant.)
//
// Pulling the rules out as pure functions lets `openReport` resolve the layout
// server-side and return the rows in the same response, while the viewer keeps
// resolving it the same way — one implementation, so a saved view cannot mean
// one thing on the server and another in the browser.
// ============================================================

import type { ReportDefinition, ReportConfig } from "./types";

/** What the viewer would have used had there been no saved view. */
export interface ViewFallback {
  dimensions: string[];
  measures: string[];
}

export interface ResolvedView {
  dimensions: string[];
  measures: string[];
  /** The tab whose dimension the restored layout matches, if any. */
  tabKey: string | null;
}

/** A tab's default measures, or the engine-wide default for a report with no tabs. */
const GLOBAL_DEFAULT_MEASURES = [
  "gross_amount",
  "net_amount",
  "order_count",
  "product_quantity",
];

function defaultMeasuresForTab(def: ReportDefinition, tabKey: string): string[] {
  const tab = def.tabConfigs?.find((t) => t.key === tabKey);
  return tab?.defaultMeasures || GLOBAL_DEFAULT_MEASURES;
}

/**
 * The layout a report opens on, given the viewer's own defaults and whatever
 * saved view the user has.
 *
 * Two guards, both of which exist because a saved view is a snapshot of a
 * layout that the module's config may since have changed underneath:
 *
 *   - a dimension or measure the module no longer registers is dropped, and if
 *     that empties the list the built-in layout wins rather than an empty table;
 *   - a measure the *restored tab* is not allowed to use is dropped even if the
 *     module still registers it. Switching tabs resets the selection to that
 *     tab's defaults, so restoring a saved view was the only remaining way an
 *     order-level quantity could land on a product tab and overstate it (see
 *     orderReportConfig.ts; the quotation twins have the same hazard).
 */
export function resolveSavedView(
  def: ReportDefinition,
  saved: Partial<ReportConfig> | null | undefined,
  fallback: ViewFallback,
): ResolvedView {
  const cfg = saved ?? null;

  const dimensions = (cfg?.dimensions ?? fallback.dimensions).filter((d) =>
    def.dimensions.some((cd) => cd.key === d),
  );

  const leadDimension = cfg?.dimensions?.[0] ?? fallback.dimensions[0];
  const restoredTab = def.tabConfigs?.find((t) => t.dimension === leadDimension);
  const allowed = restoredTab?.availableMeasures;

  const measures = (cfg?.measures ?? fallback.measures).filter(
    (m) =>
      def.measures.some((cm) => cm.key === m) && (!allowed || allowed.includes(m)),
  );

  return {
    dimensions: dimensions.length ? dimensions : fallback.dimensions,
    // If nothing survived, fall back to the RESTORED tab's defaults rather than
    // the caller's — those belong to the tab the report opens on, which may be a
    // different grain entirely.
    measures: measures.length
      ? measures
      : restoredTab
        ? defaultMeasuresForTab(def, restoredTab.key)
        : fallback.measures,
    // Only a saved dimension moves the tab highlight. Falling back to the
    // built-in dimension here would re-select the tab the report already opens
    // on, which is at best a no-op and at worst fights `defaultTab`.
    tabKey: cfg?.dimensions?.[0]
      ? (def.tabConfigs?.find((t) => t.dimension === cfg.dimensions![0])?.key ?? null)
      : null,
  };
}

/** The registry module a resolved tab actually queries. */
export function moduleForTab(
  def: ReportDefinition,
  tabKey: string | null,
): string {
  const tab = def.tabConfigs?.find((t) => t.key === tabKey);
  return tab?.moduleOverride ?? def.moduleName;
}

/** Everything that decides which rows come back. */
export interface ReportQuery {
  module: string;
  dimensions: string[];
  measures: string[];
  filters: Record<string, unknown>;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  limit: number;
  offset: number;
}

/**
 * A stable string for a query, so the viewer can tell whether the rows the
 * server volunteered are the rows it is about to ask for.
 *
 * Key order is normalised at every level: one side builds this from React
 * state and the other from a JSONB column, and `JSON.stringify` alone would
 * call those different for no better reason than the order Postgres happened to
 * return a filter object's keys in. Getting that wrong costs only a wasted
 * round trip, never a wrong answer — the comparison is an optimisation, and the
 * query runs normally whenever it does not match.
 */
export function querySignature(q: ReportQuery): string {
  return stableStringify({
    module: q.module,
    dimensions: q.dimensions,
    measures: q.measures,
    filters: q.filters ?? {},
    sortColumn: q.sortColumn ?? null,
    sortDirection: q.sortDirection,
    limit: q.limit,
    offset: q.offset,
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
