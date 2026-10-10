import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const DASHBOARD_ROOT = join(process.cwd(), "src", "app", "(dashboard)");

/**
 * Every dashboard route that can be opened without knowing a record id.
 *
 * Directories named `[something]` are skipped: a detail page needs a real
 * record, and this suite is read-only against the production database, so it
 * must not depend on any particular row existing. Detail pages are covered
 * per-module in the Phase 3 batches instead.
 */
export function staticDashboardRoutes(): string[] {
  const routes: string[] = [];
  walk(DASHBOARD_ROOT, routes);
  return routes.sort();
}

function walk(dir: string, routes: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("[")) continue;
      if (entry.startsWith("(")) continue; // route group, not a URL segment
      walk(full, routes);
      continue;
    }
    if (entry !== "page.tsx") continue;
    const segments = dir.slice(DASHBOARD_ROOT.length).split(sep).filter(Boolean);
    if (segments.length === 0) continue; // the group has no page of its own
    routes.push("/" + segments.join("/"));
  }
}

/**
 * A representative slice of the app, used for the all-engine runs.
 *
 * One of each shape: a plain table page, a wide table, a create form, a
 * settings page with a side rail, a dashboard of charts, a wizard, a map
 * page, a kanban board, a report, and the chat-shaped inbox. If a layout rule
 * is wrong, it is almost certainly wrong on one of these.
 */
export const SMOKE_ROUTES = [
  "/contacts",
  "/orders",
  "/leads/new",
  "/settings",
  "/dashboard",
  "/import",
  "/location-tracking/all-locations",
  "/pipelines",
  "/reports/sales",
  "/inbox",
] as const;

/**
 * The routes the current run covers.
 *
 * `RESPONSIVE_SCOPE=smoke` (the default) runs the 10 representative routes, so
 * the all-engine matrix finishes in minutes. `RESPONSIVE_SCOPE=all` runs every
 * static route — use it on Chromium for a full sweep, and before declaring a
 * phase complete.
 */
export function routesUnderTest(): string[] {
  return process.env.RESPONSIVE_SCOPE === "all"
    ? staticDashboardRoutes()
    : [...SMOKE_ROUTES];
}
