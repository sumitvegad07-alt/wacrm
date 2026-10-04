// ============================================================
// Tenant isolation — the single most important test in this module.
// Everything else here is a feature; this is the promise.
//
// Deliberately run with the SERVICE-ROLE client, which bypasses RLS.
// Production runs every query as the connecting admin, so RLS is the real
// guard — but that makes the explicit `account_id` filter in fetch.ts look
// untested, and a future RLS mistake would then be a cross-tenant leak with
// nothing behind it. Running with RLS switched off proves the belt holds on
// its own, without the braces.
//
// Read-only: selects only, no writes, against real accounts discovered at
// runtime rather than hardcoded (customer names do not belong in the repo).
// ============================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { allDataSets } from "./catalog";
import { fetchData } from "./fetch";
import type { McpContext } from "./session";
import { testDbTarget } from "./test-db";

const target = testDbTarget();
const canRun = "target" in target;
if (!canRun) {
  console.warn(`[mcp] skipping tenant-isolation test: ${target.reason}`);
}

/** Reader data sets, which are the ones fetch.ts filters by hand. */
const READER_SETS = allDataSets().filter((s) => s.route === "reader" && s.table);

describe.skipIf(!canRun)("tenant isolation", () => {
  let db: SupabaseClient;
  let accountA: string;
  let accountB: string;

  function ctxFor(accountId: string): McpContext {
    return {
      connectionId: "test",
      accountId,
      profileId: "test",
      clientName: "vitest",
      accountName: "vitest",
      supabase: db,
      timezone: "Asia/Kolkata",
      // Full access, so nothing is skipped for the wrong reason: this test
      // must exercise every reader data set, not just the entitled ones.
      tenant: { plan: "Enterprise", moduleSettings: {}, allowWorkforceData: true },
    } as McpContext;
  }

  beforeAll(async () => {
    const t = (target as { target: { url: string; key: string } }).target;
    db = createClient(t.url, t.key, { auth: { persistSession: false } });

    const { data, error } = await db
      .from("contacts")
      .select("account_id")
      .limit(2000);
    if (error) throw new Error(`cannot read contacts: ${error.message}`);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { account_id: string }[]) {
      counts.set(row.account_id, (counts.get(row.account_id) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (ranked.length < 2) {
      throw new Error("need at least two accounts with customers to prove isolation");
    }
    [accountA, accountB] = ranked;
  });

  it("found two distinct accounts to compare", () => {
    expect(accountA).toBeTruthy();
    expect(accountB).toBeTruthy();
    expect(accountA).not.toBe(accountB);
  });

  /** Data sets whose rows carry a real table id we can trace to an owner. */
  const OWNABLE = READER_SETS.filter(
    (s) => !s.transform && s.fields.some((f) => f.key === "id"),
  );

  it.each(OWNABLE.map((s) => [s.name, s.table!] as const))(
    "%s returns no row belonging to another account",
    async (name, table) => {
      const result = await fetchData(
        { dataset: name, fields: ["id"], limit: 1000 },
        ctxFor(accountA),
      );
      const ids = result.rows.map((r) => r.id).filter(Boolean) as string[];
      if (ids.length === 0) return; // nothing to leak

      // Ask the database, with RLS off, who actually owns these rows. Chunked
      // because a 1,000-id `in` list overflows the request URL.
      const foreign: string[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await db
          .from(table)
          .select("id, account_id")
          .in("id", ids.slice(i, i + 150));
        expect(error, `${name}: ${error?.message}`).toBeNull();
        for (const r of (data ?? []) as { id: string; account_id: string }[]) {
          if (r.account_id !== accountA) foreign.push(r.id);
        }
      }
      expect(foreign, `${name} returned rows owned by another account`).toEqual([]);
    },
  );

  it.each(OWNABLE.map((s) => [s.name] as const))(
    "%s returns a different set for a different account",
    async (name) => {
      const a = await fetchData({ dataset: name, fields: ["id"], limit: 1000 }, ctxFor(accountA));
      const b = await fetchData({ dataset: name, fields: ["id"], limit: 1000 }, ctxFor(accountB));
      const idsA = new Set(a.rows.map((r) => r.id));
      const overlap = b.rows.map((r) => r.id).filter((id) => idsA.has(id));
      // Any shared id would mean the account filter did nothing at all.
      expect(overlap, `${name} returned the same rows for two accounts`).toEqual([]);
    },
  );

  // stock is grouped per product and location_trail is derived from pings, so
  // neither carries a row id. They still must not mix accounts, so compare
  // them on the identity they do have.
  it.each(
    READER_SETS.filter((s) => s.transform || !s.fields.some((f) => f.key === "id"))
      .map((s) => [s.name, s] as const),
  )("%s keeps two accounts apart even without a row id", async (name, s) => {
    const key = s.transform ? "employee_name" : (s.dimensions[0]?.key ?? s.fields[0].key);
    const a = await fetchData({ dataset: name, limit: 1000 }, ctxFor(accountA));
    const b = await fetchData({ dataset: name, limit: 1000 }, ctxFor(accountB));
    if (!a.rows.length || !b.rows.length) return;
    // Identical row sets would mean the account filter never ran.
    const sig = (rows: Record<string, unknown>[]) =>
      JSON.stringify(rows.map((r) => r[key]).sort());
    expect(sig(a.rows), `${name} returned identical rows for two accounts`).not.toBe(
      sig(b.rows),
    );
  });

  it("never leaks another account's customer through a search", async () => {
    // Take a real customer name from account B, then search for it as A.
    const { data } = await db
      .from("contacts")
      .select("id, name")
      .eq("account_id", accountB)
      .not("name", "is", null)
      .limit(1);
    const victim = (data ?? [])[0] as { id: string; name: string } | undefined;
    if (!victim?.name) return;

    const result = await fetchData(
      { dataset: "customers", filters: { search: victim.name }, fields: ["id", "name"] },
      ctxFor(accountA),
    );
    expect(result.rows.map((r) => r.id)).not.toContain(victim.id);
  });

  it("refuses a sensitive data set by name when the switch is off", async () => {
    const locked = {
      ...ctxFor(accountA),
      tenant: { plan: "Enterprise", moduleSettings: {}, allowWorkforceData: false },
    } as McpContext;
    // Named directly rather than chosen from the menu — hiding is not security.
    await expect(fetchData({ dataset: "employees" }, locked)).resolves.toBeTruthy();
    for (const s of allDataSets().filter((x) => x.sensitive)) {
      await expect(fetchData({ dataset: s.name }, locked)).rejects.toThrow(/not enabled/i);
    }
  });

  it("refuses an out-of-plan data set by name", async () => {
    const crmOnly = {
      ...ctxFor(accountA),
      tenant: { plan: "CRM", moduleSettings: {}, allowWorkforceData: false },
    } as McpContext;
    await expect(fetchData({ dataset: "employees" }, crmOnly)).rejects.toThrow(/plan/i);
  });
});
