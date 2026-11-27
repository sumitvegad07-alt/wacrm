import { describe, expect, it } from "vitest";
import {
  CUSTOM_FEATURES,
  accountHasCustomFeature,
  customFeature,
  isCustomFeatureKey,
  isGrantableCustomFeature,
  normalizeCustomFeatures,
  type CustomFeature,
} from "./custom-features";
import { ALL_GATES } from "./surface-gates";

// A stand-in catalogue. The real one is empty until a client is actually sold
// something, and an empty catalogue makes every behaviour test pass for the
// wrong reason.
const SAMPLE: readonly CustomFeature[] = [
  {
    key: "acme_crate_label",
    label: "Crate label print",
    description: "Prints a crate label instead of a carton label.",
    requestedBy: "Acme (001234)",
    since: "2026-11-27",
    surfaces: ["web"],
  },
  {
    key: "acme_old_rule",
    label: "Old rounding rule",
    description: "Rounds order totals down to the rupee.",
    requestedBy: "Acme (001234)",
    since: "2026-11-27",
    surfaces: ["web", "mobile"],
    retired: true,
    retiredNote: "Became a standard Catalogue setting on 2026-12-01.",
  },
];

describe("custom feature catalogue hygiene", () => {
  it("has unique, lower_snake_case keys", () => {
    const keys = CUSTOM_FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("records who asked and when, so the register reads as a history", () => {
    for (const f of CUSTOM_FEATURES) {
      expect(f.requestedBy.trim()).not.toBe("");
      expect(f.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.surfaces.length).toBeGreaterThan(0);
    }
  });

  it("explains every retired key", () => {
    for (const f of CUSTOM_FEATURES) {
      if (f.retired) expect(f.retiredNote?.trim()).not.toBe("");
    }
  });

  // The gate table may name a custom feature; a typo there would hide a screen
  // from the client it was built for, silently and forever.
  it("backs every customFeature named in the surface gates", () => {
    for (const [surface, gate] of Object.entries(ALL_GATES)) {
      if (gate?.customFeature) {
        expect(
          isCustomFeatureKey(gate.customFeature),
          `${surface} gates on unknown custom feature "${gate.customFeature}"`,
        ).toBe(true);
      }
    }
  });
});

describe("normalizeCustomFeatures", () => {
  it("keeps known keys, sorted and deduped", () => {
    expect(
      normalizeCustomFeatures(
        ["acme_old_rule", "acme_crate_label", "acme_crate_label"],
        SAMPLE,
      ),
    ).toEqual(["acme_crate_label", "acme_old_rule"]);
  });

  it("drops anything not in the catalogue", () => {
    expect(
      normalizeCustomFeatures(["acme_crate_label", "dropped_key", 7, null], SAMPLE),
    ).toEqual(["acme_crate_label"]);
  });

  it("keeps a retired key the account still holds", () => {
    expect(normalizeCustomFeatures(["acme_old_rule"], SAMPLE)).toEqual([
      "acme_old_rule",
    ]);
  });

  it("answers [] for null, a string or an object", () => {
    expect(normalizeCustomFeatures(null, SAMPLE)).toEqual([]);
    expect(normalizeCustomFeatures("acme_crate_label", SAMPLE)).toEqual([]);
    expect(normalizeCustomFeatures({ acme_crate_label: true }, SAMPLE)).toEqual([]);
  });
});

describe("granting", () => {
  it("refuses a retired key to someone new", () => {
    expect(isGrantableCustomFeature("acme_crate_label", SAMPLE)).toBe(true);
    expect(isGrantableCustomFeature("acme_old_rule", SAMPLE)).toBe(false);
    expect(isGrantableCustomFeature("never_existed", SAMPLE)).toBe(false);
  });
});

describe("accountHasCustomFeature", () => {
  it("fails closed on null, undefined and a non-array", () => {
    expect(accountHasCustomFeature(null, "acme_crate_label")).toBe(false);
    expect(accountHasCustomFeature(undefined, "acme_crate_label")).toBe(false);
    expect(
      accountHasCustomFeature("acme_crate_label" as unknown as string[], "acme_crate_label"),
    ).toBe(false);
  });

  it("is true only for an exact key the account holds", () => {
    expect(accountHasCustomFeature(["acme_crate_label"], "acme_crate_label")).toBe(true);
    expect(accountHasCustomFeature(["acme_crate_label"], "acme_crate")).toBe(false);
    expect(accountHasCustomFeature([], "acme_crate_label")).toBe(false);
  });
});

describe("customFeature lookup", () => {
  it("is undefined for an unknown key", () => {
    expect(customFeature("never_existed")).toBeUndefined();
  });
});
