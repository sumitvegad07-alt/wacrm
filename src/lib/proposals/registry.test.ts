import { describe, expect, test } from "vitest";
import { getByPath, getTemplate, listTemplates, setByPath } from "./registry";
import { computeTotals } from "./totals";

describe("getTemplate", () => {
  test("returns a template for every sellable plan", () => {
    for (const plan of ["CRM", "WFA", "CRM_WFA", "SFA", "CRM_SFA"]) {
      expect(getTemplate(plan)?.plan, plan).toBe(plan);
    }
  });

  test("returns undefined for an unknown plan rather than throwing", () => {
    expect(getTemplate("NOPE")).toBeUndefined();
  });

  test("labels a plan the way the rest of the app does", () => {
    expect(getTemplate("CRM_SFA")?.label).toBe("CRM + SFA");
  });
});

describe("listTemplates", () => {
  test("lists the five plans in catalog order", () => {
    expect(listTemplates().map((t) => t.plan)).toEqual([
      "CRM",
      "WFA",
      "CRM_WFA",
      "SFA",
      "CRM_SFA",
    ]);
  });
});

describe("SFA defaults", () => {
  const sfa = getTemplate("SFA")!;
  const data = sfa.defaults("2026-09-22");

  test("uses the date it is given", () => {
    expect(data.proposalDate).toBe("2026-09-22");
  });

  test("opens at the catalog list price, not a remembered discount", () => {
    // Catalog: SFA is 350/user/month. A discount like the 3,600 quoted to the
    // first client must be a deliberate edit, not a silent default.
    expect(sfa.listRatePerYear).toBe(4200);
    expect(data.lineItems).toHaveLength(2);
    expect(data.lineItems[0]).toMatchObject({ users: 5, rate: 4200 });
    expect(data.lineItems[1]).toMatchObject({ users: 1, rate: 4200 });
  });

  test("totals follow from the catalog price", () => {
    const t = computeTotals(data.lineItems, {
      gstEnabled: data.gstEnabled,
      gstRate: data.gstRate,
    });

    expect(t.subtotal).toBe(25200);
    expect(t.perUserPerMonth).toBe(350);
  });

  test("defaults to no GST, matching the reference proposal", () => {
    expect(data.gstEnabled).toBe(false);
    expect(data.gstRate).toBe(18);
  });

  test("defaults the signatory to the founder so it is normally left alone", () => {
    expect(data.preparedBy).toMatchObject({
      name: "Sumit",
      phone: "+91 92271 26301",
      email: "sales@ozzo.co.in",
    });
  });

  test("ships the industry wording as an editable starting point", () => {
    expect(data.voice.industryPlural).toBe("spices businesses");
    expect(data.voice.built).toContain("spices");
    expect(data.voice.builtFor).toContain("FMCG");
  });

  test("leaves the client blank — it is what the founder fills in", () => {
    expect(data.client.name).toBe("");
    expect(data.client.shortName).toBe("");
  });
});

describe("every plan's defaults", () => {
  for (const plan of ["CRM", "WFA", "CRM_WFA", "SFA", "CRM_SFA"]) {
    const template = getTemplate(plan)!;
    const data = template.defaults("2026-09-22");

    test(`${plan}: every field the form renders has a value`, () => {
      const paths = template.groups.flatMap((g) => g.fields.map((f) => f.path));

      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(getByPath(data, path), `no default for "${path}"`).toBeDefined();
      }
    });

    test(`${plan}: declares no field for values that are computed`, () => {
      const paths = template.groups.flatMap((g) => g.fields.map((f) => f.path));
      expect(paths).not.toContain("lineItems");
      expect(paths).not.toContain("gstEnabled");
    });

    test(`${plan}: writes its own industry wording, not another plan's`, () => {
      expect(data.voice.built).toBeTruthy();
      expect(data.voice.industryPlural).toBeTruthy();
      expect(data.voice.builtFor).toBeTruthy();
    });
  }
});

describe("getByPath / setByPath", () => {
  const data = { client: { name: "Anode", address: "" }, validDays: 10 };

  test("reads a nested value", () => {
    expect(getByPath(data, "client.name")).toBe("Anode");
  });

  test("reads a top-level value", () => {
    expect(getByPath(data, "validDays")).toBe(10);
  });

  test("returns undefined for a path that does not exist", () => {
    expect(getByPath(data, "client.gstin")).toBeUndefined();
    expect(getByPath(data, "nothing.here")).toBeUndefined();
  });

  test("writes a nested value without mutating the original", () => {
    const next = setByPath(data, "client.name", "Gupta Traders");

    expect(getByPath(next, "client.name")).toBe("Gupta Traders");
    expect(data.client.name).toBe("Anode");
  });

  test("leaves sibling values intact when writing", () => {
    const next = setByPath(data, "client.name", "Gupta Traders");

    expect(getByPath(next, "validDays")).toBe(10);
    expect(getByPath(next, "client.address")).toBe("");
  });
});
