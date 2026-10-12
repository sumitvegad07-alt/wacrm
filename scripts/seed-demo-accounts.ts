// ============================================================
// Build the four plan-demo tenants: WFA, SFA, CRM+WFA, CRM+SFA.
//
//   npx tsx scripts/seed-demo-accounts.ts                  dry run — prints the plan
//   npx tsx scripts/seed-demo-accounts.ts --apply          build everything
//   npx tsx scripts/seed-demo-accounts.ts --apply --only=sfa
//   npx tsx scripts/seed-demo-accounts.ts --apply --months=12
//   npx tsx scripts/seed-demo-accounts.ts --refresh-now    trim today to the clock
//   npx tsx scripts/seed-demo-accounts.ts --teardown --apply
//
// Each tenant gets one admin login (web) and five sales-executive logins
// (mobile only), plus twelve months of history so every dashboard tile and
// every trend chart has something real in it.
//
// Safe to re-run: every phase checks for what it already created. Nothing
// outside the four demo accounts is read or written — the guard below refuses
// to run if a demo email resolves to the founder's own tenant or the Play
// Console one.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { DEMO_TENANTS, PASSWORD, REP_NAMES, repEmail } from "../src/lib/demo/profiles";
import { addDays, istToday, ymd } from "../src/lib/demo/ist";
import {
  buildTenantStructure,
  clearSeedNoise,
  setBulkLoadMode,
  purgeOrphanDemoLogins,
  teardownTenant,
} from "../src/lib/demo/tenant";
import { generateHistory } from "../src/lib/demo/history";
import { PING_DAYS, nowCutoff, refreshTenantToday } from "../src/lib/demo/refresh";

// ── Env ─────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function loadEnv(file: string) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(".env.local");
loadEnv(".env");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Vercel names the key `service_role`; locally it is usually the long form.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.service_role;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Flags ───────────────────────────────────────────────────

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const TEARDOWN = argv.includes("--teardown");
const REFRESH_NOW = argv.includes("--refresh-now");
const FORCE_HISTORY = argv.includes("--force-history");
const ONLY = argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const MONTHS = Number(argv.find((a) => a.startsWith("--months="))?.split("=")[1] ?? 12);

/** Accounts this script must never touch, whatever else happens. */
const PROTECTED_CUSTOMER_IDS = new Set(["001001", "001288"]);

const log = (msg: string) => console.log(msg);

const selected = ONLY ? DEMO_TENANTS.filter((t) => t.key === ONLY) : DEMO_TENANTS;
if (ONLY && selected.length === 0) {
  console.error(`Unknown --only=${ONLY}. Valid keys: ${DEMO_TENANTS.map((t) => t.key).join(", ")}`);
  process.exit(1);
}

// ── Safety guard ────────────────────────────────────────────

/**
 * Refuse to run if any demo email already belongs to a protected account.
 * A typo in an email would otherwise point this script at a real tenant and
 * bulk-insert a year of invented data into it.
 */
async function assertSafe(): Promise<void> {
  const emails = selected.flatMap((t) => [
    t.adminEmail,
    ...REP_NAMES.map((r) => repEmail(r.first, t.key)),
  ]);

  const { data, error } = await db
    .from("profiles")
    .select("email, account_id, accounts(customer_id, name)")
    .in("email", emails);

  if (error) throw new Error(`safety check failed: ${error.message}`);

  for (const row of (data ?? []) as any[]) {
    const cid = row.accounts?.customer_id;
    if (cid && PROTECTED_CUSTOMER_IDS.has(cid)) {
      throw new Error(
        `REFUSING TO RUN: ${row.email} belongs to protected account ${cid} (${row.accounts?.name}).`,
      );
    }
  }
  log(`  safety check passed (${(data ?? []).length} of ${emails.length} demo logins already exist)`);
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const today = istToday();
  // A 12-month window ending today fills the Daily (30 bucket) and Monthly
  // (12 bucket) lenses completely and gives Quarterly 4–5 real bars.
  const firstDay = addDays(today, -Math.round(MONTHS * 30.44) + 1);
  const years = Array.from(new Set([firstDay.y, today.y]));

  console.log("");
  console.log("OZZO demo tenants");
  console.log("─".repeat(60));
  console.log(`target     ${SUPABASE_URL}`);
  console.log(`tenants    ${selected.map((t) => `${t.key} (${t.plan})`).join(", ")}`);
  console.log(`history    ${ymd(firstDay)} → ${ymd(today)}  (${MONTHS} months)`);
  console.log(`raw GPS    last ${PING_DAYS} days only; daily summaries for the whole window`);
  console.log(`mode       ${TEARDOWN ? "TEARDOWN" : REFRESH_NOW ? "REFRESH TODAY" : "BUILD"}${APPLY ? "" : "  (dry run)"}`);
  console.log("─".repeat(60));

  if (!APPLY) {
    console.log("");
    for (const t of selected) {
      console.log(`${t.key.padEnd(8)} ${t.company}`);
      console.log(`         plan ${t.plan} · ${t.industry}`);
      console.log(`         admin  ${t.adminEmail} / ${PASSWORD}`);
      console.log(`         reps   ${REP_NAMES.map((r) => repEmail(r.first, t.key)).join(", ")}`);
      console.log(`         cities ${t.cities.map((c) => c.city).join(", ")}`);
      console.log("");
    }
    console.log("DRY RUN — nothing was written. Add --apply to run for real.");
    return;
  }

  log("");
  log("Safety");
  await assertSafe();

  if (TEARDOWN) {
    log("");
    log("Teardown");
    for (const t of selected) {
      await teardownTenant(db, t, log);
    }
    // Sweep any login left without a profile, so the next build can reuse the
    // email instead of silently coming out without an admin.
    const emails = selected.flatMap((t) => [
      t.adminEmail,
      ...REP_NAMES.map((r) => repEmail(r.first, t.key)),
    ]);
    const purged = await purgeOrphanDemoLogins(db, emails, log);
    if (purged) log(`  purged ${purged} orphaned login(s)`);
    log("");
    log("Done.");
    return;
  }

  if (REFRESH_NOW) {
    log("");
    log(`Refreshing today, cut off at the current IST clock`);
    for (const t of selected) {
      await refreshTenantToday(db, t, { cutoffMinutes: nowCutoff(), log });
    }
    log("");
    log("Done.");
    return;
  }

  const started = Date.now();

  for (const t of selected) {
    log("");
    log(`${t.key} — ${t.company} (${t.plan})`);
    log("─".repeat(60));

    const built = await buildTenantStructure(db, t, years, { firstDay, lastDay: today }, log);

    // The structure phases are each idempotent; the history pass is not — it
    // would simply add a second year on top of the first. So it is skipped if
    // anything is already there, and --force-history is the deliberate override
    // (pair it with --teardown for a clean rebuild).
    const { count: existingVisits } = await db
      .from("site_visits")
      .select("*", { count: "exact", head: true })
      .eq("account_id", built.accountId);

    if ((existingVisits ?? 0) > 0 && !FORCE_HISTORY) {
      log(`  history: already present (${existingVisits} visits) — skipping.`);
      log(`           pass --force-history to add more, or --teardown first for a clean rebuild.`);
      continue;
    }

    // The credit-limit trigger writes a module_activities warning per order
    // that takes a customer past their limit — thousands of rows across a
    // 12-month backfill. Silenced for the load, restored to `warn` after.
    await setBulkLoadMode(db, built.accountId, true);
    try {
      log(`  history`);
      const counts = await generateHistory(db, built, {
        window: { firstDay, lastDay: today },
        pingDays: PING_DAYS,
        cutoffMinutes: null,
        backfill: true,
        log,
      });
      for (const [table, n] of Object.entries(counts).sort()) {
        log(`    ${table.padEnd(26)} ${n}`);
      }
    } finally {
      await setBulkLoadMode(db, built.accountId, false);
    }

    log(`  clearing notification noise`);
    await clearSeedNoise(db, built.accountId, log);
  }

  log("");
  log("─".repeat(60));
  log(`Built ${selected.length} tenant(s) in ${Math.round((Date.now() - started) / 1000)}s`);
  log("");
  log("Logins (password 123456 for every one)");
  log("─".repeat(60));
  for (const t of selected) {
    log(`${t.company}  —  ${t.plan}`);
    log(`  admin (web)   ${t.adminEmail}`);
    for (let i = 0; i < REP_NAMES.length; i++) {
      log(`  ${REP_NAMES[i].full.padEnd(16)} ${repEmail(REP_NAMES[i].first, t.key).padEnd(28)} (mobile only, ${t.cities[i].city})`);
    }
    log("");
  }
}

main().catch((err) => {
  console.error("");
  console.error(`✗ ${err.message ?? err}`);
  if (err.stack) console.error(err.stack.split("\n").slice(1, 4).join("\n"));
  process.exit(1);
});
