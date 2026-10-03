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
