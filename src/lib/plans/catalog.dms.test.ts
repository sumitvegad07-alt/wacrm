import { describe, it, expect } from "vitest";
import {
  PLAN_IDS,
  planLines,
  accountLines,
  accountHasAddonLine,
  ADDON_LINES,
  ADDON_LABEL,
} from "./catalog";

describe("dms add-on line", () => {
  it("is never granted by any plan code", () => {
    // The whole commercial model depends on this: DMS is sold, not included.
    for (const plan of PLAN_IDS) {
      expect(planLines(plan).dms).toBe(false);
    }
  });

  it("is not granted by a legacy or unknown plan either", () => {
    // Legacy plans get full access in account_has_line's fallback. 001001 is one.
    expect(planLines("Enterprise" as never).dms).toBe(false);
    expect(planLines("" as never).dms).toBe(false);
  });

  it("is granted only by an explicit addon_lines entry", () => {
    expect(accountHasAddonLine(["dms"], "dms")).toBe(true);
    expect(accountHasAddonLine([], "dms")).toBe(false);
    expect(accountHasAddonLine(null, "dms")).toBe(false);
    expect(accountHasAddonLine(undefined, "dms")).toBe(false);
  });

  it("still lists exactly eight sellable plan codes", () => {
    expect(PLAN_IDS).toHaveLength(8);
  });

  it("has a label for every add-on", () => {
    for (const a of ADDON_LINES) {
      expect(ADDON_LABEL[a]).toBeTruthy();
    }
  });
});

describe("accountLines", () => {
  it("equals planLines when there are no add-ons", () => {
    for (const plan of [...PLAN_IDS, "Enterprise", ""]) {
      expect(accountLines(plan, [])).toEqual(planLines(plan));
      expect(accountLines(plan, null)).toEqual(planLines(plan));
      expect(accountLines(plan, undefined)).toEqual(planLines(plan));
    }
  });

  it("grants dms only when the add-on is listed", () => {
    expect(accountLines("CRM_SFA", ["dms"]).dms).toBe(true);
    expect(accountLines("CRM_SFA", []).dms).toBe(false);
    expect(accountLines("Enterprise", ["dms"]).dms).toBe(true);
  });

  it("leaves the plan's own lines untouched by an add-on", () => {
    const base = planLines("CRM_SFA");
    const withAddon = accountLines("CRM_SFA", ["dms"]);
    expect({ ...withAddon, dms: false }).toEqual(base);
  });

  it("ignores unknown add-on names", () => {
    expect(accountLines("CRM", ["bogus"])).toEqual(planLines("CRM"));
  });
});
