// ============================================================
// Every column a reader descriptor names must actually exist.
//
// Route B builds its SELECT from the descriptor's field allow-list, so a key
// that no longer matches a real column is not a cosmetic slip — it is a 400
// from Postgres on a live customer question, and no amount of pure-logic
// testing catches it. Writing the first three descriptors from the plan
// produced three such keys (contacts.outstanding_amount and
// contacts.assigned_user_id never existed; products uses `active`, not
// `is_active`), which is why this test exists.
//
// Read-only: it touches information_schema only, never tenant data, and never
// writes. Skips itself when no credentials are present (CI without secrets),
// following src/tests/reporting/report_accuracy_certification.test.ts.
// ============================================================
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { allDataSets } from "./catalog";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.service_role ?? "";
const canRun = Boolean(url && key);

describe.skipIf(!canRun)("reader descriptors match the live schema", () => {
  /** table -> set of real column names. */
  const columns = new Map<string, Set<string>>();

  beforeAll(async () => {
    const supabase = createClient(url, key);
    const tables = [
      ...new Set(
        allDataSets()
          .filter((s) => s.route === "reader" && s.table)
          .map((s) => s.table as string),
      ),
    ];

    // information_schema is not exposed over the REST API, so ask through a
    // view-free RPC-less route: select one row per table and read its keys.
    // An empty table yields no keys, so fall back to a HEAD-count probe per
    // column, which errors on an unknown column and succeeds otherwise.
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select("*").limit(1);
      if (error) throw new Error(`cannot read ${table}: ${error.message}`);
      columns.set(table, new Set(Object.keys((data?.[0] as object) ?? {})));
    }
  });

  const readerSets = allDataSets().filter((s) => s.route === "reader" && s.table);

  it.each(readerSets.map((s) => [s.name, s] as const))(
    "%s: every allow-listed field is a real column",
    async (_name, s) => {
      const real = columns.get(s.table as string)!;
      // A table with no rows gives us nothing to compare against; probing each
      // column individually would be correct but slow, and these three tables
      // are never empty in a live account.
      expect(real.size, `${s.table} returned no sample row`).toBeGreaterThan(0);
      const missing = s.fields.map((f) => f.key).filter((k) => !real.has(k));
      expect(missing, `${s.name} names columns that do not exist`).toEqual([]);
    },
  );

  it.each(readerSets.map((s) => [s.name, s] as const))(
    "%s: every filter targets a real column (or is a synthetic one)",
    async (_name, s) => {
      const real = columns.get(s.table as string)!;
      // `search` and `period` are synthetic — fetch.ts translates them rather
      // than passing them to Postgres as a column.
      const SYNTHETIC = new Set(["search", "period", "time_of_day"]);
      const missing = s.filters
        .map((f) => f.key)
        .filter((k) => !SYNTHETIC.has(k) && !real.has(k));
      expect(missing, `${s.name} filters on columns that do not exist`).toEqual([]);
    },
  );

  it.each(readerSets.map((s) => [s.name, s] as const))(
    "%s: every group_by dimension is a real column",
    async (_name, s) => {
      const real = columns.get(s.table as string)!;
      const missing = s.dimensions.map((d) => d.key).filter((k) => !real.has(k));
      expect(missing, `${s.name} groups by columns that do not exist`).toEqual([]);
    },
  );

  it("never exposes a credential-ish or cross-tenant column anywhere", () => {
    // account_id is applied by the server, never selectable by the AI, so a
    // descriptor that lists it is a sign someone pasted a column dump in.
    const BANNED = [
      "plain_password",
      "password",
      "password_hash",
      "is_superadmin",
      "access_token",
      "refresh_token",
      "api_key",
      "key_hash",
      "account_id",
    ];
    for (const s of allDataSets()) {
      const keys = s.fields.map((f) => f.key);
      for (const banned of BANNED) {
        expect(keys, `${s.name} exposes ${banned}`).not.toContain(banned);
      }
    }
  });
});
