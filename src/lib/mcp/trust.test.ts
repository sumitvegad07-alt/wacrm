// ============================================================
// The connector and the dashboard must answer the same question with the
// same numbers. If these ever drift, customers lose faith in both surfaces
// at once, and the connector is the one they will not check.
//
// Date arithmetic is covered separately: periods.test.ts pins this module's
// period resolution against the dashboard's own date-fns calls. What is
// tested here is the WIRING — that fetch.ts asks execute_report the same
// question the dashboard asks: same module, same dimensions, same measures,
// same filter shape.
//
// Read-only, against a real account discovered at runtime.
// ============================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { runReport } from "@/lib/dashboard/report-rpc";
import { getReportByModule } from "@/lib/reports/registry";
import { allDataSets } from "./catalog";
import { fetchData } from "./fetch";
import { resolvePeriod } from "./periods";
import type { McpContext } from "./session";
import { testDbTarget } from "./test-db";

const target = testDbTarget();
const canRun = "target" in target;
if (!canRun) {
  console.warn(`[mcp] skipping dashboard-parity test: ${target.reason}`);
}

const IST = "Asia/Kolkata";

/**
 * The data-set-name -> report-module contract, written out independently of
 * the catalog.
 *
 * Taking the module from getDataSet() for BOTH sides of the comparison would
 * be circular: a data set wired to the wrong module would agree with itself
 * perfectly. Verified by pointing "sales" at the order report and watching
 * the original version of this test stay green.
 */
const EXPECTED_MODULE: Record<string, string> = {
  visits: "visit",
  orders: "order",
  sales: "sales",
  quotations: "quotation",
  payments: "payment",
  outstanding: "ageing",
  leads: "lead",
  deals: "deal",
  expenses: "expense",
  tasks: "task",
  daily_summary: "dsr",
};

/** Questions a real admin would ask, spread across the report modules. */
const CASES = [
  { dataset: "orders", period: "current_year", group_by: ["user"], measures: ["order_count", "net_amount"] },
  { dataset: "orders", period: "last_365_days", group_by: ["customer"], measures: ["net_amount"] },
  { dataset: "sales", period: "current_year", group_by: ["user"], measures: ["net_amount"] },
  { dataset: "payments", period: "current_year", group_by: ["user"], measures: ["amount"] },
  { dataset: "visits", period: "last_365_days", group_by: ["user"], measures: ["visit_count"] },
  { dataset: "leads", period: "current_year", group_by: ["status"], measures: ["lead_count"] },
] as const;

describe.skipIf(!canRun)("connector matches dashboard", () => {
  let db: SupabaseClient;
  let accountId: string;

  function ctx(): McpContext {
    return {
      connectionId: "test",
      accountId,
      profileId: "test",
      clientName: "vitest",
      accountName: "vitest",
      supabase: db,
      timezone: IST,
      tenant: { plan: "Enterprise", moduleSettings: {}, allowWorkforceData: true },
    } as McpContext;
  }

  beforeAll(async () => {
    const t = (target as { target: { url: string; key: string } }).target;
    db = createClient(t.url, t.key, { auth: { persistSession: false } });

    // The account with the most orders, so the comparisons run against real
    // numbers rather than two empty sets agreeing with each other.
    const { data, error } = await db.from("orders").select("account_id").limit(2000);
    if (error) throw new Error(`cannot read orders: ${error.message}`);
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { account_id: string }[]) {
      counts.set(row.account_id, (counts.get(row.account_id) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) throw new Error("no account has orders to compare");
    accountId = ranked[0][0];
  });

  it("picked an account that actually has data", async () => {
    const r = await fetchData(
      { dataset: "orders", period: "current_year", group_by: ["user"], measures: ["order_count"] },
      ctx(),
    );
    // Guards against the whole suite passing because everything is empty.
    expect(r.rows.length, "the chosen account returned no orders this year").toBeGreaterThan(0);
  });

  it.each(CASES.map((c) => [`${c.dataset} / ${c.period}`, c] as const))(
    "%s matches a direct report-engine call",
    async (_label, c) => {
      const p = resolvePeriod(c.period, IST);
      // From the contract above, NOT from the catalog under test.
      const reportModule = EXPECTED_MODULE[c.dataset];
      expect(reportModule, `no expected module for ${c.dataset}`).toBeTruthy();

      // Built the way the dashboard builds it, independently of fetch.ts.
      const dashboard = await runReport(
        db,
        accountId,
        reportModule,
        [...c.group_by],
        [...c.measures],
        { date_range: { start_date: p.start_date, end_date: p.end_date } },
        undefined,
        1000,
      );

      const viaMcp = await fetchData(
        {
          dataset: c.dataset,
          period: c.period,
          group_by: [...c.group_by],
          measures: [...c.measures],
        },
        ctx(),
      );

      expect(viaMcp.rows).toEqual(dashboard);
    },
  );

  it("wires every data set to the report module it is supposed to use", () => {
    // A data set pointing at the wrong module answers a different question
    // with total confidence, and every number it returns is internally
    // consistent — so only an external contract catches it.
    const reportSets = allDataSets().filter((x) => x.route === "report");
    expect(Object.keys(EXPECTED_MODULE).sort()).toEqual(reportSets.map((s) => s.name).sort());
    for (const s of reportSets) {
      expect(s.reportModule, `${s.name} is wired to the wrong report`).toBe(
        EXPECTED_MODULE[s.name],
      );
      const def = getReportByModule(s.reportModule!);
      expect(def, `${s.name} names unknown report module ${s.reportModule}`).toBeTruthy();
      expect(s.title).toBe(def!.label);
    }
  });

  it("returns exactly the columns that were asked for", async () => {
    const r = await fetchData(
      { dataset: "orders", period: "current_year", group_by: ["user"], measures: ["net_amount"] },
      ctx(),
    );
    for (const row of r.rows) {
      expect(Object.keys(row).sort()).toEqual(["net_amount", "user"]);
    }
  });

  it("gives the same answer twice", async () => {
    const q = {
      dataset: "orders",
      period: "current_year",
      group_by: ["user"],
      measures: ["net_amount"],
    };
    const a = await fetchData(q, ctx());
    const b = await fetchData(q, ctx());
    expect(a.rows).toEqual(b.rows);
  });

  // Regression, found in production on 2026-10-04: asking for one customer's
  // visits returned 0 against 5 real ones, because the report engine wants
  // `customer` nested as { contact_id } and a flat id matches nothing without
  // erroring. A unit test on the call shape is not enough — only real data
  // distinguishes "correctly zero" from "silently zero".
  it("counts a real customer's visits instead of silently returning zero", async () => {
    const { data } = await db
      .from("site_visits")
      .select("contact_id")
      .eq("account_id", accountId)
      .not("contact_id", "is", null)
      .limit(200);
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { contact_id: string }[]) {
      counts.set(row.contact_id, (counts.get(row.contact_id) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return; // account has no customer-linked visits
    const [contactId] = ranked[0];

    const r = await fetchData(
      {
        dataset: "visits",
        period: "last_365_days",
        filters: { customer: contactId },
        measures: ["visit_count"],
      },
      ctx(),
    );
    const total = r.rows.reduce((n, row) => n + Number(row.visit_count ?? 0), 0);
    expect(total, "a customer with visits reported zero").toBeGreaterThan(0);
  });

  it("does not report every customer's visits when one is asked for", async () => {
    // The other half of the same bug: a filter that is silently dropped
    // returns the whole account's total, which reads as plausible.
    const all = await fetchData(
      { dataset: "visits", period: "last_365_days", measures: ["visit_count"] },
      ctx(),
    );
    const { data } = await db
      .from("site_visits")
      .select("contact_id")
      .eq("account_id", accountId)
      .not("contact_id", "is", null)
      .limit(1);
    const contactId = ((data ?? [])[0] as { contact_id: string } | undefined)?.contact_id;
    if (!contactId) return;

    const one = await fetchData(
      {
        dataset: "visits",
        period: "last_365_days",
        filters: { customer: contactId },
        measures: ["visit_count"],
      },
      ctx(),
    );
    const sum = (rows: Record<string, unknown>[]) =>
      rows.reduce((n, r) => n + Number(r.visit_count ?? 0), 0);
    expect(sum(one.rows)).toBeLessThanOrEqual(sum(all.rows));
    if (sum(all.rows) > sum(one.rows)) expect(sum(one.rows)).toBeGreaterThan(0);
  });

  it("reports the period it actually used, in account time", async () => {
    const r = await fetchData(
      { dataset: "orders", period: "this_month", group_by: ["user"], measures: ["net_amount"] },
      ctx(),
    );
    expect(r.period_resolved).toMatchObject({
      timezone: IST,
      label: "This Month",
      start_date: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    });
  });
});

// ============================================================
// The questions an admin actually asked that could not be answered.
// Kept as tests so they stay answerable.
// ============================================================
describe.skipIf(!canRun)("questions from real use", () => {
  let db: SupabaseClient;
  let accountId: string;
  let employee: string;

  function ctx(): McpContext {
    return {
      connectionId: "test",
      accountId,
      profileId: "test",
      clientName: "vitest",
      accountName: "vitest",
      supabase: db,
      timezone: IST,
      tenant: { plan: "Enterprise", moduleSettings: {}, allowWorkforceData: true },
    } as McpContext;
  }

  beforeAll(async () => {
    const t = (target as { target: { url: string; key: string } }).target;
    db = createClient(t.url, t.key, { auth: { persistSession: false } });
    const { data } = await db
      .from("mcp_visit_details")
      .select("account_id, employee_name")
      .not("employee_name", "is", null)
      .limit(500);
    const counts = new Map<string, number>();
    const people = new Map<string, string>();
    for (const r of (data ?? []) as { account_id: string; employee_name: string }[]) {
      counts.set(r.account_id, (counts.get(r.account_id) ?? 0) + 1);
      people.set(r.account_id, r.employee_name);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) throw new Error("no visits to test against");
    accountId = ranked[0][0];
    employee = people.get(accountId)!;
  });

  // "Pls share me last 15 days total customer visits done by Dhaval"
  it("answers an arbitrary-length window with a number, not a range", async () => {
    const r = await fetchData(
      { dataset: "visits", days_back: 15, group_by: ["user"], measures: ["visit_count"] },
      ctx(),
    );
    expect(r.period_resolved!.label).toBe("Last 15 Days");
    const span =
      (Date.parse(r.period_resolved!.end_date) -
        Date.parse(r.period_resolved!.start_date)) /
        86_400_000 +
      1;
    expect(span).toBe(15);

    // Cross-check one employee's figure against plain SQL.
    const { from, end } = {
      from: r.period_resolved!.start_date,
      end: r.period_resolved!.end_date,
    };
    const { data } = await db
      .from("mcp_visit_details")
      .select("id, employee_name, check_in_at")
      .eq("account_id", accountId)
      .eq("employee_name", employee);
    const expected = (data ?? []).filter((v) => {
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: IST,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date((v as { check_in_at: string }).check_in_at));
      return day >= from && day <= end;
    }).length;
    const row = r.rows.find((x) => x.user === employee);
    expect(Number(row?.visit_count ?? 0)).toBe(expected);
  });

  it("answers the same question for an odd number of days", async () => {
    const r = await fetchData(
      { dataset: "visits", days_back: 9, group_by: ["user"], measures: ["visit_count"] },
      ctx(),
    );
    expect(r.period_resolved!.label).toBe("Last 9 Days");
  });

  it("answers an explicit calendar range", async () => {
    const r = await fetchData(
      {
        dataset: "visits",
        start_date: "2026-09-20",
        end_date: "2026-10-04",
        group_by: ["user"],
        measures: ["visit_count"],
      },
      ctx(),
    );
    expect(r.period_resolved!.start_date).toBe("2026-09-20");
  });

  // "show me visit spend time and feedback of those visits in last 15 days"
  it("shows time spent and feedback for individual visits", async () => {
    const r = await fetchData(
      {
        dataset: "visit_log",
        days_back: 15,
        fields: [
          "customer_company",
          "employee_name",
          "check_in_at",
          "duration_minutes",
          "feedback_type",
        ],
      },
      ctx(),
    );
    expect(r.mode).toBe("detail");
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      expect(Object.keys(row).sort()).toEqual([
        "check_in_at",
        "customer_company",
        "duration_minutes",
        "employee_name",
        "feedback_type",
      ]);
    }
  });

  it("keeps the visit log inside the window it was asked for", async () => {
    const r = await fetchData(
      { dataset: "visit_log", days_back: 15, fields: ["check_in_at"] },
      ctx(),
    );
    const p = r.period_resolved!;
    for (const row of r.rows) {
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: IST,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(row.check_in_at as string));
      expect(day >= p.start_date && day <= p.end_date).toBe(true);
    }
  });

  it("breaks a window down day by day", async () => {
    const r = await fetchData(
      { dataset: "visits", days_back: 15, group_by: ["day"], measures: ["visit_count"] },
      ctx(),
    );
    for (const row of r.rows) {
      expect(String(row.day)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ============================================================
// Phase 2, against real data.
// ============================================================
describe.skipIf(!canRun)("phase 2 data sets", () => {
  let db: SupabaseClient;
  let accountId: string;

  function ctx(): McpContext {
    return {
      connectionId: "test",
      accountId,
      profileId: "test",
      clientName: "vitest",
      accountName: "vitest",
      supabase: db,
      timezone: IST,
      tenant: { plan: "Enterprise", moduleSettings: {}, allowWorkforceData: true },
    } as McpContext;
  }

  beforeAll(async () => {
    const t = (target as { target: { url: string; key: string } }).target;
    db = createClient(t.url, t.key, { auth: { persistSession: false } });
    const { data } = await db.from("location_pings").select("account_id").limit(2000);
    const counts = new Map<string, number>();
    for (const r of (data ?? []) as { account_id: string }[]) {
      counts.set(r.account_id, (counts.get(r.account_id) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) throw new Error("no location pings to test against");
    accountId = ranked[0][0];
  });

  it("turns a day of GPS readings into a handful of stops", async () => {
    const r = await fetchData({ dataset: "location_trail", days_back: 60 }, ctx());
    // The point of the whole exercise: far fewer rows than readings.
    expect(r.rows.length).toBeLessThan(200);
    for (const row of r.rows) {
      if (row.minutes === null) continue; // the mocked-reading note row
      expect(typeof row.minutes).toBe("number");
      expect(row.employee_name).toBeTruthy();
    }
    expect(r.note).toMatch(/not punched in/i);
  });

  it("never returns a raw GPS reading column", async () => {
    const r = await fetchData({ dataset: "location_trail", days_back: 60 }, ctx());
    for (const row of r.rows) {
      expect(Object.keys(row)).not.toContain("accuracy_m");
      expect(Object.keys(row)).not.toContain("speed_mps");
    }
  });

  it("refuses the trail outright when the workforce switch is off", async () => {
    const locked = {
      ...ctx(),
      tenant: { plan: "Enterprise", moduleSettings: {}, allowWorkforceData: false },
    } as McpContext;
    for (const name of ["location_trail", "attendance", "device_health"]) {
      await expect(fetchData({ dataset: name }, locked)).rejects.toThrow(/not enabled/i);
    }
  });

  it("answers route adherence from one data set", async () => {
    const r = await fetchData(
      { dataset: "route_stops", days_back: 365, fields: ["employee_name", "customer_company", "status", "skip_reason"] },
      ctx(),
    );
    for (const row of r.rows) {
      expect(row).toHaveProperty("status");
    }
  });

  it("gives per-product value from the order lines, not the order total", async () => {
    const r = await fetchData(
      {
        dataset: "order_items",
        days_back: 365,
        fields: ["product_name", "quantity", "line_value", "order_number"],
      },
      ctx(),
    );
    if (!r.rows.length) return;
    for (const row of r.rows) {
      expect(row.product_name).toBeTruthy();
      expect(Number(row.line_value)).not.toBeNaN();
    }

    // The bug this data set exists to prevent: an order's total must not be
    // the sum of its lines repeated, so for a multi-line order the lines must
    // sum to roughly the order's own total rather than a multiple of it.
    const anyOrder = r.rows.find((x) => x.order_number);
    const { data: lines } = await db
      .from("mcp_order_item_details")
      .select("line_value")
      .eq("account_id", accountId)
      .eq("order_number", anyOrder!.order_number as string);
    const lineSum = (lines ?? []).reduce(
      (n, l) => n + Number((l as { line_value: number }).line_value ?? 0),
      0,
    );
    const { data: order } = await db
      .from("mcp_order_details")
      .select("total_amount")
      .eq("account_id", accountId)
      .eq("order_number", anyOrder!.order_number as string)
      .maybeSingle();
    const total = Number((order as { total_amount: number } | null)?.total_amount ?? 0);
    if (total > 0) {
      expect(Math.abs(lineSum - total) / total).toBeLessThan(0.5);
    }
  });

  it.each(["routes", "route_runs", "leave", "stock", "schemes", "territories", "attendance", "device_health"])(
    "%s reads without error",
    async (name) => {
      const r = await fetchData({ dataset: name, limit: 20 }, ctx());
      expect(Array.isArray(r.rows)).toBe(true);
    },
  );
});
