// ============================================================
// The allowlist IS the security boundary for /api/table/column-values.
// Nothing a caller sends ever reaches SQL — only the table and column names
// found in this map. These tests exist so that stays true.
// ============================================================
import { describe, expect, it } from "vitest";
import { ALLOWED_MODULES, resolveAllowed } from "./allowlist";

describe("column-values allowlist", () => {
  it("resolves a known module and column to a real table", () => {
    expect(resolveAllowed("lead", "city")).toEqual({ table: "leads", column: "city" });
    expect(resolveAllowed("contact", "area")).toEqual({ table: "contacts", column: "area" });
  });

  it("refuses a column that is not listed for that module", () => {
    expect(resolveAllowed("lead", "password")).toBeNull();
    expect(resolveAllowed("lead", "account_id")).toBeNull();
    expect(resolveAllowed("lead", "id")).toBeNull();
  });

  it("refuses an unknown module", () => {
    expect(resolveAllowed("secrets", "city")).toBeNull();
    expect(resolveAllowed("", "city")).toBeNull();
  });

  it("refuses anything shaped like injection", () => {
    expect(resolveAllowed("lead", "city; drop table leads")).toBeNull();
    expect(resolveAllowed("lead", "*")).toBeNull();
    expect(resolveAllowed("lead", "city,phone")).toBeNull();
    expect(resolveAllowed("lead", "City")).toBeNull(); // exact match only
  });

  it("refuses prototype keys rather than resolving them off Object.prototype", () => {
    expect(resolveAllowed("constructor", "city")).toBeNull();
    expect(resolveAllowed("__proto__", "city")).toBeNull();
    expect(resolveAllowed("toString", "city")).toBeNull();
  });

  it("never lists a column that identifies a person or a tenant", () => {
    // A distinct scan returns raw values to the browser. Keep it to the
    // descriptive columns people actually filter by.
    const banned = ["id", "account_id", "user_id", "owner_id", "password", "email", "phone"];
    for (const [module, entry] of Object.entries(ALLOWED_MODULES)) {
      for (const column of entry.columns) {
        expect(banned, `${module}.${column} must not be listed`).not.toContain(column);
      }
    }
  });
});
