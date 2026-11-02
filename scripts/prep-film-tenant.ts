// ============================================================
// Make one demo tenant ready to film the 37-video programme.
//
//   npx tsx scripts/prep-film-tenant.ts                      dry run — prints the plan
//   npx tsx scripts/prep-film-tenant.ts --apply
//   npx tsx scripts/prep-film-tenant.ts --apply --tenant=sfacrm
//   npx tsx scripts/prep-film-tenant.ts --apply --only=tax,pricelist
//   npx tsx scripts/prep-film-tenant.ts --revert-quotation --apply
//
// WHY THIS EXISTS, AND WHY IT IS NOT PART OF seed-demo-accounts.ts
//
// The four plan-demo tenants already carry twelve months of real transactions —
// on sfacrm (001294) that is ~2,700 orders, ~1,100 payments, ~6,100 visits,
// ~670 leads and ~245 quotations. That is enough to film most of the
// programme. Six things the films need are NOT part of a prospect demo, so
// they are added here rather than in the main seeder:
//
//   tax slabs        B5  — products ship with tax_slab_id NULL
//   a price list     B6 C1 C18 B10 — the hidden-discount-field shot needs one
//   opening stock    A4 B9 — the stock module ships off and the ledger is empty
//   a scheme         B9  — so the Catalogue Settings toggle has something behind it
//   routes           C6  — the route module is on, but no routes exist
//   a quotation v2   C8  — the version panel needs a revised quotation
//   one inactive row C17 — the Re-activate shot needs something deactivated
//
// EVERYTHING HERE IS ADDITIVE. No step hides a screen, blocks an action or
// changes a number a prospect demo already shows. In particular it does NOT
// touch geo-fencing, Multi Unit, GST, Reporting Hierarchy or
// allow_discount_over_price_list — four films switch those ON on camera, and
// the fifth (C18) needs allow_discount_over_price_list to stay OFF, which it
// already is.
//
// Safe to re-run: every step checks for what it already created.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { DEMO_TENANTS, tenantByKey } from "../src/lib/demo/profiles";

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
const TENANT_KEY = argv.find((a) => a.startsWith("--tenant="))?.split("=")[1] ?? "sfacrm";
const ONLY = argv.find((a) => a.startsWith("--only="))?.split("=")[1]?.split(",").map((s) => s.trim());

const ALL_STEPS = ["tax", "pricelist", "stock", "scheme", "routes", "quotation", "inactive"] as const;
type Step = (typeof ALL_STEPS)[number];
const steps: Step[] = (ONLY as Step[] | undefined)?.filter((s) => ALL_STEPS.includes(s)) ?? [...ALL_STEPS];

/** Accounts this script must never touch, whatever else happens. */
const PROTECTED_CUSTOMER_IDS = new Set(["001001", "001288"]);

const log = (m: string) => console.log(m);
const note = (m: string) => console.log(`      ${m}`);

/** Deterministic pseudo-random, so a re-run produces the same numbers. */
let seed = 0x9e3779b9;
function rnd(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
}
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

// The Supabase builder's inferred types do not survive the `as any` casts the
// seeder family uses, so the type parameter is supplied at each call site.
async function must<T = any>(
  what: string,
  p: PromiseLike<{ data: any; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T;
}

async function insertChunked(table: string, rows: Record<string, unknown>[], size = 400) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

// ── Resolve the tenant, and refuse anything else ────────────

interface Target {
  accountId: string;
  customerId: string;
  name: string;
  plan: string;
  moduleSettings: Record<string, boolean>;
}

async function resolveTenant(key: string): Promise<Target> {
  const t = tenantByKey(key);
  if (!t) {
    throw new Error(`unknown tenant key "${key}". Known: ${DEMO_TENANTS.map((d) => d.key).join(", ")}`);
  }

  const prof = await must<{ account_id: string } | null>(
    "find admin profile",
    db
      .from("profiles")
      .select("account_id")
      .eq("email", t.adminEmail)
      .maybeSingle() as any,
  );
  if (!prof?.account_id) throw new Error(`tenant ${key} has not been seeded yet — run seed-demo-accounts.ts first`);

  const acct = await must<{
    id: string;
    customer_id: string;
    name: string;
    subscription_plan: string;
    module_settings: Record<string, boolean> | null;
  }>(
    "read account",
    db
      .from("accounts")
      .select("id, customer_id, name, subscription_plan, module_settings")
      .eq("id", prof.account_id)
      .single() as any,
  );

  if (PROTECTED_CUSTOMER_IDS.has(acct.customer_id)) {
    throw new Error(
      `REFUSING: tenant key "${key}" resolved to protected account ${acct.customer_id} (${acct.name}). ` +
        `This script never writes to the founder's account or the Play Console tenant.`,
    );
  }

  return {
    accountId: acct.id,
    customerId: acct.customer_id,
    name: acct.name,
    plan: acct.subscription_plan,
    moduleSettings: (acct.module_settings ?? {}) as Record<string, boolean>,
  };
}

// ── Step 1: tax slabs, and put every product on one ─────────
// B5. Products are seeded with tax_slab_id NULL, so the tax story has nothing
// behind it and the "Apply to all untaxed" button has nothing to apply.

const SLABS = [
  { name: "GST 5%", rate: 5, position: 1, is_default: false },
  { name: "GST 12%", rate: 12, position: 2, is_default: false },
  { name: "GST 18%", rate: 18, position: 3, is_default: true },
];

async function stepTax(t: Target) {
  const existing = await must(
    "read tax slabs",
    db.from("tax_slabs").select("id, name, rate").eq("account_id", t.accountId) as any,
  );

  let slabs = existing as { id: string; name: string; rate: number }[];
  if (slabs.length === 0) {
    note(`create ${SLABS.length} tax slabs: ${SLABS.map((s) => s.name).join(", ")}`);
    if (APPLY) {
      slabs = (await must(
        "insert tax slabs",
        db
          .from("tax_slabs")
          .insert(SLABS.map((s) => ({ ...s, account_id: t.accountId })))
          .select("id, name, rate") as any,
      )) as any;
    }
  } else {
    note(`tax slabs already exist (${slabs.length}) — leaving them`);
  }

  const products = await must(
    "read products",
    db.from("products").select("id, name, price, tax_slab_id").eq("account_id", t.accountId) as any,
  );
  const untaxed = (products as any[]).filter((p) => !p.tax_slab_id);
  note(`${untaxed.length} of ${(products as any[]).length} products have no tax slab`);

  if (!APPLY || untaxed.length === 0 || slabs.length === 0) return;

  const byRate = (r: number) => slabs.find((s) => Number(s.rate) === r)?.id ?? slabs[0].id;
  // Price band → slab. A real catalogue is not all on one rate, and the Order
  // grid's TAX column reads as fake when every line shows the same number.
  for (const p of untaxed) {
    const price = Number(p.price) || 0;
    const slabId = price < 300 ? byRate(5) : price < 600 ? byRate(12) : byRate(18);
    const { error } = await db.from("products").update({ tax_slab_id: slabId }).eq("id", p.id);
    if (error) throw new Error(`product ${p.name} tax slab: ${error.message}`);
  }
  note(`assigned slabs by price band (<300 → 5%, <600 → 12%, else 18%)`);
}

// ── Step 2: a price list, attached to some customers ────────
// B6, B10, C1, C18. The hidden-discount-field shot needs a customer ON a price
// list while allow_discount_over_price_list is off — and a customer NOT on one
// for the contrast, which is why only a slice gets attached.

const PRICE_LIST_NAME = "Dealer Rate — Saurashtra";
const ATTACH_COUNT = 12;

async function stepPriceList(t: Target) {
  let list = (await must(
    "read price lists",
    db
      .from("price_lists")
      .select("id, name")
      .eq("account_id", t.accountId)
      .eq("name", PRICE_LIST_NAME)
      .maybeSingle() as any,
  )) as { id: string; name: string } | null;

  if (!list) {
    note(`create price list "${PRICE_LIST_NAME}" with a 6% blanket discount`);
    if (APPLY) {
      list = (await must(
        "insert price list",
        db
          .from("price_lists")
          .insert({
            account_id: t.accountId,
            name: PRICE_LIST_NAME,
            blanket_discount_percent: 6,
            active: true,
            is_active: true,
          })
          .select("id, name")
          .single() as any,
      )) as any;
    }
  } else {
    note(`price list "${PRICE_LIST_NAME}" already exists — leaving it`);
  }

  const products = await must(
    "read products",
    db.from("products").select("id, name").eq("account_id", t.accountId).order("name").limit(6) as any,
  );

  if (list) {
    const have = await must(
      "read price list items",
      db.from("price_list_items").select("product_id").eq("price_list_id", list.id) as any,
    );
    const haveIds = new Set((have as any[]).map((r) => r.product_id));
    const pcts = [10, 12, 8, 15, 9];
    // Cap at a TOTAL of five, not five more per run.
    const room = Math.max(0, pcts.length - haveIds.size);
    const toAdd = (products as any[]).filter((p) => !haveIds.has(p.id)).slice(0, room);
    note(
      toAdd.length
        ? `add ${toAdd.length} per-product overrides (so override-beats-blanket is demonstrable)`
        : `${haveIds.size} per-product overrides already present — leaving them`,
    );
    if (APPLY && toAdd.length) {
      await insertChunked(
        "price_list_items",
        toAdd.map((p, i) => ({
          price_list_id: list!.id,
          product_id: p.id,
          discount_percent: pcts[i % pcts.length],
        })),
      );
    }
  }

  // Attach to a slice of customers, deliberately not all of them.
  const contacts = await must(
    "read contacts",
    db
      .from("contacts")
      .select("id, name, price_list_id")
      .eq("account_id", t.accountId)
      .eq("is_active", true)
      .order("name") as any,
  );
  const already = (contacts as any[]).filter((c) => c.price_list_id).length;
  // ATTACH_COUNT is a TOTAL, not a per-run quota. Without this a second run
  // attaches another twelve customers, and a third another twelve, until
  // nobody is left on catalogue price and the C18 contrast is gone.
  const room = Math.max(0, ATTACH_COUNT - already);
  const unattached = (contacts as any[]).filter((c) => !c.price_list_id).slice(0, room);
  note(
    room === 0
      ? `${already} customers already on a price list — leaving them`
      : `attach the list to ${unattached.length} more customers (${already} already on one, ${(contacts as any[]).length} total)`,
  );

  if (!APPLY || !list || unattached.length === 0) return;
  for (const c of unattached) {
    const { error } = await db.from("contacts").update({ price_list_id: list.id }).eq("id", c.id);
    if (error) throw new Error(`contact ${c.name} price list: ${error.message}`);
  }
  note(`left the other ${(contacts as any[]).length - unattached.length - already} on "Catalogue price" for the C18 contrast`);
}

// ── Step 3: opening stock and a used-looking ledger ─────────
// A4, B9, and the Stock screens. Closing stock is derived from the ledger, so
// opening rows alone would read "nothing has ever been sold".

async function stepStock(t: Target) {
  if (!t.moduleSettings.stock) {
    note(`switch the stock module ON (it ships off)`);
    if (APPLY) {
      const { error } = await db
        .from("accounts")
        .update({ module_settings: { ...t.moduleSettings, stock: true } })
        .eq("id", t.accountId);
      if (error) throw new Error(`stock module toggle: ${error.message}`);
      t.moduleSettings.stock = true;
    }
  } else {
    note(`stock module already on`);
  }

  const have = await must(
    "read stock ledger",
    db.from("stock_ledger").select("id").eq("account_id", t.accountId).limit(1) as any,
  );
  if ((have as any[]).length) {
    note(`stock ledger already has rows — leaving it alone`);
    return;
  }

  const products = await must(
    "read products",
    db.from("products").select("id, name").eq("account_id", t.accountId) as any,
  );
  const list = products as { id: string; name: string }[];

  const rows: Record<string, unknown>[] = [];
  const openings: { id: string; qty: number }[] = [];
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  for (const p of list) {
    const opening = between(6, 24) * 50; // 300 – 1200, in clean fifties

    // The opening row is NOT inserted by hand. `stock_sync_opening` owns it:
    // the trigger writes one opening row per product from products.opening_stock,
    // and DELETES that row whenever track_stock is false or opening_stock is
    // null/0. A hand-written opening row therefore disappears the next time
    // anyone edits the product. Set the product fields and let the trigger post.
    openings.push({ id: p.id, qty: opening });

    // Sell 50–80% of it away across the year, in a handful of movements, so
    // Opening / Out / Closing all read as a business that has been trading.
    const sellTotal = Math.round(opening * (0.5 + rnd() * 0.3));
    let left = sellTotal;
    const moves = between(4, 8);
    for (let i = 0; i < moves && left > 0; i++) {
      const q = i === moves - 1 ? left : Math.max(1, Math.round(left / (moves - i) * (0.6 + rnd() * 0.8)));
      const take = Math.min(q, left);
      left -= take;
      rows.push({
        account_id: t.accountId,
        product_id: p.id,
        quantity: -take,
        entry_type: "sale_out",
        source_type: "order",
        posted_mode: "order_created",
        created_at: daysAgo(between(5, 290)),
      });
    }
  }

  // A little honest wastage on three products, so the ledger is not uniform
  // and the "a wrong closing figure is a missing movement" story has texture.
  for (const p of list.slice(0, 3)) {
    rows.push({
      account_id: t.accountId,
      product_id: p.id,
      quantity: -between(2, 9),
      entry_type: "manual_out",
      source_type: "manual",
      reason_code: "Damage",
      notes: "Breakage in transit",
      created_at: daysAgo(between(20, 120)),
    });
  }

  note(`set opening_stock + track_stock on ${openings.length} products (the trigger posts the opening rows)`);
  note(`post ${rows.length} movement rows (sales + 3 damage)`);
  if (!APPLY) return;

  for (const o of openings) {
    const { error } = await db
      .from("products")
      .update({ track_stock: true, opening_stock: o.qty })
      .eq("id", o.id);
    if (error) throw new Error(`product opening stock: ${error.message}`);
  }
  await insertChunked("stock_ledger", rows);
}

// ── Step 4: one scheme, so the toggle has something behind it ──

const SCHEME_NAME = "Diwali Volume Scheme";

async function stepScheme(t: Target) {
  if (!t.moduleSettings.scheme) {
    note(`switch the scheme module ON (it ships off)`);
    if (APPLY) {
      const { error } = await db
        .from("accounts")
        .update({ module_settings: { ...t.moduleSettings, scheme: true } })
        .eq("id", t.accountId);
      if (error) throw new Error(`scheme module toggle: ${error.message}`);
      t.moduleSettings.scheme = true;
    }
  } else {
    note(`scheme module already on`);
  }

  const existing = await must(
    "read schemes",
    db.from("schemes").select("id").eq("account_id", t.accountId).eq("name", SCHEME_NAME).maybeSingle() as any,
  );
  if (existing) {
    note(`scheme "${SCHEME_NAME}" already exists — leaving it`);
    return;
  }

  note(`create scheme "${SCHEME_NAME}" (quantity slab, step up, all customers) with two slabs`);
  if (!APPLY) return;

  const scheme = (await must(
    "insert scheme",
    db
      .from("schemes")
      .insert({
        account_id: t.accountId,
        name: SCHEME_NAME,
        scheme_type: "quantity_slab",
        slab_mode: "step_up",
        target_type: "all",
        qty_unit_basis: "base",
        priority: 1,
        // starts_on is NOT NULL. A scheme with no window would also never be
        // picked up by the pricing engine, so give it a live one.
        starts_on: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
        ends_on: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
        active: true,
        is_active: true,
      })
      .select("id")
      .single() as any,
  )) as { id: string };

  await insertChunked("scheme_slabs", [
    { scheme_id: scheme.id, min_qty: 10, max_qty: 24, min_value: null, max_value: null, reward_type: "discount_percent", reward_value: 4, free_product_id: null, free_qty: null },
    { scheme_id: scheme.id, min_qty: 25, max_qty: null, min_value: null, max_value: null, reward_type: "discount_percent", reward_value: 7, free_product_id: null, free_qty: null },
  ]);
}

// ── Step 5: routes, including one Draft and one archived ────
// C6. The route module is already on for this tenant but no routes exist, so
// the Draft-vs-"Inbox Zero" shot — the whole point of the film — is unfilmable.

const ROUTE_NAMES = [
  "Monday Beat — Main Bazaar",
  "Tuesday Beat — Ring Road",
  "Wednesday Beat — Industrial Area",
  "Thursday Beat — Station Road",
  "Friday Beat — Highway Dealers",
];

async function stepRoutes(t: Target) {
  // Resumable by name rather than all-or-nothing: a partial run (one route
  // created, its customers rejected) must be completable without deleting
  // anything a prospect demo might already be using.
  const existing = (await must(
    "read routes",
    db.from("routes").select("id, name").eq("account_id", t.accountId) as any,
  )) as { id: string; name: string }[];
  const byName = new Map(existing.map((r) => [r.name, r.id]));

  const reps = (await must(
    "read reps",
    db
      .from("profiles")
      .select("id, full_name")
      .eq("account_id", t.accountId)
      .eq("account_role", "agent")
      .eq("status", "active")
      .order("employee_code") as any,
  )) as { id: string; full_name: string }[];

  if (reps.length === 0) {
    note(`no agent profiles found — skipping routes`);
    return;
  }

  // Two different id spaces on the same table, and mixing them is silent:
  //   routes.created_by          = auth.users id  (the column defaults to auth.uid())
  //   routes.primary_assignee_id = profiles.id
  // Route EXECUTIONS key the auth user id again, while plan assignments key
  // profiles.id. Read the owner's auth id rather than reusing a profile id.
  const owner = (await must(
    "read owner auth id",
    db
      .from("profiles")
      .select("user_id")
      .eq("account_id", t.accountId)
      .eq("account_role", "owner")
      .limit(1)
      .single() as any,
  )) as { user_id: string };

  const contacts = (await must(
    "read contacts",
    db
      .from("contacts")
      .select("id, employee_id")
      .eq("account_id", t.accountId)
      .eq("is_active", true) as any,
  )) as { id: string; employee_id: string | null }[];

  // `uq_route_customers_one_active_route` is a partial unique index on
  // (account_id, contact_id) WHERE archived_at IS NULL: a customer belongs to
  // at most one NON-ARCHIVED route. So the allocator must never hand the same
  // contact to two live routes, and the archived route's rows carry
  // archived_at themselves rather than relying on the route's own flag.
  const taken = new Set(
    (
      (await must(
        "read existing route customers",
        db
          .from("route_customers")
          .select("contact_id")
          .eq("account_id", t.accountId)
          .is("archived_at", null) as any,
      )) as { contact_id: string }[]
    ).map((r) => r.contact_id),
  );

  const plan: {
    name: string;
    status: string;
    assignee: string;
    archived: boolean;
    want: number;
    dow: number;
  }[] = reps.map((rep, i) => ({
    name: ROUTE_NAMES[i % ROUTE_NAMES.length],
    status: "active",
    assignee: rep.id,
    archived: false,
    want: between(8, 14),
    dow: (i % 6) + 1,
  }));

  // One Draft, with no plan assignment. This is the C6 shot: a Draft row
  // carrying an Approve button while the Manager Inbox reads "Inbox Zero".
  plan.push({
    name: "Saturday Beat — New Market (draft)",
    status: "draft",
    assignee: reps[0].id,
    archived: false,
    want: between(6, 9),
    dow: 6,
  });

  // One archived, so the Archived tab is not empty.
  plan.push({
    name: "Old Beat — City Centre",
    status: "active",
    assignee: reps[reps.length - 1].id,
    archived: true,
    want: 6,
    dow: 2,
  });

  const missing = plan.filter((p) => !byName.has(p.name));
  note(
    `${existing.length} routes already exist; creating ${missing.length}` +
      (missing.length ? ` (${missing.map((m) => m.name.split(" — ")[0]).join(", ")})` : ""),
  );

  // Fill customers for any route that has none — covers a half-finished run.
  const needCustomers: { id: string; p: (typeof plan)[number] }[] = [];
  for (const p of plan) {
    const id = byName.get(p.name);
    if (!id) continue;
    const have = await must(
      "count route customers",
      db.from("route_customers").select("id").eq("route_id", id).limit(1) as any,
    );
    if ((have as any[]).length === 0) needCustomers.push({ id, p });
  }
  if (needCustomers.length) {
    note(`${needCustomers.length} existing route(s) have no customers yet — filling them`);
  }
  if (!APPLY) return;

  /** Hand out contacts nobody live is using. Prefers the rep's own customers. */
  function allocate(assignee: string, want: number, archived: boolean): string[] {
    if (archived) {
      // Archived rows are outside the unique index, so they may reuse anyone.
      return contacts.slice(0, want).map((c) => c.id);
    }
    const mine = contacts.filter((c) => c.employee_id === assignee && !taken.has(c.id));
    const rest = contacts.filter((c) => c.employee_id !== assignee && !taken.has(c.id));
    const chosen = [...mine, ...rest].slice(0, want);
    for (const c of chosen) taken.add(c.id);
    return chosen.map((c) => c.id);
  }

  async function writeCustomers(routeId: string, p: (typeof plan)[number]) {
    const ids = allocate(p.assignee, p.want, p.archived);
    if (ids.length === 0) {
      note(`no free customers left for "${p.name}" — created with none`);
      return;
    }
    await insertChunked(
      "route_customers",
      ids.map((cid, idx) => ({
        account_id: t.accountId,
        route_id: routeId,
        contact_id: cid,
        sequence: idx + 1,
        must_visit: idx < 3,
        archived_at: p.archived ? new Date(Date.now() - 40 * 86_400_000).toISOString() : null,
      })),
    );
  }

  for (const { id, p } of needCustomers) await writeCustomers(id, p);

  for (const p of missing) {
    const route = (await must(
      `insert route ${p.name}`,
      db
        .from("routes")
        .insert({
          account_id: t.accountId,
          name: p.name,
          description: p.status === "draft" ? "Drafted, not yet sent for approval" : "Weekly beat",
          primary_assignee_id: p.assignee,
          // auth.users id, not profiles.id — see the note above.
          created_by: owner.user_id,
          status: p.status,
          version: p.status === "draft" ? 0 : 1,
          archived_at: p.archived ? new Date(Date.now() - 40 * 86_400_000).toISOString() : null,
        })
        .select("id")
        .single() as any,
    )) as { id: string };

    await writeCustomers(route.id, p);

    if (p.status === "active" && !p.archived) {
      // assignee_id here is profiles.id — route EXECUTIONS key the auth user id
      // instead, and the two are different columns on purpose.
      await insertChunked("route_plan_assignments", [
        {
          account_id: t.accountId,
          route_id: route.id,
          assignee_id: p.assignee,
          day_of_week: p.dow,
          start_date: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
          end_date: null,
          is_active: true,
        },
      ]);
    }
  }
}

// ── Step 6: revise one quotation, so the version panel works ──
// C8. Quotations carry version / parent_id / is_latest_version, but every
// seeded quotation is a lone v1.

async function stepQuotation(t: Target) {
  const revised = await must(
    "look for an existing v2",
    db.from("quotations").select("id").eq("account_id", t.accountId).gt("version", 1).limit(1) as any,
  );
  if ((revised as any[]).length) {
    note(`a revised quotation already exists — leaving it`);
    return;
  }

  const base = (await must(
    "pick a quotation to revise",
    db
      .from("quotations")
      .select("*")
      .eq("account_id", t.accountId)
      .eq("is_active", true)
      .eq("version", 1)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle() as any,
  )) as Record<string, any> | null;

  if (!base) {
    note(`no quotation to revise — skipping`);
    return;
  }

  note(`revise quotation ${base.quotation_number} into version two (5% lower, dated today)`);
  if (!APPLY) return;

  const items = (await must(
    "read quotation items",
    db.from("quotation_items").select("*").eq("quotation_id", base.id) as any,
  )) as Record<string, any>[];

  const factor = 0.95;
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = base;
  const v2 = (await must(
    "insert quotation v2",
    db
      .from("quotations")
      .insert({
        ...rest,
        version: 2,
        parent_id: base.id,
        is_latest_version: true,
        date: new Date().toISOString().slice(0, 10),
        sub_total: Math.round(Number(base.sub_total) * factor),
        tax_total: Math.round(Number(base.tax_total) * factor),
        total_amount: Math.round(Number(base.total_amount) * factor),
        terms_conditions: base.terms_conditions,
      })
      .select("id")
      .single() as any,
  )) as { id: string };

  if (items.length) {
    await insertChunked(
      "quotation_items",
      items.map((it) => {
        const { id: _i, created_at: _cc, quotation_id: _q, ...keep } = it;
        const price = Number(keep.price) * factor;
        return {
          ...keep,
          quotation_id: v2.id,
          price: Math.round(price * 100) / 100,
          sub_total: Math.round(Number(keep.sub_total) * factor * 100) / 100,
          total: Math.round(Number(keep.total) * factor * 100) / 100,
          tax_amount: Math.round(Number(keep.tax_amount ?? 0) * factor * 100) / 100,
        };
      }),
    );
  }

  const { error } = await db.from("quotations").update({ is_latest_version: false }).eq("id", base.id);
  if (error) throw new Error(`demote v1: ${error.message}`);
  note(`v1 kept, marked not-latest — both versions now show in the panel`);
}

// ── Step 7: one deactivated customer, for the C17 shot ──────

async function stepInactive(t: Target) {
  const already = await must(
    "look for an inactive contact",
    db.from("contacts").select("id, name").eq("account_id", t.accountId).eq("is_active", false).limit(1) as any,
  );
  if ((already as any[]).length) {
    note(`an inactive customer already exists (${(already as any[])[0].name}) — leaving it`);
    return;
  }

  // Deliberately one with no orders against it, so deactivating it cannot
  // change any figure a prospect demo shows.
  const contacts = (await must(
    "read contacts",
    db
      .from("contacts")
      .select("id, name")
      .eq("account_id", t.accountId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(25) as any,
  )) as { id: string; name: string }[];

  let chosen: { id: string; name: string } | null = null;
  for (const c of contacts) {
    const orders = await must(
      "count orders for contact",
      db.from("orders").select("id").eq("account_id", t.accountId).eq("contact_id", c.id).limit(1) as any,
    );
    if ((orders as any[]).length === 0) {
      chosen = c;
      break;
    }
  }
  if (!chosen) {
    note(`every recent customer has orders — skipping rather than touching a figure`);
    return;
  }

  note(`deactivate customer "${chosen.name}" (no orders against it) for the Re-activate shot`);
  if (!APPLY) return;
  const { error } = await db.from("contacts").update({ is_active: false }).eq("id", chosen.id);
  if (error) throw new Error(`deactivate ${chosen.name}: ${error.message}`);
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const t = await resolveTenant(TENANT_KEY);

  log("");
  log(`  Film prep — ${t.name}  (Customer ID ${t.customerId}, plan ${t.plan})`);
  log(`  Mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}`);
  log(`  Steps: ${steps.join(", ")}`);
  log("");

  const runners: Record<Step, (t: Target) => Promise<void>> = {
    tax: stepTax,
    pricelist: stepPriceList,
    stock: stepStock,
    scheme: stepScheme,
    routes: stepRoutes,
    quotation: stepQuotation,
    inactive: stepInactive,
  };

  for (const s of steps) {
    log(`  [${s}]`);
    await runners[s](t);
    log("");
  }

  if (!APPLY) {
    log("  Nothing was written. Re-run with --apply.");
  } else {
    log("  Done.");
    log("");
    log("  Still to do on camera, deliberately NOT pre-set here:");
    log("    • Geo-fencing (B8 films the toggle being switched on)");
    log("    • Multi Unit (B5 films it)");
    log("    • GST / HSN (C11 films it)");
    log("    • Reporting Hierarchy (B9 explains it; switching it on changes what reps see)");
    log("    • allow_discount_over_price_list stays OFF — C18 and B6 need it off");
  }
  log("");
}

main().catch((e) => {
  console.error(`\n  FAILED: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
