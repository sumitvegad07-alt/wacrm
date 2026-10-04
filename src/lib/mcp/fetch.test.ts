import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  runReport: vi.fn(
    async (
      ..._args: [
        supabase: unknown,
        accountId: string,
        module: string,
        dimensions: string[],
        measures: string[],
        filters: Record<string, unknown>,
        sort: string | undefined,
        limit: number | undefined,
      ]
    ): Promise<Record<string, unknown>[]> => [{ user: "Ramesh", visit_count: 47 }],
  ),
}));
vi.mock("@/lib/dashboard/report-rpc", () => ({
  runReport: rpc.runReport,
  num: (v: unknown) => Number(v) || 0,
  str: (v: unknown) => String(v ?? ""),
}));

import { fetchData } from "./fetch";
import type { McpContext } from "./session";

/** A Supabase stand-in that records the query it was asked to build. */
function fakeSupabase(rows: Record<string, unknown>[] = [], total = rows.length) {
  const calls: Record<string, unknown> = { filters: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: (cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) {
        calls.countSelect = cols;
        return { ...builder, then: undefined, __head: true };
      }
      calls.select = cols;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      (calls.filters as unknown[]).push(["eq", col, val]);
      return builder;
    },
    gte: (col: string, val: unknown) => {
      (calls.filters as unknown[]).push(["gte", col, val]);
      return builder;
    },
    lt: (col: string, val: unknown) => {
      (calls.filters as unknown[]).push(["lt", col, val]);
      return builder;
    },
    ilike: (col: string, val: unknown) => {
      (calls.filters as unknown[]).push(["ilike", col, val]);
      return builder;
    },
    or: (expr: string) => {
      (calls.filters as unknown[]).push(["or", expr]);
      return builder;
    },
    order: (col: string, opts?: unknown) => {
      calls.order = [col, opts];
      return builder;
    },
    range: (from: number, to: number) => {
      calls.range = [from, to];
      return Promise.resolve({ data: rows, error: null, count: total });
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: null, count: total }),
  });

  return {
    calls,
    client: {
      from: (table: string) => {
        calls.table = table;
        return builder;
      },
    } as never,
  };
}

function ctx(over: Partial<McpContext> = {}): McpContext {
  return {
    connectionId: "c1",
    accountId: "a1",
    profileId: "p1",
    clientName: "Claude",
    accountName: "Test Co",
    supabase: fakeSupabase().client,
    timezone: "Asia/Kolkata",
    tenant: { plan: "CRM_SFA", moduleSettings: {}, allowWorkforceData: false },
    ...over,
  } as McpContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.runReport.mockResolvedValue([{ user: "Ramesh", visit_count: 47 }]);
});

describe("fetchData — report route", () => {
  it("resolves the period in account time and reports it back", async () => {
    const r = await fetchData(
      { dataset: "visits", period: "last_180_days", measures: ["visit_count"] },
      ctx(),
    );
    expect(r.period_resolved?.timezone).toBe("Asia/Kolkata");
    expect(r.period_resolved?.label).toBe("Last 180 Days");
    expect(r.mode).toBe("summary");
  });

  it("passes the resolved period to the report engine as a date_range", async () => {
    await fetchData(
      { dataset: "visits", period: "today", measures: ["visit_count"] },
      ctx(),
    );
    const filters = rpc.runReport.mock.calls[0][5] as { date_range?: unknown };
    expect(filters.date_range).toMatchObject({
      start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("runs as the admin's client, never a service-role one", async () => {
    const c = ctx();
    await fetchData({ dataset: "visits", measures: ["visit_count"] }, c);
    expect(rpc.runReport.mock.calls[0][0]).toBe(c.supabase);
    expect(rpc.runReport.mock.calls[0][1]).toBe("a1");
  });

  it("rejects a field the descriptor does not allow-list", async () => {
    await expect(
      fetchData({ dataset: "visits", fields: ["secret_margin"] }, ctx()),
    ).rejects.toThrow(/not available/i);
  });

  it("rejects a filter the descriptor does not declare", async () => {
    await expect(
      fetchData({ dataset: "visits", filters: { salary: 1 } }, ctx()),
    ).rejects.toThrow(/not a filter/i);
  });

  it("rejects a group_by that is not a dimension", async () => {
    await expect(
      fetchData({ dataset: "visits", group_by: ["salary"], measures: ["visit_count"] }, ctx()),
    ).rejects.toThrow(/cannot group/i);
  });

  it("rejects a measure that does not exist", async () => {
    await expect(
      fetchData({ dataset: "visits", measures: ["profit"] }, ctx()),
    ).rejects.toThrow(/not a measure/i);
  });

  it("rejects a sort column that is not readable", async () => {
    await expect(
      fetchData({ dataset: "visits", measures: ["visit_count"], sort: "salary" }, ctx()),
    ).rejects.toThrow(/cannot sort/i);
  });

  it("names the data set and points at describe_data in every rejection", async () => {
    await expect(
      fetchData({ dataset: "visits", fields: ["nope"] }, ctx()),
    ).rejects.toThrow(/describe_data/);
  });

  it("rejects an unknown period rather than defaulting to everything", async () => {
    await expect(
      fetchData({ dataset: "visits", period: "last_fortnight" }, ctx()),
    ).rejects.toThrow(/unknown period/i);
  });

  it("refuses a data set outside the tenant's plan", async () => {
    await expect(
      fetchData(
        { dataset: "visits" },
        ctx({ tenant: { plan: "CRM", moduleSettings: {}, allowWorkforceData: false } }),
      ),
    ).rejects.toThrow(/plan/i);
  });

  it("clamps an oversized limit and flags truncation", async () => {
    rpc.runReport.mockResolvedValueOnce(
      Array.from({ length: 1000 }, () => ({ user: "x", visit_count: 1 })),
    );
    const r = await fetchData(
      { dataset: "visits", group_by: ["user"], measures: ["visit_count"], limit: 50_000 },
      ctx(),
    );
    expect(r.row_count).toBe(1000);
    expect(r.truncated).toBe(true);
    expect(rpc.runReport.mock.calls[0][7]).toBe(1000);
  });

  it("does not flag truncation on a partial page", async () => {
    const r = await fetchData(
      { dataset: "visits", group_by: ["user"], measures: ["visit_count"] },
      ctx(),
    );
    expect(r.truncated).toBe(false);
  });

  it("returns a summary with a note when a detail request is too broad", async () => {
    const r = await fetchData({ dataset: "orders", fields: ["customer"] }, ctx());
    expect(r.mode).toBe("summary");
    // The note must tell the AI how to get the rows it actually asked for,
    // or it will simply repeat the same too-broad request.
    expect(r.note).toMatch(/too broad/i);
    expect(r.note).toMatch(/period or a filter/i);
  });

  it("allows a detail request once it is narrowed by a period", async () => {
    const r = await fetchData(
      { dataset: "orders", period: "today", fields: ["customer"] },
      ctx(),
    );
    expect(r.mode).toBe("detail");
    expect(r.note).toBeUndefined();
  });

  // Regression: the report engine wants `customer` as { contact_id: <id> }.
  // A flat id matches nothing and execute_report returns 0 WITHOUT erroring,
  // so "how many visits for Laxmi Mittal" answered 0 against 5 real visits.
  // Eight report data sets share this filter.
  it("sends the customer filter in the shape the report engine expects", async () => {
    await fetchData(
      { dataset: "visits", period: "last_180_days", filters: { customer: "cust-1" }, measures: ["visit_count"] },
      ctx(),
    );
    const filters = rpc.runReport.mock.calls[0][5];
    expect(filters.customer).toEqual({ contact_id: "cust-1" });
  });

  it("accepts the nested shape too, rather than double-wrapping it", async () => {
    await fetchData(
      { dataset: "visits", filters: { customer: { contact_id: "cust-1" } }, measures: ["visit_count"] },
      ctx(),
    );
    expect(rpc.runReport.mock.calls[0][5].customer).toEqual({ contact_id: "cust-1" });
  });

  it.each(["orders", "sales", "quotations", "payments", "outstanding", "deals", "tasks"])(
    "wraps the customer filter on %s too",
    async (dataset) => {
      await fetchData({ dataset, filters: { customer: "cust-1" } }, ctx());
      expect(rpc.runReport.mock.calls[0][5].customer).toEqual({ contact_id: "cust-1" });
    },
  );

  it("leaves flat filters alone", async () => {
    await fetchData(
      { dataset: "visits", filters: { visit_for: "Customer" }, measures: ["visit_count"] },
      ctx(),
    );
    expect(rpc.runReport.mock.calls[0][5].visit_for).toBe("Customer");
  });

  it("stamps as_of so the AI can say when the answer was true", async () => {
    const r = await fetchData(
      { dataset: "visits", measures: ["visit_count"] },
      ctx(),
    );
    expect(r.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("fetchData — reader route", () => {
  it("selects only allow-listed columns, never a star", async () => {
    const fake = fakeSupabase([{ id: "1", name: "Shah Traders" }]);
    await fetchData(
      { dataset: "customers", fields: ["id", "name"] },
      ctx({ supabase: fake.client }),
    );
    expect(fake.calls.select).toBe("id,name");
    expect(String(fake.calls.select)).not.toContain("*");
  });

  it("falls back to the full allow-list, still never a star", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData({ dataset: "customers" }, ctx({ supabase: fake.client }));
    expect(String(fake.calls.select)).not.toContain("*");
    expect(String(fake.calls.select).split(",").length).toBeGreaterThan(5);
  });

  it("always filters by account_id, on top of RLS", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData({ dataset: "customers" }, ctx({ supabase: fake.client }));
    expect(fake.calls.filters).toContainEqual(["eq", "account_id", "a1"]);
  });

  it("reads from the descriptor's table", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData({ dataset: "customers" }, ctx({ supabase: fake.client }));
    expect(fake.calls.table).toBe("contacts");
  });

  it("turns `search` into an OR over the declared search columns only", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData(
      { dataset: "customers", filters: { search: "Shah" } },
      ctx({ supabase: fake.client }),
    );
    const or = (fake.calls.filters as unknown[][]).find((f) => f[0] === "or");
    expect(or).toBeTruthy();
    expect(String(or![1])).toContain("name.ilike");
    expect(String(or![1])).toContain("customer_code.ilike");
    // Must not have gone fishing through unrelated text columns.
    expect(String(or![1])).not.toContain("gst_number");
    expect(String(or![1])).not.toContain("address");
  });

  it("escapes a search term so it cannot break out of the OR expression", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData(
      { dataset: "customers", filters: { search: "a,b)or(x" } },
      ctx({ supabase: fake.client }),
    );
    const or = (fake.calls.filters as unknown[][]).find((f) => f[0] === "or");
    expect(String(or![1])).not.toContain("),or(");
  });

  it("applies an equality filter the descriptor declares", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData(
      { dataset: "customers", filters: { city: "Mumbai" } },
      ctx({ supabase: fake.client }),
    );
    expect(fake.calls.filters).toContainEqual(["eq", "city", "Mumbai"]);
  });

  it("rejects an undeclared filter before touching the database", async () => {
    const fake = fakeSupabase([]);
    await expect(
      fetchData(
        { dataset: "customers", filters: { credit_limit: 1 } },
        ctx({ supabase: fake.client }),
      ),
    ).rejects.toThrow(/not a filter/i);
    expect(fake.calls.table).toBeUndefined();
  });

  it("pages with range and clamps the limit", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData(
      { dataset: "customers", limit: 50_000 },
      ctx({ supabase: fake.client }),
    );
    expect(fake.calls.range).toEqual([0, 999]);
  });

  it("offsets by page", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData(
      { dataset: "customers", limit: 10, page: 3 },
      ctx({ supabase: fake.client }),
    );
    expect(fake.calls.range).toEqual([20, 29]);
  });

  it("refuses to guess a grouped total it cannot compute exactly", async () => {
    // 5,000 customers cannot be grouped accurately from a 1,000-row page, and
    // a wrong total is worse than no answer.
    const fake = fakeSupabase([{ city: "Mumbai" }], 5000);
    const r = await fetchData(
      { dataset: "customers", group_by: ["city"], measures: ["customer_count"] },
      ctx({ supabase: fake.client }),
    );
    expect(r.truncated).toBe(true);
    expect(r.note).toMatch(/too many|narrow/i);
    expect(r.rows).toEqual([]);
  });

  it("groups accurately when the whole set fits", async () => {
    const fake = fakeSupabase(
      [{ city: "Mumbai" }, { city: "Mumbai" }, { city: "Pune" }],
      3,
    );
    const r = await fetchData(
      { dataset: "customers", group_by: ["city"], measures: ["customer_count"] },
      ctx({ supabase: fake.client }),
    );
    expect(r.mode).toBe("summary");
    expect(r.truncated).toBe(false);
    expect(r.rows).toEqual(
      expect.arrayContaining([
        { city: "Mumbai", customer_count: 2 },
        { city: "Pune", customer_count: 1 },
      ]),
    );
  });

  it("surfaces a database error rather than reporting an empty result", async () => {
    // Returning [] on failure is how an AI confidently says "you have no
    // customers" when the query simply broke.
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              range: async () => ({ data: null, error: { message: "boom" }, count: null }),
            }),
          }),
        }),
      }),
    } as never;
    await expect(
      fetchData({ dataset: "customers" }, ctx({ supabase: broken })),
    ).rejects.toThrow(/could not be read/i);
  });
});

describe("fetchData — arbitrary windows", () => {
  it("counts exactly N days back, in account time", async () => {
    await fetchData(
      { dataset: "visits", days_back: 9, measures: ["visit_count"] },
      ctx(),
    );
    const f = rpc.runReport.mock.calls[0][5] as {
      date_range?: { start_date: string; end_date: string };
    };
    const span =
      (Date.parse(f.date_range!.end_date) - Date.parse(f.date_range!.start_date)) /
        86_400_000 +
      1;
    expect(span).toBe(9);
  });

  it("passes an explicit range straight through", async () => {
    const r = await fetchData(
      {
        dataset: "visits",
        start_date: "2026-09-20",
        end_date: "2026-10-04",
        measures: ["visit_count"],
      },
      ctx(),
    );
    expect(r.period_resolved).toMatchObject({
      start_date: "2026-09-20",
      end_date: "2026-10-04",
      timezone: "Asia/Kolkata",
    });
  });

  it("prefers an explicit range over days_back and period", async () => {
    const r = await fetchData(
      {
        dataset: "visits",
        period: "today",
        days_back: 30,
        start_date: "2026-09-20",
        end_date: "2026-10-04",
        measures: ["visit_count"],
      },
      ctx(),
    );
    expect(r.period_resolved!.start_date).toBe("2026-09-20");
  });

  it("prefers days_back over a named period", async () => {
    const r = await fetchData(
      { dataset: "visits", period: "today", days_back: 9, measures: ["visit_count"] },
      ctx(),
    );
    expect(r.period_resolved!.label).toBe("Last 9 Days");
  });

  it("refuses half a range rather than guessing the other end", async () => {
    await expect(
      fetchData({ dataset: "visits", start_date: "2026-09-20" }, ctx()),
    ).rejects.toThrow(/together/i);
    await expect(
      fetchData({ dataset: "visits", end_date: "2026-10-04" }, ctx()),
    ).rejects.toThrow(/together/i);
  });

  it("rejects a malformed or impossible date", async () => {
    await expect(
      fetchData(
        { dataset: "visits", start_date: "20-09-2026", end_date: "2026-10-04" },
        ctx(),
      ),
    ).rejects.toThrow(/YYYY-MM-DD/);
    await expect(
      fetchData(
        { dataset: "visits", start_date: "2026-02-30", end_date: "2026-03-01" },
        ctx(),
      ),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe("fetchData — reader date windows", () => {
  it("bounds a reader query by real instants, in account time", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await fetchData(
      { dataset: "visit_log", start_date: "2026-09-20", end_date: "2026-10-04" },
      ctx({ supabase: fake.client }),
    );
    const filters = fake.calls.filters as unknown[][];
    const gte = filters.find((f) => f[0] === "gte");
    const lt = filters.find((f) => f[0] === "lt");
    expect(gte![1]).toBe("check_in_at");
    // 20 Sep 00:00 IST is 19 Sep 18:30 UTC.
    expect(gte![2]).toBe("2026-09-19T18:30:00.000Z");
    // Upper bound is EXCLUSIVE midnight after the last day, so nothing in the
    // final second is dropped.
    expect(lt![2]).toBe("2026-10-04T18:30:00.000Z");
  });

  it("refuses a period on a reader data set that records no time", async () => {
    const fake = fakeSupabase([{ id: "1" }]);
    await expect(
      fetchData({ dataset: "products", days_back: 7 }, ctx({ supabase: fake.client })),
    ).rejects.toThrow(/no date to filter on/i);
  });

  it("reads individual visits with duration and feedback", async () => {
    const fake = fakeSupabase([
      { customer_company: "Brahmani casting", duration_minutes: 5, feedback_type: "Good" },
    ]);
    const r = await fetchData(
      {
        dataset: "visit_log",
        days_back: 15,
        fields: ["customer_company", "duration_minutes", "feedback_type"],
      },
      ctx({ supabase: fake.client }),
    );
    expect(fake.calls.table).toBe("mcp_visit_details");
    expect(fake.calls.select).toBe("customer_company,duration_minutes,feedback_type");
    expect(r.rows[0]).toMatchObject({ duration_minutes: 5, feedback_type: "Good" });
  });
});
