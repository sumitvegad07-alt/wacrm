import { beforeEach, describe, expect, it } from "vitest";
import type { ColumnDef } from "@/components/ui/data-table/data-table-types";
import {
  configsEqual,
  countActiveFilters,
  isFilterActive,
  normalizeTableKey,
  parseConfig,
  pruneFilters,
  readScratchFilters,
  readStoredColumns,
  readStoredPageSize,
  reconcileColumns,
  writeScratchFilters,
  writeStoredColumns,
  writeStoredPageSize,
} from "./index";

/**
 * The helpers read `window.localStorage` / `window.sessionStorage`. The vitest
 * environment here is "node", so stand up the smallest thing that behaves like
 * them rather than pulling in jsdom for three string maps.
 */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = {
    localStorage: fakeStorage(),
    sessionStorage: fakeStorage(),
  };
});

describe("normalizeTableKey", () => {
  it("strips the version suffix so bumping it does not orphan saved views", () => {
    expect(normalizeTableKey("wacrm_leads_table_columns_v2")).toBe("wacrm_leads_table_columns");
    expect(normalizeTableKey("wacrm_contacts_table_columns_v3")).toBe(
      "wacrm_contacts_table_columns",
    );
  });

  it("leaves an unversioned key alone", () => {
    expect(normalizeTableKey("wacrm_orders_table_columns")).toBe("wacrm_orders_table_columns");
    expect(normalizeTableKey("announcements-table")).toBe("announcements-table");
  });

  it("does not mistake a mid-string v-number for a suffix", () => {
    expect(normalizeTableKey("wacrm_v2_orders")).toBe("wacrm_v2_orders");
  });
});

describe("scratch filters", () => {
  const key = "wacrm_leads_table_columns_v2";

  it("survives a round trip, which is what keeps filters on across navigation", () => {
    writeScratchFilters(key, { status: ["hot"], city: "Pune" });
    expect(readScratchFilters(key)).toEqual({ status: ["hot"], city: "Pune" });
  });

  it("returns undefined when nothing was ever stored", () => {
    expect(readScratchFilters(key)).toBeUndefined();
  });

  it("distinguishes 'cleared every filter' from 'never stored'", () => {
    // A user who deliberately cleared everything must get an empty set back,
    // not the module's defaults.
    writeScratchFilters(key, {});
    expect(readScratchFilters(key)).toEqual({});
    expect(readScratchFilters(key)).not.toBeUndefined();
  });

  it("is keyed per table, so one list cannot pick up another's filters", () => {
    writeScratchFilters("wacrm_leads_table_columns_v2", { status: ["hot"] });
    expect(readScratchFilters("wacrm_orders_table_columns")).toBeUndefined();
  });
});

describe("column storage", () => {
  const key = "wacrm_products_table_columns";

  it("round trips a layout", () => {
    writeStoredColumns(key, { active: ["name", "sku"], visible: ["name"] });
    expect(readStoredColumns(key)).toEqual({ active: ["name", "sku"], visible: ["name"] });
  });

  it("keeps the layout when rows-per-page is written afterwards", () => {
    writeStoredColumns(key, { active: ["name", "sku"], visible: ["name"] });
    writeStoredPageSize(key, 50);
    expect(readStoredPageSize(key)).toBe(50);
    expect(readStoredColumns(key)).toEqual({ active: ["name", "sku"], visible: ["name"] });
  });

  it("ignores a malformed record instead of throwing", () => {
    window.localStorage.setItem(key, "not json");
    expect(readStoredColumns(key)).toBeNull();
    expect(readStoredPageSize(key)).toBeNull();
  });
});

describe("reconcileColumns", () => {
  const columns = [
    { id: "name", label: "Name" },
    { id: "city", label: "City" },
    { id: "secret", label: "Secret", visibleByDefault: false },
    { id: "actions", label: "Action" },
  ] as ColumnDef<unknown>[];

  it("falls back to the code defaults when nothing is stored", () => {
    expect(reconcileColumns(columns, null)).toEqual({
      active: ["name", "city", "secret"],
      visible: ["name", "city"],
    });
  });

  it("never manages the pinned actions column", () => {
    const out = reconcileColumns(columns, null);
    expect(out.active).not.toContain("actions");
    expect(out.visible).not.toContain("actions");
  });

  it("keeps the user's own order", () => {
    const out = reconcileColumns(columns, { active: ["city", "name", "secret"], visible: ["city"] });
    expect(out.active).toEqual(["city", "name", "secret"]);
    expect(out.visible).toEqual(["city"]);
  });

  it("surfaces a column added by a later release inside an older saved layout", () => {
    const out = reconcileColumns(columns, { active: ["name"], visible: ["name"] });
    expect(out.active).toEqual(["name", "city", "secret"]);
    // `city` is new and visible by default; `secret` is new but opted out.
    expect(out.visible).toEqual(["name", "city"]);
  });

  it("drops ids for columns that no longer exist", () => {
    const out = reconcileColumns(columns, {
      active: ["name", "removed_last_year", "city", "secret"],
      visible: ["name", "removed_last_year"],
    });
    expect(out.active).toEqual(["name", "city", "secret"]);
    expect(out.visible).toEqual(["name"]);
  });
});

describe("filter counting", () => {
  it("counts only filters that are really set", () => {
    expect(
      countActiveFilters({
        status: ["hot"],
        city: "Pune",
        owner: null,
        stage: [],
        note: "",
      }),
    ).toBe(2);
  });

  it("treats blank, null and empty lists as unset", () => {
    expect(isFilterActive(null)).toBe(false);
    expect(isFilterActive(undefined)).toBe(false);
    expect(isFilterActive("")).toBe(false);
    expect(isFilterActive([])).toBe(false);
    expect(isFilterActive(["", ""])).toBe(false);
    expect(isFilterActive(["hot"])).toBe(true);
    expect(isFilterActive("Pune")).toBe(true);
    expect(isFilterActive(false)).toBe(true);
  });

  it("prunes unset keys", () => {
    expect(pruneFilters({ a: ["x"], b: null, c: "" })).toEqual({ a: ["x"] });
  });
});

describe("configsEqual — drives the '• Modified' marker", () => {
  const base = {
    filters: { status: ["hot"] },
    columns: { active: ["name", "city"], visible: ["name"] },
    pageSize: 20,
  };

  it("matches an identical arrangement", () => {
    expect(configsEqual(base, { ...base })).toBe(true);
  });

  it("ignores keys that are set to nothing", () => {
    expect(configsEqual(base, { ...base, filters: { status: ["hot"], city: null } })).toBe(true);
  });

  it("spots a changed filter", () => {
    expect(configsEqual(base, { ...base, filters: { status: ["cold"] } })).toBe(false);
  });

  it("spots an added filter", () => {
    expect(configsEqual(base, { ...base, filters: { status: ["hot"], city: "Pune" } })).toBe(false);
  });

  it("spots a hidden column and a reordered one", () => {
    expect(
      configsEqual(base, { ...base, columns: { active: ["name", "city"], visible: [] } }),
    ).toBe(false);
    expect(
      configsEqual(base, { ...base, columns: { active: ["city", "name"], visible: ["name"] } }),
    ).toBe(false);
  });

  it("spots a changed rows-per-page", () => {
    expect(configsEqual(base, { ...base, pageSize: 50 })).toBe(false);
  });

  it("does not call a view modified just because it never saved a column layout", () => {
    const viewWithoutColumns = { filters: { status: ["hot"] }, columns: null, pageSize: null };
    expect(configsEqual(base, viewWithoutColumns)).toBe(true);
  });
});

describe("parseConfig", () => {
  it("reads a well-formed config", () => {
    expect(
      parseConfig({
        filters: { status: ["hot"] },
        columns: { active: ["name"], visible: ["name"] },
        pageSize: 50,
      }),
    ).toEqual({
      filters: { status: ["hot"] },
      columns: { active: ["name"], visible: ["name"] },
      pageSize: 50,
    });
  });

  it("survives junk from the database without throwing", () => {
    expect(parseConfig(null)).toEqual({ filters: {}, columns: null, pageSize: null });
    expect(parseConfig({ filters: "nope", columns: 42, pageSize: -1 })).toEqual({
      filters: {},
      columns: null,
      pageSize: null,
    });
  });
});
