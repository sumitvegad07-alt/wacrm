// ============================================================
// The scenario matrix.
//
// The brief was "an admin can ask anything", so this does not test a handful
// of chosen questions — it generates the realistic question shapes for EVERY
// data set and runs all of them against production.
//
// Four shapes cover what an admin actually asks:
//   totals      "how many visits this month"
//   grouped     "visits by employee this month"
//   listing     "show me the visits this month"
//   filtered    "visits for this customer this month"
//
// crossed with every named window, every arbitrary window, and the awkward
// ones (a weekday, a month, the financial year).
//
// What it asserts is deliberately narrow and strict: a question must either
// ANSWER or be REFUSED WITH A REASON. The failure this whole module exists to
// prevent is the third outcome — a confident empty answer that looks like
// "there is none" when it means "I could not ask".
// ============================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { allDataSets } from "./catalog";
import { fetchData, type FetchArgs } from "./fetch";
import { MCP_PERIODS, resolvePeriod } from "./periods";
import type { McpContext } from "./session";
import { testDbTarget } from "./test-db";

const target = testDbTarget();
const canRun = "target" in target;
if (!canRun) {
  console.warn(`[mcp] skipping scenario matrix: ${target.reason}`);
}

const IST = "Asia/Kolkata";
const SETS = allDataSets();

/** Windows an admin phrases in conversation. */
const WINDOWS: Array<{ label: string; args: Partial<FetchArgs> }> = [
  ...MCP_PERIODS.map((p) => ({ label: `period=${p}`, args: { period: p } })),
  { label: "days_back=1", args: { days_back: 1 } },
  { label: "days_back=9", args: { days_back: 9 } },
  { label: "days_back=45", args: { days_back: 45 } },
  { label: "days_back=365", args: { days_back: 365 } },
  { label: "month=2026-08", args: { month: "2026-08" } },
  { label: "month=2026-02", args: { month: "2026-02" } },
  { label: "single day", args: { start_date: "2026-09-29", end_date: "2026-09-29" } },
  { label: "range", args: { start_date: "2026-09-20", end_date: "2026-10-04" } },
  { label: "no window", args: {} },
];

describe.skipIf(!canRun)("scenario matrix", () => {
  let db: SupabaseClient;
  let accountId: string;

  function ctx(): McpContext {
    return {
      connectionId: "scenarios",
      accountId,
      profileId: "scenarios",
      clientName: "vitest",
      accountName: "vitest",
      supabase: db,
      timezone: IST,
      tenant: { plan: "Enterprise", moduleSettings: {}, allowWorkforceData: true },
    } as McpContext;
  }

  /**
   * Run one question. Either it answers, or it refuses with a sentence an
   * admin could act on. Anything else is a failure.
   */
  async function ask(args: FetchArgs): Promise<{ answered: boolean; rows: number }> {
    let result;
    try {
      result = await fetchData(args, ctx());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A refusal must say something, and must not be a stack trace or a
      // database error leaking through.
      expect(message.length, `bare refusal for ${JSON.stringify(args)}`).toBeGreaterThan(20);
      expect(message, `database error leaked: ${message}`).not.toMatch(
        /column .* does not exist|relation .* does not exist|syntax error|PGRST/i,
      );
      return { answered: false, rows: 0 };
    }
    // Checked OUTSIDE the try: an assertion failure here is a bug in the
    // answer, and swallowing it as "refused" is how the row_count bug nearly
    // got through — the matrix reported a refusal where there was a wrong number.
    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.row_count, `row_count disagrees with rows for ${JSON.stringify(args)}`)
      .toBe(result.rows.length);
    expect(typeof result.as_of).toBe("string");
    return { answered: true, rows: result.row_count };
  }

  beforeAll(async () => {
    const t = (target as { target: { url: string; key: string } }).target;
    db = createClient(t.url, t.key, { auth: { persistSession: false } });
    // The account with the most customers: the one with enough data across
    // modules for these questions to be meaningful.
    const { data } = await db.from("contacts").select("account_id").limit(2000);
    const counts = new Map<string, number>();
    for (const r of (data ?? []) as { account_id: string }[]) {
      counts.set(r.account_id, (counts.get(r.account_id) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    accountId = ranked[0][0];
  });

  // ── every data set answers every question shape ──────────
  describe.each(SETS.map((s) => [s.name, s] as const))("%s", (name, s) => {
    it("answers a totals question", async () => {
      const measure = s.measures[0]?.key;
      const r = await ask({ dataset: name, ...(measure ? { measures: [measure] } : {}) });
      expect(r.answered).toBe(true);
    });

    it("answers a grouped question", async () => {
      const dimension = s.dimensions[0]?.key;
      if (!dimension) return;
      const r = await ask({
        dataset: name,
        group_by: [dimension],
        measures: s.measures[0] ? [s.measures[0].key] : undefined,
      });
      expect(r.answered).toBe(true);
    });

    it("answers a record listing", async () => {
      const fields = s.fields.slice(0, 4).map((f) => f.key);
      const r = await ask({ dataset: name, fields, limit: 20 });
      expect(r.answered).toBe(true);
    });

    it("answers a filtered question", async () => {
      const filter = s.filters.find(
        (f) => f.key !== "period" && f.key !== "time_of_day",
      );
      if (!filter) return;
      const value = filter.key === "search" ? "a" : (filter.options?.[0] ?? "a");
      const r = await ask({ dataset: name, filters: { [filter.key]: value }, limit: 20 });
      expect(r.answered).toBe(true);
    });

    it("sorts a listing by one of its own columns", async () => {
      const sort = s.fields[0]?.key;
      const r = await ask({ dataset: name, sort, limit: 10 });
      expect(r.answered).toBe(true);
    });

    it("sorts a grouped question by its total", async () => {
      const dimension = s.dimensions[0]?.key;
      const measure = s.measures[0]?.key;
      if (!dimension || !measure) return;
      const r = await ask({
        dataset: name,
        group_by: [dimension],
        measures: [measure],
        sort: measure,
        limit: 10,
      });
      expect(r.answered).toBe(true);
    });

    it("handles a listing sorted by a total without a database error", async () => {
      // The report engine computes measures itself, so it can sort by one.
      // A reader cannot: the total is worked out in this process, so asking
      // Postgres to order by it is a guaranteed "column does not exist".
      // Either behaviour is fine; leaking SQL is not.
      const measure = s.measures[0]?.key;
      if (!measure) return;
      if (s.route === "report") {
        const r = await ask({ dataset: name, sort: measure, limit: 10 });
        expect(r.answered).toBe(true);
        return;
      }
      await expect(
        fetchData({ dataset: name, sort: measure, limit: 10 }, ctx()),
      ).rejects.toThrow(/only sort a grouped question/i);
    });

    it("pages without error", async () => {
      const r = await ask({ dataset: name, limit: 5, page: 2 });
      expect(r.answered).toBe(true);
    });
  });

  // ── every window, against a data set of each kind ────────
  const SAMPLES = [
    "visits", // report route
    "orders", // report route, currency
    "visit_log", // reader with a date column
    "location_trail", // reader with a transform
    "customers", // reader, date column
    "stock", // reader with NO date column
  ].filter((n) => SETS.some((s) => s.name === n));

  describe.each(SAMPLES)("%s across every window", (name) => {
    it.each(WINDOWS.map((w) => [w.label, w] as const))("%s", async (_label, w) => {
      const r = await ask({ dataset: name, ...w.args } as FetchArgs);
      // stock has no date, so a window is correctly refused; everything else
      // must answer.
      const set = SETS.find((s) => s.name === name)!;
      const windowed = Object.keys(w.args).length > 0;
      if (set.route === "reader" && !set.dateColumn && windowed) {
        expect(r.answered).toBe(false);
      } else {
        expect(r.answered).toBe(true);
      }
    });
  });

  // ── the awkward questions, by name ───────────────────────
  it("answers a weekday question with a single day", async () => {
    const r = await fetchData(
      { dataset: "visits", period: "last_friday", measures: ["visit_count"] },
      ctx(),
    );
    expect(r.period_resolved!.start_date).toBe(r.period_resolved!.end_date);
    expect(r.period_resolved!.label).toBe("Last Friday");
  });

  it("answers a financial-year question over April to March", async () => {
    const r = await fetchData(
      { dataset: "orders", period: "this_financial_year", measures: ["order_count"] },
      ctx(),
    );
    expect(r.period_resolved!.start_date).toMatch(/-04-01$/);
    expect(r.period_resolved!.end_date).toMatch(/-03-31$/);
  });

  it("answers a named-month question", async () => {
    const r = await fetchData(
      { dataset: "orders", month: "2026-08", measures: ["order_count"] },
      ctx(),
    );
    expect(r.period_resolved).toMatchObject({
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      label: "August 2026",
    });
  });

  it("always reports back the window it used", async () => {
    // The admin has to be able to check the dates an answer was built on.
    for (const w of WINDOWS) {
      if (!Object.keys(w.args).length) continue;
      const r = await fetchData({ dataset: "visits", ...w.args } as FetchArgs, ctx());
      expect(r.period_resolved, w.label).toBeTruthy();
      expect(r.period_resolved!.timezone, w.label).toBe(IST);
      expect(r.period_resolved!.start_date <= r.period_resolved!.end_date).toBe(true);
    }
  });

  it("refuses a window it cannot understand instead of ignoring it", async () => {
    // Silently dropping an unparseable window would answer a different
    // question from the one asked, which is the failure mode that matters.
    for (const bad of [
      { period: "last_fortnight" },
      { period: "next_monday" },
      { days_back: 0 },
      { days_back: -3 },
      { month: "2026-13" },
      { start_date: "2026-09-20" },
      { start_date: "20-09-2026", end_date: "2026-10-04" },
      { start_date: "2026-10-04", end_date: "2026-09-20" },
    ]) {
      await expect(
        fetchData({ dataset: "visits", ...bad } as FetchArgs, ctx()),
        JSON.stringify(bad),
      ).rejects.toThrow();
    }
  });

  it("every advertised period resolves for every report data set", async () => {
    for (const s of SETS.filter((x) => x.route === "report")) {
      for (const period of MCP_PERIODS) {
        const resolved = resolvePeriod(period, IST);
        expect(resolved.start_date, `${s.name}/${period}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
