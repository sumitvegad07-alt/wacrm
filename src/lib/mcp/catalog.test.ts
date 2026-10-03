import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/lib/plans/catalog";
import { allDataSets, getDataSet } from "./catalog";
import { MCP_PERIODS } from "./periods";

describe("catalog integrity", () => {
  const sets = allDataSets();

  it("exposes the 11 report modules plus DSR", () => {
    const report = sets.filter((s) => s.route === "report").map((s) => s.reportModule);
    expect(report.sort()).toEqual(
      ["ageing","deal","dsr","expense","lead","order","payment","quotation","sales","task","visit"].sort()
    );
  });

  it.each(sets.map((s) => [s.name, s] as const))(
    "%s is fully described",
    (_name, s) => {
      expect(s.title.length).toBeGreaterThan(0);
      // Business notes are what stop the AI inventing its own definitions.
      expect(s.notes.length).toBeGreaterThan(40);
      // Examples are what stop it fumbling its first two calls.
      expect(s.examples.length).toBeGreaterThanOrEqual(2);
      // The allow-list is the security boundary. An empty one means a bug,
      // not an open door.
      expect(s.fields.length).toBeGreaterThan(0);
      expect(["crm", "wfa", "sfa", "fsm"]).toContain(s.line);
    }
  );

  it.each(sets.filter((s) => s.route === "reader").map((s) => [s.name, s] as const))(
    "reader data set %s names a base table",
    (_name, s) => {
      expect(s.table).toBeTruthy();
    }
  );

  it.each(sets.filter((s) => s.route === "report").map((s) => [s.name, s] as const))(
    "report data set %s names a report module",
    (_name, s) => {
      expect(s.reportModule).toBeTruthy();
    }
  );

  it("has no duplicate names", () => {
    const names = sets.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only references periods that exist", () => {
    for (const s of sets) {
      for (const f of s.filters) {
        if (f.key === "period") {
          for (const o of f.options ?? []) expect(MCP_PERIODS).toContain(o);
        }
      }
    }
  });

  it.each(sets.map((s) => [s.name, s] as const))(
    "%s declares no duplicate field or filter keys",
    (_name, s) => {
      const fieldKeys = s.fields.map((f) => f.key);
      expect(new Set(fieldKeys).size).toBe(fieldKeys.length);
      const filterKeys = s.filters.map((f) => f.key);
      expect(new Set(filterKeys).size).toBe(filterKeys.length);
    }
  );

  // Spec decision 10: the AI never sends raw dates. Every report config
  // carries its own `date_range` filter that takes start_date/end_date, so
  // deriving filters naively would offer the AI a raw-date door right next
  // to the named-period one. There must be exactly one way to ask for time.
  it.each(sets.map((s) => [s.name, s] as const))(
    "%s offers named periods only, never a raw date_range filter",
    (_name, s) => {
      expect(s.filters.map((f) => f.key)).not.toContain("date_range");
      const dateRangeFilters = s.filters.filter((f) => f.type === "date_range");
      expect(dateRangeFilters.map((f) => f.key)).toEqual(
        dateRangeFilters.length ? ["period"] : []
      );
    }
  );

  it("gives every report data set a period filter listing all presets", () => {
    for (const s of sets.filter((x) => x.route === "report")) {
      const period = s.filters.find((f) => f.key === "period");
      expect(period, `${s.name} has no period filter`).toBeTruthy();
      expect(period!.options).toEqual([...MCP_PERIODS]);
    }
  });

  it("looks up by name", () => {
    expect(getDataSet("visits")?.route).toBe("report");
    expect(getDataSet("nope")).toBeUndefined();
  });
});

describe("report-config derivation", () => {
  it("derives fields from the live report config rather than a copy", () => {
    // visits must carry the visit report's own measures. If someone renames a
    // measure in visitReportConfig, this data set follows automatically — that
    // is the whole point of deriving Route A.
    const s = getDataSet("visits")!;
    expect(s.measures.map((m) => m.key)).toContain("visit_count");
    expect(s.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining([...s.dimensions, ...s.measures].map((f) => f.key))
    );
  });

  it("translates the report config's module key to a real one", () => {
    // ReportDefinition.requiredModule is consumed nowhere in the app, so its
    // values were never checked against accounts.module_settings. Most are
    // not real keys: there is no "orders" or "quotations" toggle.
    expect(getDataSet("quotations")!.requiredModule).toBe("quotation");
    expect(getDataSet("payments")!.requiredModule).toBe("payment");
    expect(getDataSet("expenses")!.requiredModule).toBe("expense");
  });

  it("gives core modules no toggle rather than an unmatchable one", () => {
    // orderReportConfig says requiredModule: 'orders', which does not exist.
    // Keeping it would make the gate a no-op that looks like it works.
    expect(getDataSet("orders")!.requiredModule).toBeUndefined();
    expect(getDataSet("sales")!.requiredModule).toBeUndefined();
    expect(getDataSet("outstanding")!.requiredModule).toBeUndefined();
    expect(getDataSet("leads")!.requiredModule).toBeUndefined();
    expect(getDataSet("deals")!.requiredModule).toBeUndefined();
  });

  // The guard against this whole class of bug returning.
  it("only ever names a module toggle that really exists", () => {
    for (const s of allDataSets()) {
      if (!s.requiredModule) continue;
      expect(
        MODULE_KEYS as readonly string[],
        `${s.name} requires module "${s.requiredModule}", which is not a real ` +
          `accounts.module_settings key — map it in REPORT_MODULE_TOGGLE`
      ).toContain(s.requiredModule);
    }
  });

  it("types currency measures as currency so the AI formats them as money", () => {
    const orders = getDataSet("orders")!;
    const net = orders.measures.find((m) => m.key === "net_amount");
    expect(net?.type).toBe("currency");
  });
});


describe("day dimension", () => {
  // The report engine silently IGNORES an unsupported `day` dimension and
  // returns one ungrouped total, so offering it where it does not work would
  // have an AI present an all-time figure as a single day's.
  it.each(["visits", "orders", "sales"])("%s can be grouped by day", (name) => {
    expect(getDataSet(name)!.dimensions.map((d) => d.key)).toContain("day");
  });

  it.each(["payments", "quotations", "outstanding", "leads", "deals", "expenses", "tasks", "daily_summary"])(
    "%s does not offer day, because the engine ignores it there",
    (name) => {
      expect(getDataSet(name)!.dimensions.map((d) => d.key)).not.toContain("day");
    },
  );

  it("tells the AI that the `date` dimension is monthly", () => {
    expect(getDataSet("visits")!.notes).toMatch(/buckets by MONTH/);
  });
});

describe("reader descriptors", () => {
  it("customers can be searched by name, and points elsewhere for money owed", () => {
    const s = getDataSet("customers")!;
    expect(s.table).toBe("contacts");
    expect(s.filters.map((f) => f.key)).toContain("search");
    expect(s.fields.map((f) => f.key)).toContain("name");
    // contacts has no outstanding balance column — it is derived. The notes
    // must send the AI to the `outstanding` data set instead of letting it
    // invent a field or report zero.
    expect(s.fields.map((f) => f.key)).not.toContain("outstanding_amount");
    expect(s.notes).toMatch(/outstanding/i);
  });

  it("warns about the customer-owner id-space trap", () => {
    const s = getDataSet("customers")!;
    // employee_id -> profiles(id); user_id -> auth.users(id). Confusing them
    // silently returns the wrong rep's customers.
    expect(s.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining(["employee_id", "territory_id", "user_id"])
    );
    expect(s.notes).toMatch(/auth-user id space/i);
  });

  // Found in production 2026-10-04: the reports display the COMPANY name
  // ("Brahmani casting") while this data set returned only the contact person
  // ("Laxmi mittal") and could not be searched by company at all. The AI saw
  // one record under two names and could not match them.
  it("exposes both the company and the contact person", () => {
    const s = getDataSet("customers")!;
    const keys = s.fields.map((f) => f.key);
    expect(keys).toContain("company");
    expect(keys).toContain("name");
    expect(s.fields.find((f) => f.key === "company")!.label).toBe("Company Name");
    expect(s.fields.find((f) => f.key === "name")!.label).toBe("Contact Person");
  });

  it("finds a customer by its company name, which is what reports show", () => {
    expect(getDataSet("customers")!.searchFields).toContain("company");
  });

  it("warns the AI that a customer has two different names", () => {
    const notes = getDataSet("customers")!.notes;
    expect(notes).toMatch(/two names/i);
    expect(notes).toMatch(/contact person/i);
  });

  it("employees exposes the roster but never a credential-ish column", () => {
    const s = getDataSet("employees")!;
    expect(s.table).toBe("profiles");
    expect(s.fields.map((f) => f.key)).toContain("full_name");
    const keys = s.fields.map((f) => f.key);
    for (const banned of ["plain_password", "password", "is_superadmin"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("warns that the employee id is profiles.id, not the auth user id", () => {
    expect(getDataSet("employees")!.notes).toMatch(/not the same as the auth user id/i);
  });

  it("products is gated on the catalogue line and uses its own activity flag", () => {
    const s = getDataSet("products")!;
    expect(s.table).toBe("products");
    expect(s.line).toBe("crm");
    // products.active, not products.is_active — the two masters disagree.
    expect(s.fields.map((f) => f.key)).toContain("active");
    expect(s.fields.map((f) => f.key)).not.toContain("is_active");
  });

  it("gives every reader data set a search or id filter, so names resolve", () => {
    for (const s of allDataSets().filter((x) => x.route === "reader")) {
      const keys = s.filters.map((f) => f.key);
      expect(
        keys.includes("search") || keys.includes("id"),
        `${s.name} offers no way to look up one record`
      ).toBe(true);
    }
  });
});

// Phase 2 to-do list, visible in the test output rather than failing the
// suite (the founder rule is that tests pass before every commit). These are
// un-skipped as the descriptors land — Task 17 for the sensitive three,
// Task 18 for routes, Task 19 for stock and schemes.
describe("Phase 2 coverage", () => {
  it.todo("marks exactly the three workforce data sets as sensitive");
  it.todo("exposes routes, route_runs, route_stops, territories and leave");
  it.todo("exposes stock and schemes");
});
