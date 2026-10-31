import { describe, expect, test } from "vitest";
import { resolveSavedView, moduleForTab, querySignature } from "./open-view";
import { orderReportConfig } from "./orderReportConfig";
import type { ReportDefinition } from "./types";

// ---------------------------------------------------------------------------
// These rules decide what a report shows the moment it opens, and they now run
// in two places — the server, to answer the first query in the same response,
// and the viewer, to set its own state. The whole point of extracting them was
// that those two must not drift, so the tests pin the behaviour rather than
// either call site.
//
// The dangerous case is the second guard: a saved view is a snapshot of a
// layout the module's config may have changed underneath, and restoring one was
// the last remaining way an order-level measure could land on a product tab and
// overstate it.
// ---------------------------------------------------------------------------

const def = orderReportConfig as ReportDefinition;

const FALLBACK = {
  dimensions: ["customer_name"],
  measures: ["order_count", "net_amount"],
};

describe("resolveSavedView", () => {
  test("with no saved view, the caller's own defaults are used untouched", () => {
    const r = resolveSavedView(def, null, FALLBACK);

    expect(r.dimensions).toEqual(FALLBACK.dimensions);
    expect(r.measures).toEqual(FALLBACK.measures);
    // No saved dimension means no reason to move the tab highlight.
    expect(r.tabKey).toBeNull();
  });

  test("a valid saved layout is restored as it was", () => {
    const first = def.dimensions[0].key;
    const measure = def.measures[0].key;

    const r = resolveSavedView(def, { dimensions: [first], measures: [measure] }, FALLBACK);

    expect(r.dimensions).toEqual([first]);
    expect(r.measures).toEqual([measure]);
  });

  test("drops a dimension the module no longer registers", () => {
    const real = def.dimensions[0].key;

    const r = resolveSavedView(
      def,
      { dimensions: [real, "a_dimension_that_was_deleted"], measures: FALLBACK.measures },
      FALLBACK,
    );

    expect(r.dimensions).toEqual([real]);
  });

  test("falls back rather than showing an empty table when nothing survives", () => {
    const r = resolveSavedView(
      def,
      { dimensions: ["gone_1", "gone_2"], measures: ["gone_3"] },
      FALLBACK,
    );

    expect(r.dimensions).toEqual(FALLBACK.dimensions);
    expect(r.measures.length).toBeGreaterThan(0);
  });

  test("never restores a measure the restored tab is not allowed to use", () => {
    // The guard only bites on a tab that restricts its measures; find one.
    const restricted = def.tabConfigs?.find(
      (t) => t.availableMeasures && t.availableMeasures.length > 0,
    );
    if (!restricted) return; // orderReportConfig always has one; be safe if it changes.

    const forbidden = def.measures
      .map((m) => m.key)
      .find((k) => !restricted.availableMeasures!.includes(k));
    expect(forbidden, "a measure this tab forbids").toBeTruthy();

    const r = resolveSavedView(
      def,
      { dimensions: [restricted.dimension], measures: [forbidden!] },
      FALLBACK,
    );

    expect(r.measures).not.toContain(forbidden);
    // …and it lands on that tab's own defaults, not the caller's, because the
    // caller's belong to a tab of possibly different grain.
    expect(r.measures).toEqual(restricted.defaultMeasures);
  });

  test("moves the tab highlight to the tab the saved dimension belongs to", () => {
    const tab = def.tabConfigs?.[1] ?? def.tabConfigs?.[0];
    if (!tab) return;

    const r = resolveSavedView(
      def,
      { dimensions: [tab.dimension], measures: tab.defaultMeasures },
      FALLBACK,
    );

    expect(r.tabKey).toBe(tab.key);
  });
});

describe("moduleForTab", () => {
  test("a tab with no override queries the report's own module", () => {
    expect(moduleForTab(def, null)).toBe(def.moduleName);
  });

  test("a tab with an override queries that module instead", () => {
    const overridden = def.tabConfigs?.find((t) => t.moduleOverride);
    if (!overridden) return;

    expect(moduleForTab(def, overridden.key)).toBe(overridden.moduleOverride);
  });
});

describe("querySignature", () => {
  const base = {
    module: "order",
    dimensions: ["customer_name"],
    measures: ["order_count"],
    filters: { date_range: { start_date: "2026-10-01", end_date: "2026-10-31" } },
    sortColumn: null,
    sortDirection: "asc" as const,
    limit: 51,
    offset: 0,
  };

  test("two identical queries agree", () => {
    expect(querySignature(base)).toBe(querySignature({ ...base }));
  });

  test("key order does not matter, at any depth", () => {
    // One side builds this from React state, the other from a JSONB column, and
    // Postgres does not promise the order it returns an object's keys in.
    const reordered = {
      ...base,
      filters: { date_range: { end_date: "2026-10-31", start_date: "2026-10-01" } },
    };

    expect(querySignature(reordered)).toBe(querySignature(base));
  });

  test("an absent sortColumn and an explicit null are the same query", () => {
    const { sortColumn: _omit, ...withoutSort } = base;

    expect(querySignature({ ...withoutSort, sortColumn: null })).toBe(querySignature(base));
  });

  test("a different measure is a different query", () => {
    expect(querySignature({ ...base, measures: ["net_amount"] })).not.toBe(
      querySignature(base),
    );
  });

  test("a different page is a different query", () => {
    expect(querySignature({ ...base, offset: 50 })).not.toBe(querySignature(base));
  });

  test("a different filter value is a different query", () => {
    expect(
      querySignature({ ...base, filters: { date_range: { start_date: "2026-09-01" } } }),
    ).not.toBe(querySignature(base));
  });
});
