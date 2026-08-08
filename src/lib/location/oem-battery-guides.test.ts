import { describe, it, expect } from "vitest";
import {
  APP_NAME,
  getOemGuide,
  resolveGuide,
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
});

describe("required vs optional split", () => {
  it("keeps the required list short so a rep knows what actually matters", () => {
    for (const make of ["samsung", "xiaomi", "oppo", "vivo", "oneplus", "pixel", "unknown"]) {
      const g = getOemGuide(make);
      expect(g.required.length, `${make} required`).toBeGreaterThanOrEqual(1);
      expect(g.required.length, `${make} required`).toBeLessThanOrEqual(2);
    }
  });

  it("needs only ONE step on near-stock Android", () => {
    for (const make of ["pixel", "motorola", "nothing", "nokia", "unknown"]) {
      expect(getOemGuide(make).required, `${make}`).toHaveLength(1);
    }
  });

  it("needs the autostart/never-sleeping step too on aggressive OEMs", () => {
    // On these skins the single 'Unrestricted' toggle genuinely does not hold.
    for (const make of ["samsung", "xiaomi", "oppo", "realme", "vivo", "tecno"]) {
      expect(getOemGuide(make).required.length, `${make}`).toBe(2);
    }
  });

  it("every guide has actionable, non-empty steps", () => {
    for (const make of ["samsung", "xiaomi", "oppo", "vivo", "unknown"]) {
      const g = getOemGuide(make);
      for (const s of [...g.required, ...g.ifStillStopping]) {
        expect(s.trim().length).toBeGreaterThan(10);
      }
    }
  });
});

describe("resolveGuide", () => {
  it("substitutes the product name everywhere, leaving no placeholder behind", () => {
    for (const make of ["samsung", "xiaomi", "oppo", "realme", "vivo", "oneplus", "tecno", "unknown"]) {
      const g = resolveGuide(make);
      const blob = [...g.required, ...g.ifStillStopping].join(" ");
      expect(blob).not.toContain("{app}");
      expect(blob).not.toMatch(/WACRM/i);
      expect(blob).toContain("OZZO");
    }
  });

  it("honours a custom app name", () => {
    const g = resolveGuide("samsung", "TestApp");
    expect(g.required.join(" ")).toContain("TestApp");
    expect(g.required.join(" ")).not.toContain("OZZO");
  });
});

describe("formatOemGuide", () => {
  it("separates what must be done from what's only needed if it persists", () => {
    const text = formatOemGuide("samsung");
    expect(text).toContain("Samsung (One UI)");
    expect(text).toContain("Do this:");
    expect(text).toContain("Only if it still stops:");
    expect(text).toContain("1. ");
    expect(text).toContain("OZZO");
    expect(text).not.toContain("{app}");
  });
});

describe("agent-facing copy branding", () => {
  it("never says WACRM anywhere in the issue catalog or its resolved fixes", async () => {
    const { ISSUE_CATALOG, resolveIssueFix } = await import("./tracking-issues");
    for (const [code, meta] of Object.entries(ISSUE_CATALOG)) {
      const blob = `${meta.title} ${meta.cause} ${meta.fix}`;
      expect(blob, `issue "${code}"`).not.toMatch(/WACRM/i);
      const resolved = resolveIssueFix(code as never, { manufacturer: "samsung" });
      expect(resolved, `resolved fix for "${code}"`).not.toMatch(/WACRM/i);
    }
  });
});
