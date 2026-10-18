// Regression tests for the plan leaks these gates were written to close.
//
// Every case below names a screen that a plan could reach before this table
// existed, either because the direct-URL guard in dashboard-shell had no rule
// for it or because the screen had no gating anywhere (the import wizards, the
// custom-field editors, the settings tabs).

import { describe, expect, it } from "vitest";
import {
  CATALOG_LINES,
  CUSTOM_FIELD_GATES,
  IMPORT_GATES,
  gateForPath,
  gatePasses,
  isRouteRestricted,
  type GateContext,
} from "./surface-gates";
import { MODULE_KEYS, PLAN_IDS, planLines, defaultModuleSettings } from "./catalog";

/** A context for a real plan id, with that plan's default module settings. */
function ctxFor(plan: string): GateContext {
  const modules = defaultModuleSettings(plan);
  return {
    owns: planLines(plan),
    isModuleEnabled: (key) => modules[key] === true,
  };
}

/** Same, but with named modules forced on (what a tenant admin may switch on). */
function ctxWith(plan: string, on: string[]): GateContext {
  const base = ctxFor(plan);
  return {
    owns: base.owns,
    isModuleEnabled: (key) => on.includes(key) || base.isModuleEnabled(key),
  };
}

const blocked = (plan: string, path: string) => isRouteRestricted(path, ctxFor(plan));
const open = (plan: string, path: string, on: string[] = []) =>
  !isRouteRestricted(path, ctxWith(plan, on));

describe("route gates — the paths the old guard had no rule for", () => {
  it("blocks the WhatsApp inbox and Flows on a plan with no CRM line", () => {
    for (const path of ["/inbox", "/flows", "/whatsapp/dashboard", "/broadcasts"]) {
      expect(blocked("SFA", path)).toBe(true);
      expect(blocked("WFA", path)).toBe(true);
    }
    expect(open("CRM", "/inbox")).toBe(true);
    expect(open("CRM_SFA", "/flows")).toBe(true);
  });

  it("blocks Price Lists and Stock off the SFA line", () => {
    expect(blocked("CRM", "/price-lists")).toBe(true);
    expect(blocked("WFA", "/price-lists")).toBe(true);
    expect(blocked("CRM_WFA", "/stock")).toBe(true);
    expect(open("SFA", "/price-lists")).toBe(true);
    // Stock also rides an opt-in toggle, so it stays shut until it is switched on.
    expect(blocked("SFA", "/stock")).toBe(true);
    expect(open("SFA", "/stock", ["stock"])).toBe(true);
  });

  it("blocks the four reports the guard used to miss", () => {
    expect(blocked("WFA", "/reports/quotations")).toBe(true);
    expect(blocked("CRM", "/reports/payments")).toBe(true);
    expect(blocked("CRM", "/reports/expenses")).toBe(true);
    expect(blocked("CRM", "/reports/stock")).toBe(true);
    // ...and still serves each one to the plan that bought it.
    expect(open("CRM", "/reports/quotations", ["quotation"])).toBe(true);
    expect(open("SFA", "/reports/payments", ["payment"])).toBe(true);
    expect(open("WFA", "/reports/expenses", ["expense"])).toBe(true);
    expect(open("SFA", "/reports/stock", ["stock"])).toBe(true);
  });

  it("holds Pending Dispatch to its module toggle, not just the SFA line", () => {
    expect(blocked("CRM", "/pending-dispatch")).toBe(true);
    expect(open("SFA", "/pending-dispatch")).toBe(true);
    const off: GateContext = { owns: planLines("SFA"), isModuleEnabled: () => false };
    expect(isRouteRestricted("/pending-dispatch", off)).toBe(true);
  });

  it("keeps the catalogue on CRM and SFA but not on a WFA-only plan", () => {
    for (const path of ["/products", "/catalog/categories", "/catalog/units"]) {
      expect(blocked("WFA", path)).toBe(true);
      expect(open("CRM", path)).toBe(true);
      expect(open("SFA", path)).toBe(true);
      expect(open("CRM_WFA", path)).toBe(true);
    }
  });

  it("keeps Attendance and Leaves open on every plan, including CRM-only", () => {
    // They live under /location-tracking but are sold in every column.
    expect(open("CRM", "/location-tracking/attendance")).toBe(true);
    expect(open("CRM", "/location-tracking/leaves")).toBe(true);
    // The rest of that section is WFA.
    expect(blocked("CRM", "/location-tracking/overview")).toBe(true);
    expect(blocked("CRM", "/location-tracking/visits")).toBe(true);
  });

  it("holds Route Monitor to the SFA route module, not the WFA line", () => {
    // Route Management moved to the SFA line on 2026-09-26; the monitor lists
    // its executions, so a WFA-only plan has nothing to monitor.
    expect(blocked("WFA", "/location-tracking/executions")).toBe(true);
    expect(blocked("SFA", "/location-tracking/executions")).toBe(true); // route ships off
    expect(open("SFA", "/location-tracking/executions", ["route"])).toBe(true);
  });

  it("blocks the Service module off the FSM line", () => {
    expect(blocked("CRM_SFA", "/service/assets")).toBe(true);
    expect(open("FSM", "/service/assets")).toBe(true);
    expect(open("SFA_FSM", "/service/assets")).toBe(true);
  });

  it("leaves base features ungated on every plan", () => {
    for (const plan of PLAN_IDS) {
      for (const path of ["/dashboard", "/contacts", "/follow-ups", "/reports/tasks", "/team/employees", "/announcements"]) {
        expect(open(plan, path)).toBe(true);
      }
    }
  });

  it("matches on a path segment, never a bare prefix", () => {
    // '/products' must not swallow a hypothetical '/products-import'.
    expect(gateForPath("/products")).toEqual({ anyLine: CATALOG_LINES });
    expect(gateForPath("/products/abc")).toEqual({ anyLine: CATALOG_LINES });
    expect(gateForPath("/productsomething")).toBeUndefined();
  });

  it("prefers the most specific rule", () => {
    // /location-tracking is WFA, but its attendance page is base.
    expect(gateForPath("/location-tracking")).toEqual({ line: "wfa" });
    expect(gateForPath("/location-tracking/attendance")).toEqual({});
  });
});

describe("import gates", () => {
  it("keeps the SFA and WFA imports off a CRM-only plan", () => {
    const crm = ctxFor("CRM");
    for (const key of ["orders", "outstanding", "stock", "price_lists", "territories", "customer_assets"]) {
      expect(gatePasses(IMPORT_GATES[key], crm)).toBe(false);
    }
  });

  it("keeps the lead import off a plan with no CRM line", () => {
    expect(gatePasses(IMPORT_GATES.leads, ctxFor("SFA"))).toBe(false);
    expect(gatePasses(IMPORT_GATES.leads, ctxFor("WFA"))).toBe(false);
    expect(gatePasses(IMPORT_GATES.leads, ctxFor("CRM"))).toBe(true);
  });

  it("keeps Customers and Tasks importable on every plan", () => {
    for (const plan of PLAN_IDS) {
      expect(gatePasses(IMPORT_GATES.contacts, ctxFor(plan))).toBe(true);
      expect(gatePasses(IMPORT_GATES.tasks, ctxFor(plan))).toBe(true);
    }
  });

  it("gates every import on a module key the catalog knows", () => {
    for (const gate of Object.values(IMPORT_GATES)) {
      if (gate.configModule) expect(MODULE_KEYS).toContain(gate.configModule);
    }
  });
});

describe("custom-field gates", () => {
  it("hides the CRM field builders from a WFA-only plan", () => {
    const wfa = ctxFor("WFA");
    for (const key of ["quotation", "lead", "deal", "order", "dispatch", "product"]) {
      expect(gatePasses(CUSTOM_FIELD_GATES[key], wfa)).toBe(false);
    }
  });

  it("hides the WFA and SFA field builders from a CRM-only plan", () => {
    const crm = ctxFor("CRM");
    for (const key of ["order", "dispatch", "customer_visit", "expense"]) {
      expect(gatePasses(CUSTOM_FIELD_GATES[key], crm)).toBe(false);
    }
  });

  it("needs both lines for Lead Visits", () => {
    expect(gatePasses(CUSTOM_FIELD_GATES.lead_visit, ctxFor("CRM"))).toBe(false); // leads, no visits
    expect(gatePasses(CUSTOM_FIELD_GATES.lead_visit, ctxFor("WFA"))).toBe(false); // visits, no leads
    expect(gatePasses(CUSTOM_FIELD_GATES.lead_visit, ctxFor("CRM_WFA"))).toBe(true);
    expect(gatePasses(CUSTOM_FIELD_GATES.lead_visit, ctxFor("CRM_SFA"))).toBe(true);
  });

  it("keeps User, Customer and Task field builders on every plan", () => {
    for (const plan of PLAN_IDS) {
      for (const key of ["user", "contact", "task"]) {
        expect(gatePasses(CUSTOM_FIELD_GATES[key], ctxFor(plan))).toBe(true);
      }
    }
  });
});

describe("gatePasses", () => {
  const all: GateContext = {
    owns: { crm: true, wfa: true, sfa: true, fsm: true },
    isModuleEnabled: () => true,
  };

  it("passes an empty or missing gate", () => {
    expect(gatePasses(undefined, all)).toBe(true);
    expect(gatePasses({}, all)).toBe(true);
  });

  it("fails as soon as any one condition fails", () => {
    expect(gatePasses({ line: "crm" }, { ...all, owns: { ...all.owns, crm: false } })).toBe(false);
    expect(gatePasses({ anyLine: ["crm", "sfa"] }, { ...all, owns: { crm: false, wfa: true, sfa: false, fsm: false } })).toBe(false);
    expect(gatePasses({ allLines: ["crm", "wfa"] }, { ...all, owns: { crm: true, wfa: false, sfa: false, fsm: false } })).toBe(false);
    expect(gatePasses({ configModule: "payment" }, { ...all, isModuleEnabled: () => false })).toBe(false);
  });

  it("gives legacy plans everything except FSM, matching planLines", () => {
    // Enterprise / Pro / Basic predate the line model: nothing locks out, but
    // the FSM line was invented afterwards and must stay off.
    const legacy = ctxWith("Enterprise", [...MODULE_KEYS]);
    expect(isRouteRestricted("/orders", legacy)).toBe(false);
    expect(isRouteRestricted("/inbox", legacy)).toBe(false);
    expect(isRouteRestricted("/location-tracking/overview", legacy)).toBe(false);
    expect(isRouteRestricted("/service/assets", legacy)).toBe(true);
  });
});
