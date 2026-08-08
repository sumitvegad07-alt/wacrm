import { describe, it, expect } from "vitest";
import {
  APP_NAME,
  getOemGuide,
  resolveSteps,
  formatOemGuide,
} from "./oem-battery-guides";

describe("APP_NAME", () => {
  it("is the product name users see, so instructions are followable", () => {
    expect(APP_NAME).toBe("OZZO");
  });
});

describe("getOemGuide", () => {
  it("matches the major Android brands our reps actually carry", () => {
    const cases: [string, string][] = [
      ["samsung", "Samsung (One UI)"],
      ["Xiaomi", "Xiaomi / Redmi / POCO (MIUI / HyperOS)"],
      ["Redmi", "Xiaomi / Redmi / POCO (MIUI / HyperOS)"],
      ["POCO", "Xiaomi / Redmi / POCO (MIUI / HyperOS)"],
      ["OPPO", "Oppo (ColorOS)"],
      ["realme", "Realme (realme UI)"],
      ["vivo", "Vivo / iQOO (Funtouch OS / OriginOS)"],
      ["iQOO", "Vivo / iQOO (Funtouch OS / OriginOS)"],
      ["OnePlus", "OnePlus (OxygenOS)"],
      ["HUAWEI", "Huawei (EMUI)"],
      ["HONOR", "Honor (MagicOS)"],
      ["TECNO", "Tecno / Infinix / itel (HiOS / XOS)"],
      ["Infinix", "Tecno / Infinix / itel (HiOS / XOS)"],
      ["itel", "Tecno / Infinix / itel (HiOS / XOS)"],
      ["asus", "Asus (ZenUI)"],
      ["Sony", "Sony (Xperia)"],
      ["motorola", "Motorola / Lenovo"],
      ["Nothing", "Nothing (Nothing OS)"],
      ["Google", "Google Pixel"],
      ["Nokia", "Nokia / HMD"],
      ["Lava", "Lava / Micromax / Karbonn"],
    ];
    for (const [make, brand] of cases) {
      expect(getOemGuide(make).brand, `manufacturer "${make}"`).toBe(brand);
    }
  });

  it("falls back to generic Android for unknown, empty or missing manufacturers", () => {
    expect(getOemGuide("SomeNewBrand").brand).toBe("Android");
    expect(getOemGuide("").brand).toBe("Android");
    expect(getOemGuide(null).brand).toBe("Android");
    expect(getOemGuide(undefined).brand).toBe("Android");
  });

  it("every guide has actionable steps", () => {
    for (const make of ["samsung", "xiaomi", "oppo", "vivo", "unknown"]) {
      const g = getOemGuide(make);
      expect(g.steps.length).toBeGreaterThan(0);
      for (const s of g.steps) expect(s.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("resolveSteps", () => {
  it("substitutes the product name everywhere, leaving no placeholder behind", () => {
    for (const make of ["samsung", "xiaomi", "oppo", "realme", "vivo", "oneplus", "tecno", "unknown"]) {
      const steps = resolveSteps(getOemGuide(make));
      expect(steps.join(" ")).not.toContain("{app}");
      expect(steps.join(" ")).not.toMatch(/WACRM/i);
      expect(steps.some((s) => s.includes("OZZO"))).toBe(true);
    }
  });

  it("honours a custom app name", () => {
    const steps = resolveSteps(getOemGuide("samsung"), "TestApp");
    expect(steps.some((s) => s.includes("TestApp"))).toBe(true);
    expect(steps.join(" ")).not.toContain("OZZO");
  });
});

describe("agent-facing copy branding", () => {
  it("never says WACRM anywhere in the issue catalog or its resolved fixes", async () => {
    const { ISSUE_CATALOG, resolveIssueFix } = await import("./tracking-issues");
    for (const [code, meta] of Object.entries(ISSUE_CATALOG)) {
      const blob = `${meta.title} ${meta.cause} ${meta.fix}`;
      expect(blob, `issue "${code}"`).not.toMatch(/WACRM/i);
      // and the per-device resolved fix too
      const resolved = resolveIssueFix(code as never, { manufacturer: "samsung" });
      expect(resolved, `resolved fix for "${code}"`).not.toMatch(/WACRM/i);
    }
  });
});

describe("formatOemGuide", () => {
  it("renders numbered steps under the brand heading", () => {
    const text = formatOemGuide("samsung");
    expect(text.startsWith("Samsung (One UI):")).toBe(true);
    expect(text).toContain("1. ");
    expect(text).toContain("OZZO");
    expect(text).not.toContain("{app}");
  });
});
