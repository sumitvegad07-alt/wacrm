import { describe, expect, it } from "vitest";
import { assertDataSetAllowed, visibleDataSets } from "./gating";
import type { TenantContext } from "./gating";
import type { DataSetDescriptor } from "./types";

const crmOnly: TenantContext = { plan: "CRM", moduleSettings: {}, allowWorkforceData: false };
const sfa: TenantContext = { plan: "CRM_SFA", moduleSettings: {}, allowWorkforceData: false };
const sfaWithWorkforce: TenantContext = { ...sfa, allowWorkforceData: true };
const wfaOnly: TenantContext = { plan: "WFA", moduleSettings: {}, allowWorkforceData: false };

/** A stand-in catalog, so the three gates can be tested independently of
 *  which real data sets happen to exist yet. */
const stub = (over: Partial<DataSetDescriptor>): DataSetDescriptor => ({
  name: "thing",
  title: "Thing",
  route: "reader",
  line: "crm",
  table: "things",
  fields: [{ key: "id", label: "ID", type: "text" }],
  filters: [],
  dimensions: [],
  measures: [],
  notes: "x".repeat(50),
  examples: ["a", "b"],
  ...over,
});

const STUBS: DataSetDescriptor[] = [
  stub({ name: "crm_thing", line: "crm" }),
  stub({ name: "wfa_thing", line: "wfa" }),
  stub({ name: "sfa_thing", line: "sfa" }),
  stub({ name: "fsm_thing", line: "fsm" }),
  stub({ name: "toggled_thing", line: "crm", requiredModule: "quotations" }),
  stub({ name: "secret_thing", line: "wfa", sensitive: true }),
];

describe("visibleDataSets", () => {
  it("hides SFA and WFA data sets from a CRM-only tenant", () => {
    const names = visibleDataSets(crmOnly).map((s) => s.name);
    expect(names).toContain("orders");
    expect(names).not.toContain("visits"); // wfa line
    expect(names).not.toContain("employees"); // wfa line
  });

  it("shows WFA and CRM data sets to a CRM+SFA tenant", () => {
    const names = visibleDataSets(sfa).map((s) => s.name);
    expect(names).toContain("visits");
    expect(names).toContain("orders");
    expect(names).toContain("daily_summary");
  });

  it("hides CRM data sets from a WFA-only tenant", () => {
    const names = visibleDataSets(wfaOnly).map((s) => s.name);
    expect(names).toContain("visits");
    expect(names).not.toContain("orders");
    expect(names).not.toContain("customers");
  });

  it("respects a module toggle that is switched off", () => {
    // The real accounts.module_settings key is 'quotation' (singular); the
    // report config's 'quotations' is translated in the catalog.
    const off: TenantContext = { ...sfa, moduleSettings: { quotation: false } };
    expect(visibleDataSets(off).map((s) => s.name)).not.toContain("quotations");
    expect(visibleDataSets(sfa).map((s) => s.name)).toContain("quotations");
  });

  it("treats an absent module toggle as enabled, not disabled", () => {
    // The dashboard reads module_settings the same way: only an explicit
    // false hides a module, because a fresh account has an empty object.
    expect(visibleDataSets(sfa).map((s) => s.name)).toContain("orders");
  });

  // The three gates, exercised against a stand-in catalog so each one is
  // tested on its own rather than through whichever real data set happens
  // to carry the flag.
  describe("each gate in isolation", () => {
    it("filters by plan line", () => {
      expect(visibleDataSets(crmOnly, STUBS).map((s) => s.name)).toEqual([
        "crm_thing",
        "toggled_thing",
      ]);
      expect(visibleDataSets(sfa, STUBS).map((s) => s.name)).toEqual([
        "crm_thing",
        "wfa_thing",
        "sfa_thing",
        "toggled_thing",
      ]);
    });

    it("filters by module toggle", () => {
      const off: TenantContext = { ...crmOnly, moduleSettings: { quotations: false } };
      expect(visibleDataSets(off, STUBS).map((s) => s.name)).toEqual(["crm_thing"]);
    });

    it("hides a sensitive data set until the workforce switch is on", () => {
      expect(visibleDataSets(sfa, STUBS).map((s) => s.name)).not.toContain("secret_thing");
      expect(visibleDataSets(sfaWithWorkforce, STUBS).map((s) => s.name)).toContain(
        "secret_thing",
      );
    });

    it("still applies the plan line to a sensitive data set", () => {
      // The privacy switch is an extra gate, never an override: a CRM-only
      // tenant that somehow switched it on still has no WFA line.
      const crmWithSwitch: TenantContext = { ...crmOnly, allowWorkforceData: true };
      expect(visibleDataSets(crmWithSwitch, STUBS).map((s) => s.name)).not.toContain(
        "secret_thing",
      );
    });
  });
});

// Production holds an account on the legacy plan "Enterprise", which is not
// in PLAN_IDS. The product rule is that legacy plans get full access, so
// these must not come back empty.
describe("legacy and malformed plans", () => {
  const legacy: TenantContext = {
    plan: "Enterprise",
    moduleSettings: {},
    allowWorkforceData: false,
  };

  it("gives a legacy plan full access rather than an empty menu", () => {
    const names = visibleDataSets(legacy).map((s) => s.name);
    expect(names).toContain("orders");
    expect(names).toContain("visits");
    expect(names).toContain("customers");
    expect(names.length).toBeGreaterThan(5);
  });

  it("treats a null or missing plan as legacy, not as no access", () => {
    for (const plan of [null, undefined, ""]) {
      const ctx: TenantContext = { plan, moduleSettings: {}, allowWorkforceData: false };
      expect(visibleDataSets(ctx).length, `plan=${String(plan)}`).toBeGreaterThan(5);
    }
  });

  it("still withholds FSM data sets from a legacy plan", () => {
    // planLines() grants crm/wfa/sfa to legacy plans but NOT fsm.
    expect(visibleDataSets(legacy, STUBS).map((s) => s.name)).not.toContain("fsm_thing");
  });

  it("still hides sensitive data sets from a legacy plan", () => {
    expect(visibleDataSets(legacy, STUBS).map((s) => s.name)).not.toContain("secret_thing");
  });
});

describe("assertDataSetAllowed", () => {
  it("returns the descriptor when allowed", () => {
    expect(assertDataSetAllowed("orders", crmOnly).name).toBe("orders");
  });

  // Hiding something from the menu is NOT security: the AI can guess a name.
  it("refuses a sensitive data set called by name when the switch is off", () => {
    expect(() => assertDataSetAllowed("secret_thing", sfa, STUBS)).toThrow(/not enabled/i);
  });

  it("allows a sensitive data set by name once the switch is on", () => {
    expect(assertDataSetAllowed("secret_thing", sfaWithWorkforce, STUBS).name).toBe(
      "secret_thing",
    );
  });

  it("refuses an out-of-plan data set called by name, with an upgrade hint", () => {
    expect(() => assertDataSetAllowed("visits", crmOnly)).toThrow(/plan/i);
    expect(() => assertDataSetAllowed("sfa_thing", crmOnly, STUBS)).toThrow(/SFA plan/);
  });

  it("refuses a data set whose module is switched off", () => {
    const off: TenantContext = { ...sfa, moduleSettings: { quotation: false } };
    expect(() => assertDataSetAllowed("quotations", off)).toThrow(/switched off/i);
  });

  it("refuses an unknown data set", () => {
    expect(() => assertDataSetAllowed("salaries", sfa)).toThrow(/unknown/i);
  });

  it("points the AI at list_data when it guesses a name", () => {
    expect(() => assertDataSetAllowed("salaries", sfa)).toThrow(/list_data/);
  });

  it("refuses every data set the menu hides, for every plan", () => {
    // The invariant that matters: visibleDataSets and assertDataSetAllowed
    // can never disagree, or the menu becomes the only thing enforcing
    // access and guessing a name defeats it.
    const plans: TenantContext[] = [crmOnly, sfa, sfaWithWorkforce, wfaOnly];
    for (const ctx of plans) {
      const visible = new Set(visibleDataSets(ctx, STUBS).map((s) => s.name));
      for (const s of STUBS) {
        if (visible.has(s.name)) {
          expect(assertDataSetAllowed(s.name, ctx, STUBS).name).toBe(s.name);
        } else {
          expect(() => assertDataSetAllowed(s.name, ctx, STUBS)).toThrow();
        }
      }
    }
  });
});
