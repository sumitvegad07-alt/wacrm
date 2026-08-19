import { describe, it, expect } from "vitest";
import {
  planLines,
  planHasLine,
  allowedModules,
  defaultModuleSettings,
  clampModuleSettings,
  isNewPlan,
  MODULE_KEYS,
} from "./catalog";

describe("plan catalog — line mapping", () => {
  it("CRM grants only the CRM line", () => {
    expect(planLines("CRM")).toEqual({ crm: true, wfa: false, sfa: false });
  });
  it("WFA grants only the Workforce line", () => {
    expect(planLines("WFA")).toEqual({ crm: false, wfa: true, sfa: false });
  });
  it("SFA includes Workforce but not CRM", () => {
    expect(planLines("SFA")).toEqual({ crm: false, wfa: true, sfa: true });
  });
  it("CRM+SFA grants everything", () => {
    expect(planLines("CRM_SFA")).toEqual({ crm: true, wfa: true, sfa: true });
    expect(planHasLine("CRM_SFA", "sfa")).toBe(true);
  });
});

describe("plan catalog — legacy safety", () => {
  it("treats legacy Free/Enterprise as full access so nobody is locked out pre-migration", () => {
    expect(planLines("Free")).toEqual({ crm: true, wfa: true, sfa: true });
    expect(planLines("Enterprise")).toEqual({ crm: true, wfa: true, sfa: true });
  });
  it("treats unknown/null as full access", () => {
    expect(planLines(null)).toEqual({ crm: true, wfa: true, sfa: true });
    expect(planLines("whatever")).toEqual({ crm: true, wfa: true, sfa: true });
  });
  it("only the five new ids + Trial are 'new' plans", () => {
    expect(isNewPlan("CRM")).toBe(true);
    expect(isNewPlan("Free")).toBe(false);
    expect(isNewPlan("Enterprise")).toBe(false);
  });
});

describe("plan catalog — allowed modules", () => {
  it("CRM allows only whatsapp + quotation", () => {
    expect([...allowedModules("CRM")].sort()).toEqual(["quotation", "whatsapp"]);
  });
  it("WFA allows the workforce modules only", () => {
    expect([...allowedModules("WFA")].sort()).toEqual([
      "expense",
      "reporting_hierarchy",
      "route",
      "territory",
    ]);
  });
  it("SFA allows workforce + sfa modules (no CRM modules)", () => {
    const a = allowedModules("SFA");
    expect(a.has("payment")).toBe(true);
    expect(a.has("dispatch")).toBe(true);
    expect(a.has("expense")).toBe(true); // WFA included
    expect(a.has("whatsapp")).toBe(false); // CRM excluded
    expect(a.has("quotation")).toBe(false);
  });
});

describe("plan catalog — default module settings on apply", () => {
  it("CRM defaults whatsapp+quotation on, everything else off", () => {
    expect(defaultModuleSettings("CRM")).toEqual({
      whatsapp: true,
      quotation: true,
      expense: false,
      dispatch: false,
      pending_dispatch: false,
      territory: false,
      reporting_hierarchy: false,
      route: false,
      payment: false,
    });
  });
  it("optional/Available-Soon modules default OFF even when their line is on", () => {
    const wfa = defaultModuleSettings("WFA");
    expect(wfa.expense).toBe(true);
    expect(wfa.territory).toBe(true);
    expect(wfa.route).toBe(false); // Beat Planning optional
    expect(wfa.reporting_hierarchy).toBe(false); // User Hierarchy: Available Soon
  });
  it("CRM+SFA defaults every module on except the two default-off", () => {
    const all = defaultModuleSettings("CRM_SFA");
    for (const k of MODULE_KEYS) {
      const expected = k !== "route" && k !== "reporting_hierarchy";
      expect(all[k]).toBe(expected);
    }
  });
});

describe("plan catalog — hard-lock clamp", () => {
  it("forces off-plan modules false no matter what is requested", () => {
    // A CRM tenant tries to switch on payment (an SFA module).
    const clamped = clampModuleSettings("CRM", {
      whatsapp: true,
      quotation: false,
      payment: true, // off-plan → must be forced false
      dispatch: true, // off-plan → forced false
    });
    expect(clamped.whatsapp).toBe(true); // allowed, kept
    expect(clamped.quotation).toBe(false); // allowed, honored off
    expect(clamped.payment).toBe(false); // clamped
    expect(clamped.dispatch).toBe(false); // clamped
  });
  it("legacy plans allow everything through the clamp", () => {
    const clamped = clampModuleSettings("Enterprise", { payment: true });
    expect(clamped.payment).toBe(true);
  });
});
