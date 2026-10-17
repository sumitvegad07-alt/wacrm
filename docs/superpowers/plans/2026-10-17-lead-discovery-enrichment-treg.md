# Lead Discovery Enrichment (treg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a harvested company row (name, switchboard phone, website) into a named decision-maker with a verified email and an HLR-checked mobile, using treg.to's routed cheapest-first provider waterfall, as a background job that survives a closed tab.

**Architecture:** A second deliberate step after a Google Maps harvest, not part of it. `re_enrich_runs` is the job row, worked by chained serverless workers using the exact `next_index` / `heartbeat_at` / single-use `worker_token` pattern already proved by Lead Discovery. All treg traffic goes through one client that enforces a per-run spend ceiling before each call and writes a receipt row for every call it makes.

**Tech Stack:** Next.js App Router (server routes with `after()`), TypeScript, Supabase/Postgres via service-role client, vitest.

**Spec:** [`docs/engineering/specifications/lead-discovery-enrichment-treg-v1.md`](../../engineering/specifications/lead-discovery-enrichment-treg-v1.md)

## Global Constraints

- **treg base URL** is `https://treg.to`; catalogue calls are `POST|GET /call/<endpoint-id>`.
- **Auth header** is `X-Treg-Token: $TREG_TOKEN`. Not `Authorization`.
- **Every call sends** `X-Treg-Route-Max-Cost`, a deterministic `Idempotency-Key` of `<runId>:<leadId>:<step>`, and `X-Treg-Meta: feature=enrich,run=<runId>`.
- **Every call reads** `X-Treg-Cost-Micro` for the charge — never the provider's own response body — plus `X-Treg-Call-Id`, `X-Treg-Served-By`, `X-Treg-Cache`.
- **treg's default routed cap is $1 per call.** No routed call may be made without an explicit lower cap.
- **All money is stored as integer micro-USD.** No floats, no rupees in the database. Rupees are display-only, via one hardcoded `USD_INR` constant.
- **402 and 422 responses are uncharged.** Record them as `uncharged` and move on; never abort the run.
- **429 falls through, never retries.** Record as `rate_limited`.
- **Only `output.verified: true` means a mailbox was checked.** `catch_all` is not `valid` and never counts as deliverable.
- **Mobiles are stored digits-only as `91XXXXXXXXXX`** to match `normalizePhone()` and to stop Excel reading a leading `+` as a formula.
- **New tables are RLS on, zero policies, service-role only**, like `re_discovery_*`.
- **Supabase MCP cannot reach production.** Migrations are handed to the founder to run; verification reads go through PostgREST with the service key.
- Route lives behind `requireFounder()`. Worker routes set `export const maxDuration = 300`.

---

### Task 0: The spike that gates this plan

**Nothing below this task is built until this task's numbers are in.** The chosen shape — name, email and mobile in one pass — is dominated by mobile cost, and every provider behind treg is US/UK/EU-first.

**Files:**
- Create: `scripts/spike-treg-enrich.mjs` (throwaway, never imported, deleted in Task 1)

**Interfaces:**
- Consumes: nothing.
- Produces: four measured rates, pasted into this plan's Task 3 price assumptions and into the spec. No code survives.

- [ ] **Step 1: Get a treg token**

Sign up at https://treg.to. The first $1 is free, no subscription. Put it in `wacrm-web/.env.local`:

```
TREG_TOKEN=...
```

- [ ] **Step 2: Write the spike script**

Reads 20 rows from production (10 Beverages, 10 Seeds — all 223 enrichable rows are Gujarat, so that is the whole available spread), runs the five-step waterfall against each, prints a table.

```js
// scripts/spike-treg-enrich.mjs — THROWAWAY. Delete after reading the numbers.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);

const TREG = env.TREG_TOKEN;
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!TREG) throw new Error("TREG_TOKEN missing from .env.local");

function apex(website) {
  if (!website) return null;
  let h = website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  h = h.split(/[/?#]/)[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return null;
  if (/^(gmail|yahoo|ymail|hotmail|outlook|rediffmail|protonmail)\./.test(h)) return null;
  return h;
}

async function rows(industry) {
  const url = `${SB}/rest/v1/re_discovery_leads?select=id,name,website,industry&website=neq.&industry=eq.${encodeURIComponent(industry)}&limit=10`;
  const r = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.json();
}

let spentMicro = 0;
async function treg(endpointId, { body, query, maxCostUsd }) {
  const qs = query ? "?" + new URLSearchParams(query) : "";
  const res = await fetch(`https://treg.to/call/${endpointId}${qs}`, {
    method: body ? "POST" : "GET",
    headers: {
      "X-Treg-Token": TREG,
      "X-Treg-Route-Max-Cost": String(maxCostUsd),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  });
  const cost = Number(res.headers.get("X-Treg-Cost-Micro") ?? 0);
  spentMicro += cost;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  return { status: res.status, servedBy: res.headers.get("X-Treg-Served-By"), cost, data };
}

const tally = { rows: 0, person: 0, email: 0, valid: 0, mobile: 0 };

for (const industry of ["Beverages & soft drinks", "Seeds"]) {
  for (const row of await rows(industry)) {
    const domain = apex(row.website);
    if (!domain) continue;
    tally.rows++;

    const people = await treg("hunter.companies.emails", { query: { domain }, maxCostUsd: 0.05 });
    let name = people.data?.data?.emails?.[0]?.first_name
      ? `${people.data.data.emails[0].first_name} ${people.data.data.emails[0].last_name ?? ""}`.trim()
      : null;
    let email = people.data?.data?.emails?.[0]?.value ?? null;

    if (!name) {
      const found = await treg("treg.people.search", {
        body: { domain, titles: ["Director", "Owner", "Proprietor", "Partner", "Managing Director"], limit: 1 },
        maxCostUsd: 0.05,
      });
      const p = found.data?.output?.people?.[0] ?? found.data?.people?.[0];
      if (p) name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || null;
    }
    if (name) tally.person++;

    if (name && !email) {
      const f = await treg("treg.people.email.find", { body: { full_name: name, domain }, maxCostUsd: 0.10 });
      email = f.data?.output?.email ?? f.data?.email ?? null;
      console.log(`  email_find served_by=${f.servedBy} cost=${f.cost}`);
    }
    if (email) tally.email++;

    if (email) {
      const v = await treg("treg.people.email.verify", { body: { email }, maxCostUsd: 0.05 });
      const verdict = v.data?.output?.status ?? v.data?.status ?? "unknown";
      if (verdict === "valid") tally.valid++;
      console.log(`  verify=${verdict}`);
    }

    if (name) {
      const ph = await treg("treg.people.phone.find", { body: { full_name: name, domain }, maxCostUsd: 0.25 });
      const mob = ph.data?.output?.phone ?? ph.data?.phone ?? null;
      if (mob) tally.mobile++;
      console.log(`  phone served_by=${ph.servedBy} hit=${!!mob} cost=${ph.cost}`);
    }

    console.log(`${row.name} | ${domain} | person=${!!name} email=${email ?? "-"} | spent so far $${(spentMicro / 1e6).toFixed(4)}`);
    if (spentMicro > 900_000) { console.log("STOPPING: approaching the $1 free credit"); break; }
  }
}

const pct = (n) => `${((n / tally.rows) * 100).toFixed(0)}%`;
console.log("\n=== SPIKE RESULT ===");
console.log(`rows attempted      ${tally.rows}`);
console.log(`person found        ${tally.person} (${pct(tally.person)})`);
console.log(`email found         ${tally.email} (${pct(tally.email)})`);
console.log(`email verified good ${tally.valid} (${pct(tally.valid)})`);
console.log(`MOBILE found        ${tally.mobile} (${pct(tally.mobile)})  <-- the kill criterion`);
console.log(`total spent         $${(spentMicro / 1e6).toFixed(4)}  =  Rs ${(spentMicro / 1e6 * 88).toFixed(2)}`);
console.log(`cost per usable row Rs ${(spentMicro / 1e6 * 88 / Math.max(1, tally.valid + tally.mobile)).toFixed(2)}`);
```

- [ ] **Step 3: Run it**

Run: `node scripts/spike-treg-enrich.mjs`
Expected: a per-row log, then the SPIKE RESULT block. Total spend under $1.

- [ ] **Step 4: Apply the kill criterion — this is a real decision point, not a formality**

| Mobile hit rate | What happens |
|---|---|
| **≥ 15%** | Proceed to Task 1 as planned. |
| **< 15%** | **STOP.** Report to the founder and revise the spec before any migration: drop step 5, collapse to name-and-email, and the switchboard number already in hand does the calling work. |

Also record, from the `served_by` lines, which providers actually answered. If one provider answered every email, the waterfall order in Task 4 should lead with it.

- [ ] **Step 5: Write the numbers into the spec and the plan**

Replace the price assumptions in Task 3 Step 1 (`PRICE_USD.email_find`, `PRICE_USD.phone_find`) with the real observed averages, and append a "Spike result 2026-10-__" block to the spec's Step 0 section.

- [ ] **Step 6: Commit the findings, not the script**

```bash
git add docs/engineering/specifications/lead-discovery-enrichment-treg-v1.md docs/superpowers/plans/2026-10-17-lead-discovery-enrichment-treg.md
git commit -m "docs: record treg enrichment spike results"
```

---

### Task 1: Domain normalisation

**Files:**
- Create: `src/lib/revenue/enrich-domain.ts`
- Test: `src/lib/revenue/enrich-domain.test.ts`
- Delete: `scripts/spike-treg-enrich.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `toApexDomain(website: string): string | null`, `FREE_MAIL_DOMAINS: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing test**

Cases taken from real production rows, not invented.

```ts
// src/lib/revenue/enrich-domain.test.ts
import { describe, it, expect } from "vitest";
import { toApexDomain } from "./enrich-domain";

describe("toApexDomain", () => {
  it("strips scheme, www, path and the Google Business utm tail", () => {
    expect(
      toApexDomain("https://www.solospolymers.com/?utm_source=google&utm_medium=organic&utm_campaign=gmb&utm_id=solos.gmb"),
    ).toBe("solospolymers.com");
  });

  it("handles http with a trailing slash", () => {
    expect(toApexDomain("http://www.santushtishakes.com/")).toBe("santushtishakes.com");
  });

  it("keeps a bare domain as-is", () => {
    expect(toApexDomain("jayambeindustry.com")).toBe("jayambeindustry.com");
  });

  it("keeps a co.in second-level domain whole", () => {
    expect(toApexDomain("https://www.example.co.in/contact")).toBe("example.co.in");
  });

  it("drops a fragment and a port", () => {
    expect(toApexDomain("https://example.com:8443/#about")).toBe("example.com");
  });

  it("rejects an empty or blank website", () => {
    expect(toApexDomain("")).toBeNull();
    expect(toApexDomain("   ")).toBeNull();
  });

  it("rejects free mailbox providers, which are never a company domain", () => {
    expect(toApexDomain("https://gmail.com")).toBeNull();
    expect(toApexDomain("rediffmail.com")).toBeNull();
    expect(toApexDomain("https://www.yahoo.in/")).toBeNull();
  });

  it("rejects social and marketplace pages, which are not the company's own domain", () => {
    expect(toApexDomain("https://www.facebook.com/someplumber")).toBeNull();
    expect(toApexDomain("https://www.indiamart.com/jay-ambe/")).toBeNull();
  });

  it("rejects things that are not hostnames", () => {
    expect(toApexDomain("not a url")).toBeNull();
    expect(toApexDomain("localhost")).toBeNull();
    expect(toApexDomain("192.168.1.1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/revenue/enrich-domain.test.ts`
Expected: FAIL — `Failed to resolve import "./enrich-domain"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/revenue/enrich-domain.ts
// ============================================================
// The harvest stores whatever Google gave for `websiteUri`, which is a browsing
// URL, not an identifier: schemes, www, paths, ports, fragments and the Google
// Business utm tail all appear in production rows. Every contact-data provider
// wants a bare apex domain, so this is the gate every paid call passes through.
//
// It also refuses three kinds of domain that look usable and are not: free
// mailbox providers (a company whose "website" is gmail.com has no domain to
// search), social pages, and marketplace listings. Paying a provider to look up
// people "at facebook.com" would find staff of Facebook.
// ============================================================

/** Mailbox providers. A company "website" pointing here means it has no domain. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.in", "ymail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "rediffmail.com", "rediff.com", "protonmail.com", "proton.me",
  "icloud.com", "aol.com", "zoho.com", "mail.com", "yandex.com",
]);

/** Someone else's platform. The people there are not this company's people. */
const PLATFORM_DOMAINS: ReadonlySet<string> = new Set([
  "facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "youtube.com", "wa.me", "whatsapp.com",
  "indiamart.com", "tradeindia.com", "exportersindia.com", "justdial.com",
  "sites.google.com", "business.site", "wixsite.com", "blogspot.com",
  "amazon.in", "flipkart.com",
]);

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Reduces a stored website to the apex domain a provider will accept, or null
 * when there is nothing usable. Null is not an error: a third of harvested rows
 * legitimately have no website, and they must cost nothing rather than fail.
 */
export function toApexDomain(website: string): string | null {
  const raw = (website ?? "").trim().toLowerCase();
  if (!raw) return null;

  let host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // scheme
    .split(/[/?#]/)[0] // path, query, fragment
    .split("@")
    .pop()! // stray userinfo
    .split(":")[0] // port
    .replace(/\.$/, ""); // fully-qualified trailing dot

  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || !host.includes(".")) return null;
  if (IPV4.test(host) || !HOSTNAME.test(host)) return null;
  if (FREE_MAIL_DOMAINS.has(host) || PLATFORM_DOMAINS.has(host)) return null;

  // A subdomain of a platform is still that platform.
  for (const platform of PLATFORM_DOMAINS) {
    if (host.endsWith(`.${platform}`)) return null;
  }

  return host;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/revenue/enrich-domain.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Measure the real enrichable count with the finished normaliser**

The spec claims 223 of 329 rows are enrichable, but that was a crude `website != ''` count that did not reject free-mail and platform domains. Get the true number:

```bash
node --input-type=module -e "
import('./src/lib/revenue/enrich-domain.ts').catch(()=>{});
" 2>/dev/null || npx tsx -e "
import { readFileSync } from 'node:fs';
import { toApexDomain } from './src/lib/revenue/enrich-domain';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim().replace(/^\"|\"$/g,'')]));
const r = await fetch(\`\${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/re_discovery_leads?select=website&limit=400\`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: \`Bearer \${env.SUPABASE_SERVICE_ROLE_KEY}\` } });
const rows = await r.json();
const ok = rows.filter(x => toApexDomain(x.website));
console.log('rows', rows.length, 'enrichable', ok.length, (100*ok.length/rows.length).toFixed(0)+'%');
"
```

Expected: a number at or below 223. Record it in the spec's "Why this exists" table if it differs.

- [ ] **Step 6: Delete the spike script and commit**

```bash
rm -f scripts/spike-treg-enrich.mjs
git add src/lib/revenue/enrich-domain.ts src/lib/revenue/enrich-domain.test.ts
git commit -m "feat(enrich): normalise harvested websites to an apex domain"
```

---

### Task 2: Migration — tables, columns and RPCs

**Files:**
- Create: `supabase/migrations/20261017120000_revenue_enrichment.sql`

**Interfaces:**
- Consumes: `re_discovery_leads(id)`.
- Produces: tables `re_enrich_runs`, `re_lead_contacts`, `re_enrich_attempts`; new columns on `re_discovery_leads`; RPCs `re_enrich_claim_run(uuid, interval) -> boolean` and `re_enrich_redeem_token(uuid, uuid) -> boolean`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Lead Discovery — enrichment stage.
--
-- Mirrors the discovery job tables deliberately: the enrichment run IS the job,
-- with next_index as position, heartbeat_at as the lock, and a single-use
-- worker_token for hand-off, because CRON_SECRET is not set on this project.
--
-- Money is integer micro-USD throughout. treg charges in USD and reports it in
-- X-Treg-Cost-Micro; storing rupees or floats would make totals unreconcilable
-- against treg's own receipts.
-- ============================================================

-- ── 1. The job ──
create table if not exists public.re_enrich_runs (
  id               uuid primary key default gen_random_uuid(),
  status           text        not null default 'queued',
  -- Position in lead_ids. The run resumes here, so a raised ceiling never
  -- re-pays for rows already done.
  next_index       int         not null default 0,
  lead_ids         bigint[]    not null,
  heartbeat_at     timestamptz,
  cancel_requested boolean     not null default false,
  stop_reason      text,
  last_error       text,
  worker_token     uuid,
  -- The ceiling, set before the run starts. Checked inside the treg client.
  max_cost_micro   bigint      not null,
  total_cost_micro bigint      not null default 0,
  rows_done        int         not null default 0,
  contacts_found   int         not null default 0,
  emails_verified  int         not null default 0,
  mobiles_found    int         not null default 0,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint re_enrich_runs_status_check
    check (status in ('queued', 'running', 'finished', 'stopped', 'failed', 'abandoned')),
  constraint re_enrich_runs_ceiling_check check (max_cost_micro > 0)
);

create index if not exists re_enrich_runs_live_idx
  on public.re_enrich_runs (status, heartbeat_at)
  where status in ('queued', 'running');

-- ── 2. The people found ──
create table if not exists public.re_lead_contacts (
  id              bigserial primary key,
  lead_id         bigint      not null references public.re_discovery_leads (id) on delete cascade,
  run_id          uuid        references public.re_enrich_runs (id) on delete set null,
  is_primary      boolean     not null default false,
  person_name     text        not null default '',
  person_title    text        not null default '',
  person_linkedin text        not null default '',
  email           text        not null default '',
  -- catch_all is NOT valid: the domain accepts everything, so nothing was learnt.
  email_status    text        not null default '',
  -- Digits only, 91XXXXXXXXXX, matching normalizePhone(). A leading + would be
  -- read as a formula by Excel.
  mobile          text        not null default '',
  mobile_status   text        not null default '',
  opted_out       boolean     not null default false,
  cost_micro      bigint      not null default 0,
  created_at      timestamptz not null default now(),
  constraint re_lead_contacts_email_status_check
    check (email_status in ('', 'valid', 'invalid', 'catch_all', 'risky', 'unknown')),
  constraint re_lead_contacts_mobile_status_check
    check (mobile_status in ('', 'live', 'dead', 'unknown'))
);

create index if not exists re_lead_contacts_lead_idx on public.re_lead_contacts (lead_id);
create index if not exists re_lead_contacts_created_idx on public.re_lead_contacts (created_at);
-- One primary contact per company.
create unique index if not exists re_lead_contacts_primary_idx
  on public.re_lead_contacts (lead_id) where is_primary;

-- ── 3. The receipt for every single call ──
--
-- This is how the waterfall order gets fixed with evidence instead of guesses:
-- every provider behind treg is US/UK/EU-first and nobody knows their real
-- coverage of a Gujarati manufacturer until these rows say so.
create table if not exists public.re_enrich_attempts (
  id           bigserial primary key,
  run_id       uuid        references public.re_enrich_runs (id) on delete cascade,
  lead_id      bigint,
  step         text        not null,
  endpoint_id  text        not null default '',
  served_by    text        not null default '',
  cost_micro   bigint      not null default 0,
  treg_call_id text        not null default '',
  outcome      text        not null,
  http_status  int         not null default 0,
  created_at   timestamptz not null default now(),
  constraint re_enrich_attempts_step_check
    check (step in ('company_people', 'person_search', 'email_find', 'email_verify', 'phone_find')),
  constraint re_enrich_attempts_outcome_check
    check (outcome in ('hit', 'miss', 'error', 'rate_limited', 'cached', 'uncharged'))
);

create index if not exists re_enrich_attempts_run_idx on public.re_enrich_attempts (run_id);
create index if not exists re_enrich_attempts_lead_idx on public.re_enrich_attempts (lead_id);
create index if not exists re_enrich_attempts_provider_idx on public.re_enrich_attempts (step, served_by, outcome);

-- ── 4. Summary on the lead, so the list renders without a join ──
alter table public.re_discovery_leads
  add column if not exists enrich_status     text   not null default 'pending',
  add column if not exists enrich_cost_micro bigint not null default 0,
  add column if not exists enriched_at       timestamptz,
  add column if not exists best_email        text   not null default '',
  add column if not exists best_email_status text   not null default '',
  add column if not exists best_mobile       text   not null default '';

create index if not exists re_discovery_leads_enrich_status_idx
  on public.re_discovery_leads (enrich_status);

-- ── 5. Service-role only, like the discovery tables ──
alter table public.re_enrich_runs     enable row level security;
alter table public.re_lead_contacts   enable row level security;
alter table public.re_enrich_attempts enable row level security;
-- Deliberately zero policies: nothing but the service role may read these.

-- ── 6. The lock. Two workers on one run would pay twice for every row ──
create or replace function public.re_enrich_claim_run(
  p_run_id      uuid,
  p_stale_after interval default interval '90 seconds'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed uuid;
begin
  select id into v_claimed
    from public.re_enrich_runs
   where id = p_run_id
     and status in ('queued', 'running')
     and cancel_requested = false
     and (heartbeat_at is null or heartbeat_at < now() - p_stale_after)
     for update skip locked;

  if v_claimed is null then
    return false;
  end if;

  update public.re_enrich_runs
     set status = 'running', heartbeat_at = now()
   where id = v_claimed;

  return true;
end;
$$;

comment on function public.re_enrich_claim_run(uuid, interval) is
  'Takes ownership of an enrichment run if nothing else holds it. False means another worker has it; the caller must then do nothing at all.';

revoke all on function public.re_enrich_claim_run(uuid, interval) from anon, authenticated;

-- ── 7. Single-use hand-off token ──
create or replace function public.re_enrich_redeem_token(
  p_run_id uuid,
  p_token  uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spent uuid;
begin
  update public.re_enrich_runs
     set worker_token = null
   where id = p_run_id
     and worker_token = p_token
  returning id into v_spent;

  return v_spent is not null;
end;
$$;

comment on function public.re_enrich_redeem_token(uuid, uuid) is
  'Spends an enrichment hand-off token, so it authorises exactly one worker.';

revoke all on function public.re_enrich_redeem_token(uuid, uuid) from anon, authenticated;
```

- [ ] **Step 2: Hand the SQL to the founder to run**

Supabase MCP can no longer reach the Mumbai project, so this is not applied from here. Give the founder the file path and ask him to run it in the Supabase SQL editor.

- [ ] **Step 3: Verify every object landed, from outside**

```bash
cd wacrm-web && URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL' .env.local | cut -d= -f2- | tr -d '"\r') && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env.local | cut -d= -f2- | tr -d '"\r') && for t in re_enrich_runs re_lead_contacts re_enrich_attempts; do printf "%s -> " "$t"; curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "${URL}/rest/v1/${t}?select=id&limit=1"; done; printf "leads.enrich_status -> "; curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "${URL}/rest/v1/re_discovery_leads?select=enrich_status&limit=1"
```

Expected: `200` four times. A `404` means that object is missing; a `400` on the last one means the column did not get added.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261017120000_revenue_enrichment.sql
git commit -m "feat(enrich): add enrichment run, contact and attempt tables"
```

---

### Task 3: The treg client

**Files:**
- Create: `src/lib/revenue/enrich-cost.ts`
- Create: `src/lib/revenue/treg-client.ts`
- Test: `src/lib/revenue/treg-client.test.ts`

**Interfaces:**
- Consumes: `toApexDomain` (not directly — callers use it).
- Produces:
  - `USD_INR: number`, `microToRupees(micro: number): number`, `PRICE_USD`, `PER_CALL_CAP_USD`, `estimateEnrichCostMicro(websites: string[]): CostEstimate`
  - `type EnrichStep = "company_people" | "person_search" | "email_find" | "email_verify" | "phone_find"`
  - `type TregOutcome = "hit" | "miss" | "error" | "rate_limited" | "cached" | "uncharged"`
  - `interface TregResult<T> { ok: boolean; outcome: TregOutcome; data: T | null; costMicro: number; servedBy: string; callId: string; httpStatus: number }`
  - `interface TregClient { call<T>(req: TregRequest): Promise<TregResult<T>>; spentMicro(): number; ceilingHit(): boolean }`
  - `interface TregRequest { step: EnrichStep; endpointId: string; leadId: number; body?: unknown; query?: Record<string, string>; maxCostUsd: number; verifyRoute?: boolean }`
  - `createTregClient(opts: TregClientOptions): TregClient`
  - `tregToken(): string | null`

- [ ] **Step 1: Write the cost module**

```ts
// src/lib/revenue/enrich-cost.ts
// ============================================================
// Money, in one place.
//
// Everything stored is integer micro-USD, because that is what treg reports in
// X-Treg-Cost-Micro and anything else makes totals unreconcilable against its
// receipts. Rupees exist only for display and for the ceiling the founder types.
//
// USD_INR is a hardcoded constant on purpose, not a live rate. A drifting rate
// would make two runs incomparable and could silently move a ceiling he set.
// Review it by hand.
// ============================================================

export const USD_INR = 88;

export function microToRupees(micro: number): number {
  return (micro / 1_000_000) * USD_INR;
}

export function rupeesToMicro(rupees: number): number {
  return Math.round((rupees / USD_INR) * 1_000_000);
}

/**
 * Per-call price assumptions, in USD.
 *
 * The three fixed ones are read from treg's catalogue. The two routed ones have
 * `usd_per_call: null` — the price depends on which provider answers — so these
 * are assumptions from Task 0's spike, and `re_enrich_attempts` is what corrects
 * them later.
 */
export const PRICE_USD = {
  company_people: 0.0245, // hunter.companies.emails
  person_search: 0.0245, // treg.people.search
  email_find: 0.03, // routed — REPLACE with the spike's observed average
  email_verify: 0.00625, // LeadMagic, the cheaper of the two verifiers
  phone_find: 0.1, // routed — REPLACE with the spike's observed average
} as const;

/**
 * The hard per-call cap sent as X-Treg-Route-Max-Cost.
 *
 * treg's own default is $1 a call, which over 200 rows is a four-figure
 * accident. These are roughly 2.5x the expected price: loose enough that a
 * dearer provider can still answer, tight enough that nothing runs away.
 */
export const PER_CALL_CAP_USD: Record<keyof typeof PRICE_USD, number> = {
  company_people: 0.05,
  person_search: 0.05,
  email_find: 0.1,
  email_verify: 0.03,
  phone_find: 0.25,
};

export interface CostEstimate {
  /** Rows with a usable apex domain. Only these can cost anything. */
  enrichable: number;
  /** Rows that will be marked no_domain and cost nothing. */
  noDomain: number;
  /** Cheapest realistic outcome: step 1 answers everything, nothing else runs. */
  lowMicro: number;
  /** Every step runs for every row and every one of them costs. */
  highMicro: number;
}

const toMicro = (usd: number) => Math.round(usd * 1_000_000);

/**
 * What a selection could cost, as a range.
 *
 * The low end assumes `hunter.companies.emails` returns a named person with an
 * address, which skips steps 2 and 3 — that is the common good case, and it is
 * one call plus a verify. The high end assumes all five steps run and all five
 * charge.
 */
export function estimateEnrichCostMicro(apexDomains: (string | null)[]): CostEstimate {
  const enrichable = apexDomains.filter(Boolean).length;
  const noDomain = apexDomains.length - enrichable;

  const low = toMicro(PRICE_USD.company_people + PRICE_USD.email_verify);
  const high = toMicro(
    PRICE_USD.company_people +
      PRICE_USD.person_search +
      PRICE_USD.email_find +
      PRICE_USD.email_verify +
      PRICE_USD.phone_find,
  );

  return { enrichable, noDomain, lowMicro: low * enrichable, highMicro: high * enrichable };
}
```

- [ ] **Step 2: Write the failing client test**

```ts
// src/lib/revenue/treg-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { createTregClient, type AttemptRow } from "./treg-client";

function res(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function harness(fetchImpl: typeof fetch, maxMicro = 1_000_000) {
  const attempts: AttemptRow[] = [];
  const client = createTregClient({
    token: "t_test",
    runId: "run-1",
    maxCostMicro: maxMicro,
    spentMicro: 0,
    recordAttempt: async (a) => void attempts.push(a),
    fetchImpl,
  });
  return { client, attempts };
}

const req = {
  step: "email_find" as const,
  endpointId: "treg.people.email.find",
  leadId: 42,
  body: { full_name: "A B", domain: "x.com" },
  maxCostUsd: 0.1,
};

describe("createTregClient", () => {
  it("sends the token, the cap, a deterministic idempotency key and the meta tag", async () => {
    const fetchImpl = vi.fn(async () => res({ output: { email: "a@x.com" } }, { headers: { "X-Treg-Cost-Micro": "2630" } }));
    const { client } = harness(fetchImpl as unknown as typeof fetch);

    await client.call(req);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://treg.to/call/treg.people.email.find");
    const h = init.headers as Record<string, string>;
    expect(h["X-Treg-Token"]).toBe("t_test");
    expect(h["X-Treg-Route-Max-Cost"]).toBe("0.1");
    expect(h["Idempotency-Key"]).toBe("run-1:42:email_find");
    expect(h["X-Treg-Meta"]).toBe("feature=enrich,run=run-1");
  });

  it("reads the charge from the header, never from the body", async () => {
    const fetchImpl = vi.fn(async () =>
      res({ output: { email: "a@x.com" }, cost: 999 }, { headers: { "X-Treg-Cost-Micro": "2630", "X-Treg-Served-By": "quickemail", "X-Treg-Call-Id": "c_1" } }),
    );
    const { client, attempts } = harness(fetchImpl as unknown as typeof fetch);

    const r = await client.call(req);

    expect(r.costMicro).toBe(2630);
    expect(r.servedBy).toBe("quickemail");
    expect(client.spentMicro()).toBe(2630);
    expect(attempts[0]).toMatchObject({ outcome: "hit", cost_micro: 2630, served_by: "quickemail", treg_call_id: "c_1" });
  });

  it("calls a 200 with no usable payload a miss, and still records it", async () => {
    const fetchImpl = vi.fn(async () => res({ output: null }, { headers: { "X-Treg-Cost-Micro": "0" } }));
    const { client, attempts } = harness(fetchImpl as unknown as typeof fetch);

    const r = await client.call(req);

    expect(r.outcome).toBe("miss");
    expect(r.ok).toBe(false);
    expect(attempts[0].outcome).toBe("miss");
  });

  it("treats a 402 as uncharged and does not add to the total", async () => {
    const fetchImpl = vi.fn(async () => res({ error: "cap" }, { status: 402 }));
    const { client, attempts } = harness(fetchImpl as unknown as typeof fetch);

    const r = await client.call(req);

    expect(r.outcome).toBe("uncharged");
    expect(client.spentMicro()).toBe(0);
    expect(attempts[0]).toMatchObject({ outcome: "uncharged", http_status: 402 });
  });

  it("treats a 422 strict-filter refusal as uncharged", async () => {
    const fetchImpl = vi.fn(async () => res({ error: "filter" }, { status: 422 }));
    const { client } = harness(fetchImpl as unknown as typeof fetch);

    expect((await client.call(req)).outcome).toBe("uncharged");
  });

  it("records a 429 as rate_limited and does NOT retry", async () => {
    const fetchImpl = vi.fn(async () => res({ error: "slow down" }, { status: 429 }));
    const { client, attempts } = harness(fetchImpl as unknown as typeof fetch);

    const r = await client.call(req);

    expect(r.outcome).toBe("rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveLength(1);
  });

  it("retries a 5xx exactly once, reusing the same idempotency key so it cannot pay twice", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res({ error: "boom" }, { status: 503 }))
      .mockResolvedValueOnce(res({ output: { email: "a@x.com" } }, { headers: { "X-Treg-Cost-Micro": "2630" } }));
    const { client } = harness(fetchImpl as unknown as typeof fetch);

    const r = await client.call(req);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const second = (fetchImpl.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(second["Idempotency-Key"]).toBe(first["Idempotency-Key"]);
    expect(r.outcome).toBe("hit");
  });

  it("marks a cache hit, which costs 10% rather than nothing", async () => {
    const fetchImpl = vi.fn(async () =>
      res({ output: { email: "a@x.com" } }, { headers: { "X-Treg-Cost-Micro": "263", "X-Treg-Cache": "hit" } }),
    );
    const { client, attempts } = harness(fetchImpl as unknown as typeof fetch);

    expect((await client.call(req)).outcome).toBe("cached");
    expect(attempts[0].cost_micro).toBe(263);
  });

  it("REFUSES the call when it would cross the run ceiling, without any fetch", async () => {
    const fetchImpl = vi.fn(async () => res({}, {}));
    // Ceiling 1000 micro, but this step's cap reserves 100_000 micro.
    const { client, attempts } = harness(fetchImpl as unknown as typeof fetch, 1_000);

    const r = await client.call(req);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.outcome).toBe("uncharged");
    expect(client.ceilingHit()).toBe(true);
    expect(attempts).toHaveLength(0);
  });

  it("appends query parameters for a GET-style endpoint", async () => {
    const fetchImpl = vi.fn(async () => res({ data: { emails: [] } }, { headers: { "X-Treg-Cost-Micro": "0" } }));
    const { client } = harness(fetchImpl as unknown as typeof fetch);

    await client.call({ step: "company_people", endpointId: "hunter.companies.emails", leadId: 7, query: { domain: "x.com" }, maxCostUsd: 0.05 });

    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://treg.to/call/hunter.companies.emails?domain=x.com");
  });

  it("sets the verify route header only when asked", async () => {
    const fetchImpl = vi.fn(async () => res({ output: { phone: "+919876543210" } }, { headers: { "X-Treg-Cost-Micro": "90000" } }));
    const { client } = harness(fetchImpl as unknown as typeof fetch);

    await client.call({ ...req, step: "phone_find", endpointId: "treg.people.phone.find", verifyRoute: true });

    const h = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(h["X-Treg-Route-Verify"]).toBe("true");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/lib/revenue/treg-client.test.ts`
Expected: FAIL — `Failed to resolve import "./treg-client"`.

- [ ] **Step 4: Write the client**

```ts
// src/lib/revenue/treg-client.ts
// ============================================================
// The one door to treg. Nothing else in the codebase calls it.
//
// THREE GUARDRAILS, ENFORCED HERE AND NOT BY CALLERS
//
//   1. X-Treg-Route-Max-Cost on every call. treg's own default is $1 per routed
//      call, because a routed price depends on which provider answers. A loop
//      over 200 rows without a cap is a four-figure accident.
//
//   2. A deterministic Idempotency-Key, <runId>:<leadId>:<step>. The worker
//      chain means a timed-out call can be reissued; without this that is a
//      second charge for the same answer. The 5xx retry reuses it for the same
//      reason.
//
//   3. The run ceiling, checked BEFORE the fetch. It lives in the client rather
//      than in the waterfall so that no future code path can forget it.
//
// The charge is read from X-Treg-Cost-Micro, never from the provider's own body,
// which reports whatever that provider feels like reporting.
// ============================================================

import { PER_CALL_CAP_USD } from "./enrich-cost";

const BASE = "https://treg.to";

export type EnrichStep = "company_people" | "person_search" | "email_find" | "email_verify" | "phone_find";

export type TregOutcome = "hit" | "miss" | "error" | "rate_limited" | "cached" | "uncharged";

export interface TregResult<T> {
  /** True only for a usable payload. A charged miss is not ok. */
  ok: boolean;
  outcome: TregOutcome;
  data: T | null;
  costMicro: number;
  servedBy: string;
  callId: string;
  httpStatus: number;
}

export interface TregRequest {
  step: EnrichStep;
  endpointId: string;
  leadId: number;
  /** Present for POST-style endpoints. */
  body?: unknown;
  /** Present for GET-style endpoints. */
  query?: Record<string, string>;
  maxCostUsd: number;
  /** Adds X-Treg-Route-Verify, which HLR-checks a found phone as a separate charge. */
  verifyRoute?: boolean;
}

/** Shape written to `re_enrich_attempts`. Snake case because it is a DB row. */
export interface AttemptRow {
  run_id: string;
  lead_id: number;
  step: EnrichStep;
  endpoint_id: string;
  served_by: string;
  cost_micro: number;
  treg_call_id: string;
  outcome: TregOutcome;
  http_status: number;
}

export interface TregClientOptions {
  token: string;
  runId: string;
  maxCostMicro: number;
  /** What the run has already spent, so a resumed run respects its ceiling. */
  spentMicro: number;
  recordAttempt: (row: AttemptRow) => Promise<void>;
  fetchImpl?: typeof fetch;
}

export interface TregClient {
  call<T>(req: TregRequest): Promise<TregResult<T>>;
  spentMicro(): number;
  /** True once a call has been refused for want of budget. The runner pauses. */
  ceilingHit(): boolean;
}

export function tregToken(): string | null {
  return process.env.TREG_TOKEN?.trim() || null;
}

export function createTregClient(opts: TregClientOptions): TregClient {
  const doFetch = opts.fetchImpl ?? fetch;
  let spent = opts.spentMicro;
  let ceiling = false;

  async function call<T>(req: TregRequest): Promise<TregResult<T>> {
    // Reserve the worst case this call could cost, not the expected case.
    const reserve = Math.round((req.maxCostUsd ?? PER_CALL_CAP_USD[req.step]) * 1_000_000);
    if (spent + reserve > opts.maxCostMicro) {
      ceiling = true;
      // No attempt row: nothing was attempted. The run's pause is the record.
      return { ok: false, outcome: "uncharged", data: null, costMicro: 0, servedBy: "", callId: "", httpStatus: 0 };
    }

    const qs = req.query ? `?${new URLSearchParams(req.query)}` : "";
    const url = `${BASE}/call/${req.endpointId}${qs}`;
    const headers: Record<string, string> = {
      "X-Treg-Token": opts.token,
      "X-Treg-Route-Max-Cost": String(req.maxCostUsd),
      "Idempotency-Key": `${opts.runId}:${req.leadId}:${req.step}`,
      "X-Treg-Meta": `feature=enrich,run=${opts.runId}`,
    };
    if (req.body) headers["Content-Type"] = "application/json";
    if (req.verifyRoute) headers["X-Treg-Route-Verify"] = "true";

    let response: Response | null = null;
    let transportError = "";

    // One retry, and only for 5xx. The key above is what makes that safe.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await doFetch(url, {
          method: req.body ? "POST" : "GET",
          headers,
          ...(req.body ? { body: JSON.stringify(req.body) } : {}),
          signal: AbortSignal.timeout(45_000),
        });
      } catch (err) {
        transportError = err instanceof Error ? err.message : "network error";
        response = null;
      }
      if (!response || response.status < 500) break;
      if (attempt === 1) break;
    }

    if (!response) {
      const row = attemptRow(req, { outcome: "error", costMicro: 0, servedBy: "", callId: "", httpStatus: 0 });
      await opts.recordAttempt(row);
      console.error("[enrich] treg transport failure", req.endpointId, transportError);
      return { ok: false, outcome: "error", data: null, costMicro: 0, servedBy: "", callId: "", httpStatus: 0 };
    }

    const costMicro = Number(response.headers.get("X-Treg-Cost-Micro") ?? 0) || 0;
    const servedBy = response.headers.get("X-Treg-Served-By") ?? "";
    const callId = response.headers.get("X-Treg-Call-Id") ?? "";
    const cached = response.headers.get("X-Treg-Cache") === "hit";
    spent += costMicro;

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const outcome = classify(response.status, payload, cached);
    await opts.recordAttempt(attemptRow(req, { outcome, costMicro, servedBy, callId, httpStatus: response.status }));

    return {
      ok: outcome === "hit" || outcome === "cached",
      outcome,
      data: outcome === "hit" || outcome === "cached" ? (payload as T) : null,
      costMicro,
      servedBy,
      callId,
      httpStatus: response.status,
    };
  }

  function attemptRow(
    req: TregRequest,
    r: { outcome: TregOutcome; costMicro: number; servedBy: string; callId: string; httpStatus: number },
  ): AttemptRow {
    return {
      run_id: opts.runId,
      lead_id: req.leadId,
      step: req.step,
      endpoint_id: req.endpointId,
      served_by: r.servedBy,
      cost_micro: r.costMicro,
      treg_call_id: r.callId,
      outcome: r.outcome,
      http_status: r.httpStatus,
    };
  }

  return { call, spentMicro: () => spent, ceilingHit: () => ceiling };
}

/**
 * What happened, in treg's terms.
 *
 * 402 (the cap would have been exceeded) and 422 (a filter could not be applied)
 * are both uncharged by treg and must not abort the run. 429 falls through to
 * the next provider rather than retrying, because retrying a rate limit just
 * spends the next worker's time.
 */
function classify(status: number, payload: unknown, cached: boolean): TregOutcome {
  if (status === 402 || status === 422) return "uncharged";
  if (status === 429) return "rate_limited";
  if (status >= 400) return "error";
  if (!hasPayload(payload)) return "miss";
  return cached ? "cached" : "hit";
}

/** A 200 with an empty output is a miss, and providers express that many ways. */
function hasPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  const output = (p.output ?? p.data ?? p) as Record<string, unknown> | null;
  if (!output || typeof output !== "object") return false;
  return Object.values(output).some((v) => {
    if (v === null || v === undefined || v === "" || v === false) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/lib/revenue/treg-client.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/revenue/enrich-cost.ts src/lib/revenue/treg-client.ts src/lib/revenue/treg-client.test.ts
git commit -m "feat(enrich): add the treg client with cost caps and per-call receipts"
```

---

### Task 4: The waterfall for one lead

**Files:**
- Create: `src/lib/revenue/enrich-waterfall.ts`
- Test: `src/lib/revenue/enrich-waterfall.test.ts`

**Interfaces:**
- Consumes: `TregClient`, `TregRequest`, `TregResult` from `./treg-client`; `toApexDomain` from `./enrich-domain`; `PER_CALL_CAP_USD` from `./enrich-cost`.
- Produces:
  - `type EmailStatus = "" | "valid" | "invalid" | "catch_all" | "risky" | "unknown"`
  - `type MobileStatus = "" | "live" | "dead" | "unknown"`
  - `interface FoundContact { personName: string; personTitle: string; personLinkedin: string; email: string; emailStatus: EmailStatus; mobile: string; mobileStatus: MobileStatus; costMicro: number }`
  - `interface WaterfallResult { status: "no_domain" | "enriched" | "partial" | "failed"; contacts: FoundContact[]; costMicro: number }`
  - `DECISION_TITLES: readonly string[]`
  - `enrichLead(client: TregClient, lead: { id: number; name: string; website: string }): Promise<WaterfallResult>`
  - `normaliseMobile(raw: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/revenue/enrich-waterfall.test.ts
import { describe, it, expect, vi } from "vitest";
import { enrichLead, normaliseMobile } from "./enrich-waterfall";
import type { TregClient, TregRequest, TregResult } from "./treg-client";

/** A client whose answers are scripted per step. Unscripted steps are misses. */
function fakeClient(script: Partial<Record<TregRequest["step"], unknown>>, opts: { ceiling?: boolean } = {}) {
  const calls: TregRequest["step"][] = [];
  const client: TregClient = {
    async call<T>(req: TregRequest): Promise<TregResult<T>> {
      calls.push(req.step);
      const data = script[req.step];
      const hit = data !== undefined;
      return {
        ok: hit,
        outcome: hit ? "hit" : "miss",
        data: (data ?? null) as T | null,
        costMicro: hit ? 1000 : 0,
        servedBy: "fake",
        callId: "c",
        httpStatus: 200,
      };
    },
    spentMicro: () => 0,
    ceilingHit: () => opts.ceiling ?? false,
  };
  return { client, calls };
}

const lead = { id: 42, name: "Jay AMBE Industries", website: "https://www.jayambeindustry.com/?utm_source=google" };

describe("enrichLead", () => {
  it("costs nothing and makes no call when there is no usable domain", async () => {
    const { client, calls } = fakeClient({});
    const r = await enrichLead(client, { id: 1, name: "X", website: "" });

    expect(r.status).toBe("no_domain");
    expect(calls).toEqual([]);
    expect(r.costMicro).toBe(0);
  });

  it("skips person_search and email_find when step 1 already gave a named person with an email", async () => {
    const { client, calls } = fakeClient({
      company_people: { data: { emails: [{ first_name: "Rajesh", last_name: "Sharma", value: "rajesh@jayambeindustry.com", position: "Proprietor", linkedin: "in/rajesh" }] } },
      email_verify: { output: { status: "valid", verified: true } },
      phone_find: { output: { phone: "+91 98765 43210", valid: true } },
    });

    const r = await enrichLead(client, lead);

    expect(calls).toEqual(["company_people", "email_verify", "phone_find"]);
    expect(r.contacts[0]).toMatchObject({
      personName: "Rajesh Sharma",
      personTitle: "Proprietor",
      email: "rajesh@jayambeindustry.com",
      emailStatus: "valid",
      mobile: "919876543210",
      mobileStatus: "live",
    });
    expect(r.status).toBe("enriched");
  });

  it("falls through to person_search then email_find when step 1 finds nobody", async () => {
    const { client, calls } = fakeClient({
      person_search: { output: { people: [{ first_name: "Amit", last_name: "Patel", title: "Director" }] } },
      email_find: { output: { email: "amit@jayambeindustry.com" } },
      email_verify: { output: { status: "valid", verified: true } },
    });

    const r = await enrichLead(client, lead);

    expect(calls).toEqual(["company_people", "person_search", "email_find", "email_verify", "phone_find"]);
    expect(r.contacts[0].email).toBe("amit@jayambeindustry.com");
  });

  it("does NOT pay for an email or a phone when no person was ever found", async () => {
    const { client, calls } = fakeClient({});

    const r = await enrichLead(client, lead);

    expect(calls).toEqual(["company_people", "person_search"]);
    expect(r.status).toBe("failed");
    expect(r.contacts).toEqual([]);
  });

  it("still looks for a mobile when the email step failed — a live mobile is the better outcome anyway", async () => {
    const { client, calls } = fakeClient({
      person_search: { output: { people: [{ first_name: "Amit", last_name: "Patel", title: "Director" }] } },
      phone_find: { output: { phone: "919876543210", valid: true } },
    });

    const r = await enrichLead(client, lead);

    expect(calls).toContain("phone_find");
    expect(r.contacts[0].mobile).toBe("919876543210");
    expect(r.contacts[0].email).toBe("");
    expect(r.status).toBe("partial");
  });

  it("records catch_all as its own verdict and does not treat it as valid", async () => {
    const { client } = fakeClient({
      company_people: { data: { emails: [{ first_name: "A", last_name: "B", value: "a@x.com" }] } },
      email_verify: { output: { status: "catch_all", verified: false } },
    });

    const r = await enrichLead(client, lead);

    expect(r.contacts[0].emailStatus).toBe("catch_all");
    expect(r.status).toBe("partial");
  });

  it("asks for the HLR check on the phone step", async () => {
    const seen: TregRequest[] = [];
    const client: TregClient = {
      async call<T>(req: TregRequest) {
        seen.push(req);
        const data = req.step === "person_search" ? { output: { people: [{ first_name: "A", last_name: "B" }] } } : undefined;
        return { ok: !!data, outcome: data ? "hit" : "miss", data: (data ?? null) as T | null, costMicro: 0, servedBy: "", callId: "", httpStatus: 200 } as TregResult<T>;
      },
      spentMicro: () => 0,
      ceilingHit: () => false,
    };

    await enrichLead(client, lead);

    expect(seen.find((r) => r.step === "phone_find")?.verifyRoute).toBe(true);
  });

  it("stops the moment the client reports the ceiling was hit", async () => {
    const { client, calls } = fakeClient({ company_people: { data: { emails: [] } } }, { ceiling: true });

    await enrichLead(client, lead);

    expect(calls).toEqual(["company_people"]);
  });

  it("filters person_search to Indian SMB titles, not the US VP ladder", async () => {
    const seen: TregRequest[] = [];
    const client: TregClient = {
      async call<T>(req: TregRequest) {
        seen.push(req);
        return { ok: false, outcome: "miss", data: null, costMicro: 0, servedBy: "", callId: "", httpStatus: 200 } as TregResult<T>;
      },
      spentMicro: () => 0,
      ceilingHit: () => false,
    };

    await enrichLead(client, lead);

    const titles = (seen.find((r) => r.step === "person_search")?.body as { titles: string[] }).titles;
    expect(titles).toContain("Proprietor");
    expect(titles).toContain("Managing Director");
  });
});

describe("normaliseMobile", () => {
  it("reduces any shape to 91XXXXXXXXXX digits only", () => {
    expect(normaliseMobile("+91 98765 43210")).toBe("919876543210");
    expect(normaliseMobile("098765-43210")).toBe("919876543210");
    expect(normaliseMobile("9876543210")).toBe("919876543210");
    expect(normaliseMobile("919876543210")).toBe("919876543210");
  });

  it("returns empty for anything that is not an Indian mobile", () => {
    expect(normaliseMobile("")).toBe("");
    expect(normaliseMobile("12345")).toBe("");
    expect(normaliseMobile("+1 415 555 2671")).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/revenue/enrich-waterfall.test.ts`
Expected: FAIL — `Failed to resolve import "./enrich-waterfall"`.

- [ ] **Step 3: Write the waterfall**

```ts
// src/lib/revenue/enrich-waterfall.ts
// ============================================================
// Five steps for one company, and every step after the first runs only if the
// one before it found something. That short-circuit is the whole cost story: a
// company with nobody findable costs two calls, not five.
//
// Step 1 is one call that often returns several named people with addresses
// already, which skips steps 2 and 3 entirely.
//
// Step 5 deliberately does NOT depend on step 4. A dead mailbox with a live
// mobile is a perfectly good outcome, and for WhatsApp outreach it is the better
// one.
// ============================================================

import { PER_CALL_CAP_USD } from "./enrich-cost";
import { toApexDomain } from "./enrich-domain";
import type { TregClient } from "./treg-client";

/** Who runs a small Indian manufacturer. Not the US CEO/VP ladder. */
export const DECISION_TITLES = [
  "Proprietor", "Owner", "Director", "Managing Director", "Partner", "Founder", "CEO",
] as const;

export type EmailStatus = "" | "valid" | "invalid" | "catch_all" | "risky" | "unknown";
export type MobileStatus = "" | "live" | "dead" | "unknown";

export interface FoundContact {
  personName: string;
  personTitle: string;
  personLinkedin: string;
  email: string;
  emailStatus: EmailStatus;
  mobile: string;
  mobileStatus: MobileStatus;
  costMicro: number;
}

export interface WaterfallResult {
  status: "no_domain" | "enriched" | "partial" | "failed";
  contacts: FoundContact[];
  costMicro: number;
}

const EMAIL_STATUSES: readonly EmailStatus[] = ["valid", "invalid", "catch_all", "risky", "unknown"];

export async function enrichLead(
  client: TregClient,
  lead: { id: number; name: string; website: string },
): Promise<WaterfallResult> {
  const domain = toApexDomain(lead.website);
  if (!domain) return { status: "no_domain", contacts: [], costMicro: 0 };

  let costMicro = 0;
  const contact: FoundContact = {
    personName: "", personTitle: "", personLinkedin: "",
    email: "", emailStatus: "", mobile: "", mobileStatus: "", costMicro: 0,
  };

  // ── Step 1: who works at this domain ──
  const people = await client.call<HunterCompanyEmails>({
    step: "company_people",
    endpointId: "hunter.companies.emails",
    leadId: lead.id,
    query: { domain },
    maxCostUsd: PER_CALL_CAP_USD.company_people,
  });
  costMicro += people.costMicro;

  const best = pickDecisionMaker(people.data?.data?.emails ?? []);
  if (best) {
    contact.personName = [best.first_name, best.last_name].filter(Boolean).join(" ").trim();
    contact.personTitle = best.position ?? "";
    contact.personLinkedin = best.linkedin ?? "";
    contact.email = best.value ?? "";
  }

  if (client.ceilingHit()) return settle(contact, costMicro);

  // ── Step 2: find the decision-maker, only if step 1 named nobody ──
  if (!contact.personName) {
    const found = await client.call<PeopleSearch>({
      step: "person_search",
      endpointId: "treg.people.search",
      leadId: lead.id,
      body: { domain, titles: [...DECISION_TITLES], limit: 1 },
      maxCostUsd: PER_CALL_CAP_USD.person_search,
    });
    costMicro += found.costMicro;

    const person = (found.data?.output?.people ?? found.data?.people ?? [])[0];
    if (person) {
      contact.personName =
        person.full_name?.trim() || [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
      contact.personTitle = person.title ?? person.position ?? "";
      contact.personLinkedin = person.linkedin_url ?? person.linkedin ?? "";
    }
  }

  // No person means nothing left to buy. This is the cheap exit.
  if (!contact.personName) return settle(contact, costMicro);
  if (client.ceilingHit()) return settle(contact, costMicro);

  // ── Step 3: find their work email, only if we do not have one ──
  if (!contact.email) {
    const found = await client.call<EmailFind>({
      step: "email_find",
      endpointId: "treg.people.email.find",
      leadId: lead.id,
      body: { full_name: contact.personName, domain },
      maxCostUsd: PER_CALL_CAP_USD.email_find,
    });
    costMicro += found.costMicro;
    contact.email = found.data?.output?.email ?? found.data?.email ?? "";
  }

  if (client.ceilingHit()) return settle(contact, costMicro);

  // ── Step 4: verify the mailbox ──
  if (contact.email) {
    const verified = await client.call<EmailVerify>({
      step: "email_verify",
      endpointId: "treg.people.email.verify",
      leadId: lead.id,
      body: { email: contact.email },
      maxCostUsd: PER_CALL_CAP_USD.email_verify,
    });
    costMicro += verified.costMicro;

    const raw = (verified.data?.output?.status ?? verified.data?.status ?? "").toLowerCase() as EmailStatus;
    contact.emailStatus = EMAIL_STATUSES.includes(raw) ? raw : "unknown";
  }

  if (client.ceilingHit()) return settle(contact, costMicro);

  // ── Step 5: find the mobile. Independent of whether step 4 succeeded ──
  const phone = await client.call<PhoneFind>({
    step: "phone_find",
    endpointId: "treg.people.phone.find",
    leadId: lead.id,
    body: { full_name: contact.personName, domain },
    maxCostUsd: PER_CALL_CAP_USD.phone_find,
    // HLR-checks the number as a separate charge, so a hit is a live SIM.
    verifyRoute: true,
  });
  costMicro += phone.costMicro;

  const mobile = normaliseMobile(phone.data?.output?.phone ?? phone.data?.phone ?? "");
  if (mobile) {
    contact.mobile = mobile;
    const live = phone.data?.output?.valid ?? phone.data?.valid;
    contact.mobileStatus = live === true ? "live" : live === false ? "dead" : "unknown";
  }

  return settle(contact, costMicro);
}

/**
 * Picks the likeliest decision-maker out of what step 1 returned.
 *
 * Prefers a named person holding a decision title, then any named person. An
 * unnamed role address (info@, sales@) is worth nothing here: the point of this
 * stage is a person to ask for.
 */
function pickDecisionMaker(emails: HunterEmail[]): HunterEmail | null {
  const named = emails.filter((e) => (e.first_name ?? "").trim());
  if (!named.length) return null;

  const ranked = named.find((e) =>
    DECISION_TITLES.some((t) => (e.position ?? "").toLowerCase().includes(t.toLowerCase())),
  );
  return ranked ?? named[0];
}

/** `enriched` needs a deliverable: a checked mailbox or a live mobile. */
function settle(contact: FoundContact, costMicro: number): WaterfallResult {
  contact.costMicro = costMicro;
  if (!contact.personName) return { status: "failed", contacts: [], costMicro };

  const deliverable = contact.emailStatus === "valid" || contact.mobileStatus === "live";
  return { status: deliverable ? "enriched" : "partial", contacts: [contact], costMicro };
}

/**
 * Reduces a provider's phone format to `91XXXXXXXXXX`, digits only.
 *
 * Matches the harvest's own storage so WhatsApp links work, and avoids a leading
 * `+` which Excel reads as a formula. Anything that is not a ten-digit Indian
 * mobile comes back empty rather than wrong.
 */
export function normaliseMobile(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";

  let national = digits;
  if (national.length === 12 && national.startsWith("91")) national = national.slice(2);
  else if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  else if (national.length === 13 && national.startsWith("091")) national = national.slice(3);

  // Indian mobiles are ten digits starting 6-9.
  if (!/^[6-9]\d{9}$/.test(national)) return "";
  return `91${national}`;
}

// ── Provider response shapes. Only the fields actually read. ──
interface HunterEmail {
  value?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  linkedin?: string;
}
interface HunterCompanyEmails {
  data?: { emails?: HunterEmail[] };
}
interface SearchPerson {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  position?: string;
  linkedin_url?: string;
  linkedin?: string;
}
interface PeopleSearch {
  output?: { people?: SearchPerson[] };
  people?: SearchPerson[];
}
interface EmailFind {
  output?: { email?: string };
  email?: string;
}
interface EmailVerify {
  output?: { status?: string; verified?: boolean };
  status?: string;
}
interface PhoneFind {
  output?: { phone?: string; valid?: boolean };
  phone?: string;
  valid?: boolean;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/revenue/enrich-waterfall.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/revenue/enrich-waterfall.ts src/lib/revenue/enrich-waterfall.test.ts
git commit -m "feat(enrich): add the five-step short-circuiting waterfall"
```

---

### Task 5: The runner — claim, chunk, release

**Files:**
- Create: `src/lib/revenue/enrich-runner.ts`
- Test: `src/lib/revenue/enrich-runner.test.ts`

**Interfaces:**
- Consumes: `enrichLead`, `WaterfallResult` from `./enrich-waterfall`; `createTregClient`, `tregToken`, `AttemptRow` from `./treg-client`; `serviceClient` from `@/lib/auth/superadmin`; `type Admin` from `./discovery-runner`.
- Produces:
  - `ENRICH_WORKER_BUDGET_MS = 240_000`, `ENRICH_CONCURRENCY = 5`
  - `interface EnrichOutcome { claimed: boolean; advanced: number; status: string; handOff: boolean }`
  - `enrichRun(admin: Admin, runId: string, deps?: EnrichDeps): Promise<EnrichOutcome>`
  - `interface EnrichDeps { now?: () => number; enrich?: typeof enrichLead }`

- [ ] **Step 1: Write the failing test**

A hand-rolled fake of the three Supabase calls this runner makes, so the test needs no database.

```ts
// src/lib/revenue/enrich-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { enrichRun } from "./enrich-runner";
import type { WaterfallResult } from "./enrich-waterfall";

interface FakeRun {
  id: string;
  status: string;
  next_index: number;
  lead_ids: number[];
  cancel_requested: boolean;
  max_cost_micro: number;
  total_cost_micro: number;
  rows_done: number;
  contacts_found: number;
  emails_verified: number;
  mobiles_found: number;
  stop_reason: string | null;
  heartbeat_at: string | null;
}

function fakeAdmin(run: FakeRun, leads: { id: number; name: string; website: string }[], opts: { claim?: boolean } = {}) {
  const inserted: Record<string, unknown[]> = { re_lead_contacts: [], re_enrich_attempts: [] };
  const leadPatches: Record<number, Record<string, unknown>> = {};

  const admin = {
    rpc: vi.fn(async (fn: string) => ({ data: fn === "re_enrich_claim_run" ? (opts.claim ?? true) : true })),
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: table === "re_enrich_runs" ? run : null, error: null }),
        then: undefined,
        async insert(rows: unknown) {
          inserted[table] ??= [];
          inserted[table].push(...(Array.isArray(rows) ? rows : [rows]));
          return { error: null };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string | number) => {
              if (table === "re_enrich_runs") Object.assign(run, patch);
              if (table === "re_discovery_leads") leadPatches[id as number] = patch;
              return { error: null };
            },
          };
        },
      };
      if (table === "re_discovery_leads") {
        return {
          ...chain,
          select: () => ({ in: async () => ({ data: leads, error: null }) }),
        } as never;
      }
      return chain as never;
    },
  };

  return { admin: admin as never, inserted, leadPatches };
}

const baseRun = (over: Partial<FakeRun> = {}): FakeRun => ({
  id: "run-1",
  status: "running",
  next_index: 0,
  lead_ids: [1, 2],
  cancel_requested: false,
  max_cost_micro: 10_000_000,
  total_cost_micro: 0,
  rows_done: 0,
  contacts_found: 0,
  emails_verified: 0,
  mobiles_found: 0,
  stop_reason: null,
  heartbeat_at: null,
  ...over,
});

const enriched: WaterfallResult = {
  status: "enriched",
  costMicro: 5000,
  contacts: [{
    personName: "Rajesh Sharma", personTitle: "Proprietor", personLinkedin: "",
    email: "r@x.com", emailStatus: "valid", mobile: "919876543210", mobileStatus: "live", costMicro: 5000,
  }],
};

describe("enrichRun", () => {
  it("does nothing at all when the run is already claimed by another worker", async () => {
    const { admin, inserted } = fakeAdmin(baseRun(), [], { claim: false });

    const out = await enrichRun(admin, "run-1", { enrich: vi.fn() as never });

    expect(out).toMatchObject({ claimed: false });
    expect(inserted.re_lead_contacts).toHaveLength(0);
  });

  it("enriches every lead, writes a contact row, and advances next_index to the end", async () => {
    const run = baseRun();
    const { admin, inserted, leadPatches } = fakeAdmin(run, [
      { id: 1, name: "A", website: "https://a.com" },
      { id: 2, name: "B", website: "https://b.com" },
    ]);

    const out = await enrichRun(admin, "run-1", { enrich: vi.fn(async () => enriched) as never });

    expect(out).toMatchObject({ claimed: true, advanced: 2, status: "finished", handOff: false });
    expect(run.next_index).toBe(2);
    expect(inserted.re_lead_contacts).toHaveLength(2);
    expect(run.contacts_found).toBe(2);
    expect(run.emails_verified).toBe(2);
    expect(run.mobiles_found).toBe(2);
    expect(run.total_cost_micro).toBe(10_000);
    expect(leadPatches[1]).toMatchObject({ enrich_status: "enriched", best_email: "r@x.com", best_mobile: "919876543210" });
  });

  it("marks a row with no domain without writing a contact or charging anything", async () => {
    const run = baseRun({ lead_ids: [1] });
    const { admin, inserted, leadPatches } = fakeAdmin(run, [{ id: 1, name: "A", website: "" }]);

    await enrichRun(admin, "run-1", {
      enrich: vi.fn(async () => ({ status: "no_domain", contacts: [], costMicro: 0 })) as never,
    });

    expect(inserted.re_lead_contacts).toHaveLength(0);
    expect(leadPatches[1]).toMatchObject({ enrich_status: "no_domain", enrich_cost_micro: 0 });
    expect(run.total_cost_micro).toBe(0);
  });

  it("stops on a cancel request, keeping next_index where it got to", async () => {
    const run = baseRun({ cancel_requested: true, lead_ids: [1, 2, 3] });
    const { admin } = fakeAdmin(run, [{ id: 1, name: "A", website: "https://a.com" }]);

    const out = await enrichRun(admin, "run-1", { enrich: vi.fn(async () => enriched) as never });

    expect(out.status).toBe("stopped");
    expect(out.handOff).toBe(false);
  });

  it("pauses as queued with stop_reason cost_cap, not failed, when the ceiling is reached", async () => {
    // Ceiling is below one row's cost, so the first batch exhausts it.
    const run = baseRun({ max_cost_micro: 1_000, lead_ids: [1, 2] });
    const { admin } = fakeAdmin(run, [
      { id: 1, name: "A", website: "https://a.com" },
      { id: 2, name: "B", website: "https://b.com" },
    ]);

    const out = await enrichRun(admin, "run-1", { enrich: vi.fn(async () => enriched) as never });

    expect(run.status).toBe("queued");
    expect(run.stop_reason).toBe("cost_cap");
    expect(out.handOff).toBe(false);
  });

  it("hands off when it runs out of time with rows still owed", async () => {
    const run = baseRun({ lead_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    const leads = run.lead_ids.map((id) => ({ id, name: `L${id}`, website: `https://l${id}.com` }));
    const { admin } = fakeAdmin(run, leads);

    // Clock jumps past the worker budget after the first batch.
    let t = 0;
    const out = await enrichRun(admin, "run-1", {
      now: () => (t += 200_000),
      enrich: vi.fn(async () => enriched) as never,
    });

    expect(out.handOff).toBe(true);
    expect(run.status).toBe("queued");
    expect(run.next_index).toBeLessThan(10);
  });

  it("clears the heartbeat on every exit, because the heartbeat is the lock", async () => {
    const run = baseRun({ heartbeat_at: "2026-10-17T00:00:00Z", lead_ids: [1] });
    const { admin } = fakeAdmin(run, [{ id: 1, name: "A", website: "https://a.com" }]);

    await enrichRun(admin, "run-1", { enrich: vi.fn(async () => enriched) as never });

    expect(run.heartbeat_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/revenue/enrich-runner.test.ts`
Expected: FAIL — `Failed to resolve import "./enrich-runner"`.

- [ ] **Step 3: Write the runner**

```ts
// src/lib/revenue/enrich-runner.ts
// ============================================================
// The enrichment run IS the job, exactly as the harvest run is.
//
//   next_index       where to carry on
//   heartbeat_at     proof a worker holds it — and therefore the lock
//   cancel_requested Stop
//   stop_reason      why it paused, so a pause reads differently from an ending
//
// re_enrich_claim_run (for update skip locked) is the whole safety story: two
// workers on one run would pay a provider twice for every row.
//
// heartbeat_at is cleared on EVERY exit, on purpose. A worker that leaves it set
// locks the run until the 90-second staleness window passes.
// ============================================================

import { serviceClient } from "@/lib/auth/superadmin";
import { createTregClient, tregToken, type AttemptRow } from "./treg-client";
import { enrichLead } from "./enrich-waterfall";
import type { Admin } from "./discovery-runner";

/** Four minutes of work, then hand on. Matches the discovery worker. */
export const ENRICH_WORKER_BUDGET_MS = 240_000;

/**
 * Rows in flight at once.
 *
 * Five is enough to finish 200 rows in a few chunks, and small enough that one
 * provider's rate limit does not poison the whole run.
 */
export const ENRICH_CONCURRENCY = 5;

export interface EnrichOutcome {
  claimed: boolean;
  advanced: number;
  status: string;
  handOff: boolean;
}

export interface EnrichDeps {
  now?: () => number;
  enrich?: typeof enrichLead;
}

const NOT_CLAIMED: EnrichOutcome = { claimed: false, advanced: 0, status: "busy", handOff: true };

export async function enrichRun(admin: Admin, runId: string, deps: EnrichDeps = {}): Promise<EnrichOutcome> {
  const now = deps.now ?? Date.now;
  const enrich = deps.enrich ?? enrichLead;
  const startedAt = now();

  const { data: claimed } = await admin.rpc("re_enrich_claim_run", { p_run_id: runId });
  if (claimed !== true) return NOT_CLAIMED;

  const token = tregToken();
  if (!token) {
    await release(admin, runId, { status: "failed", last_error: "TREG_TOKEN is not configured" });
    return { claimed: true, advanced: 0, status: "failed", handOff: false };
  }

  const { data: run } = await admin.from("re_enrich_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return { claimed: true, advanced: 0, status: "failed", handOff: false };

  const leadIds: number[] = run.lead_ids ?? [];
  let index: number = run.next_index ?? 0;
  let advanced = 0;

  const client = createTregClient({
    token,
    runId,
    maxCostMicro: run.max_cost_micro,
    spentMicro: run.total_cost_micro ?? 0,
    recordAttempt: (row) => recordAttempt(admin, row),
  });

  const totals = {
    rows: run.rows_done ?? 0,
    contacts: run.contacts_found ?? 0,
    emails: run.emails_verified ?? 0,
    mobiles: run.mobiles_found ?? 0,
  };

  while (index < leadIds.length) {
    // Stop is checked per batch, so pressing it takes effect within seconds.
    const { data: live } = await admin
      .from("re_enrich_runs")
      .select("cancel_requested")
      .eq("id", runId)
      .maybeSingle();
    if (live?.cancel_requested) {
      await release(admin, runId, { status: "stopped", next_index: index, stop_reason: "cancelled" });
      return { claimed: true, advanced, status: "stopped", handOff: false };
    }

    const batch = leadIds.slice(index, index + ENRICH_CONCURRENCY);
    const { data: leads } = await admin
      .from("re_discovery_leads")
      .select("id, name, website")
      .in("id", batch);

    const byId = new Map((leads ?? []).map((l: LeadRow) => [l.id, l]));

    await Promise.all(
      batch.map(async (leadId) => {
        const lead = byId.get(leadId);
        if (!lead) return;

        let result;
        try {
          result = await enrich(client, lead);
        } catch (err) {
          console.error("[enrich] lead threw", leadId, err);
          await admin
            .from("re_discovery_leads")
            .update({ enrich_status: "failed", enriched_at: new Date().toISOString() })
            .eq("id", leadId);
          return;
        }

        totals.rows++;
        if (result.contacts.length) {
          const contact = result.contacts[0];
          await admin.from("re_lead_contacts").insert({
            lead_id: leadId,
            run_id: runId,
            is_primary: true,
            person_name: contact.personName,
            person_title: contact.personTitle,
            person_linkedin: contact.personLinkedin,
            email: contact.email,
            email_status: contact.emailStatus,
            mobile: contact.mobile,
            mobile_status: contact.mobileStatus,
            cost_micro: contact.costMicro,
          });
          totals.contacts++;
          // Only a checked mailbox counts. catch_all means nothing was learnt.
          if (contact.emailStatus === "valid") totals.emails++;
          if (contact.mobileStatus === "live") totals.mobiles++;

          await admin
            .from("re_discovery_leads")
            .update({
              enrich_status: result.status,
              enrich_cost_micro: result.costMicro,
              enriched_at: new Date().toISOString(),
              best_email: contact.email,
              best_email_status: contact.emailStatus,
              best_mobile: contact.mobile,
            })
            .eq("id", leadId);
        } else {
          await admin
            .from("re_discovery_leads")
            .update({
              enrich_status: result.status,
              enrich_cost_micro: result.costMicro,
              enriched_at: new Date().toISOString(),
            })
            .eq("id", leadId);
        }
      }),
    );

    index += batch.length;
    advanced += batch.length;

    await admin
      .from("re_enrich_runs")
      .update({
        next_index: index,
        heartbeat_at: new Date().toISOString(),
        total_cost_micro: client.spentMicro(),
        rows_done: totals.rows,
        contacts_found: totals.contacts,
        emails_verified: totals.emails,
        mobiles_found: totals.mobiles,
      })
      .eq("id", runId);

    // The ceiling is a pause, not an ending: next_index stays put, so raising
    // it resumes rather than re-paying for finished rows.
    if (client.ceilingHit()) {
      await release(admin, runId, { status: "queued", next_index: index, stop_reason: "cost_cap" });
      return { claimed: true, advanced, status: "queued", handOff: false };
    }

    if (now() - startedAt >= ENRICH_WORKER_BUDGET_MS) break;
  }

  if (index >= leadIds.length) {
    await release(admin, runId, {
      status: "finished",
      next_index: index,
      finished_at: new Date().toISOString(),
    });
    return { claimed: true, advanced, status: "finished", handOff: false };
  }

  await release(admin, runId, { status: "queued", next_index: index });
  return { claimed: true, advanced, status: "queued", handOff: true };
}

interface LeadRow {
  id: number;
  name: string;
  website: string;
}

/** A receipt that cannot be written must not take the run down with it. */
async function recordAttempt(admin: Admin, row: AttemptRow): Promise<void> {
  const { error } = await admin.from("re_enrich_attempts").insert(row);
  if (error) console.error("[enrich] could not record an attempt", row.endpoint_id, error.message);
}

/**
 * Lets go of the run.
 *
 * heartbeat_at is cleared on every exit on purpose: it is the lock, and the next
 * worker must be able to claim immediately rather than waiting out the staleness
 * window.
 */
async function release(admin: Admin, runId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin
    .from("re_enrich_runs")
    .update({ heartbeat_at: null, ...patch })
    .eq("id", runId);
  if (error) console.error("[enrich] could not release the run", runId, error.message);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/revenue/enrich-runner.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/revenue/enrich-runner.ts src/lib/revenue/enrich-runner.test.ts
git commit -m "feat(enrich): add the background runner with claim, ceiling and hand-off"
```

---

### Task 6: The chain and the worker route

**Files:**
- Create: `src/lib/revenue/enrich-chain.ts`
- Create: `src/app/api/admin/revenue/enrich/worker/route.ts`

**Interfaces:**
- Consumes: `enrichRun` from `./enrich-runner`; `serviceClient`; `type Admin`.
- Produces: `ENRICH_WORKER_PATH`, `enrichAndHandOn(baseUrl, runId, link?)`, `kickEnrichWorker(baseUrl, runId, link?)`, `authorizeEnrichWorker(admin, runId, token, authorization)`.

- [ ] **Step 1: Write the chain, mirroring `discovery-chain.ts`**

```ts
// src/lib/revenue/enrich-chain.ts
// ============================================================
// How an enrichment run outlives one serverless invocation.
//
// Identical in shape to discovery-chain.ts, and for the identical reason: a
// worker gets about four minutes, a 200-row run needs more, so each worker hands
// on by POSTing to the worker route, which answers before it starts working.
//
// The hand-off authenticates with a single-use token written on the run, NOT
// CRON_SECRET, which is still unset on this project. A feature must not be one
// unset environment variable away from silently not working.
//
// Every exit leaves the run claimable, so a lost link costs a delay — never a
// row, and never a provider call paid for twice.
// ============================================================

import { randomUUID } from "node:crypto";
import { serviceClient } from "@/lib/auth/superadmin";
import { enrichRun } from "./enrich-runner";
import type { Admin } from "./discovery-runner";

/** Twenty links is well over an hour: a burn-out limit, not an expected one. */
const MAX_CHAIN_LINKS = 20;

export const ENRICH_WORKER_PATH = "/api/admin/revenue/enrich/worker";

/** Call this from `after()`, never inline: it runs for minutes. */
export async function enrichAndHandOn(baseUrl: string, runId: string, link = 0): Promise<void> {
  const admin = serviceClient();

  let outcome;
  try {
    outcome = await enrichRun(admin, runId);
  } catch (err) {
    console.error("[enrich] worker threw", runId, err);
    return;
  }

  // Not claimed means another worker has it; a second worker would only lose
  // the same race.
  if (!outcome.claimed || !outcome.handOff) return;

  if (link + 1 >= MAX_CHAIN_LINKS) {
    console.error("[enrich] chain limit reached, leaving run queued", runId);
    return;
  }

  await kickEnrichWorker(baseUrl, runId, link + 1);
}

export async function kickEnrichWorker(baseUrl: string, runId: string, link = 0): Promise<boolean> {
  const admin = serviceClient();
  const token = await mintWorkerToken(admin, runId);
  if (!token) return false;

  try {
    const res = await fetch(`${baseUrl}${ENRICH_WORKER_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, link, token }),
      // The route answers before it works, so slower than this is a delivery
      // problem, not a busy worker.
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    console.error("[enrich] could not hand on", runId, err);
    return false;
  }
}

/** Overwrites any existing token, so a stale hand-off stops being redeemable. */
async function mintWorkerToken(admin: Admin, runId: string): Promise<string | null> {
  const token = randomUUID();
  const { error } = await admin.from("re_enrich_runs").update({ worker_token: token }).eq("id", runId);
  if (error) {
    console.error("[enrich] could not mint a hand-off token", runId, error.message);
    return null;
  }
  return token;
}

export async function authorizeEnrichWorker(
  admin: Admin,
  runId: string,
  token: string,
  authorization: string | null,
): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && authorization === `Bearer ${secret}`) return true;
  if (!token) return false;

  const { data } = await admin.rpc("re_enrich_redeem_token", { p_run_id: runId, p_token: token });
  return data === true;
}
```

- [ ] **Step 2: Write the worker route**

```ts
// src/app/api/admin/revenue/enrich/worker/route.ts
// ============================================================
// Answers first, works after. Each link in the chain is therefore a fast HTTP
// call and no invocation is left holding another one open.
//
// Not behind requireFounder(): there is no session here. It is authorised by the
// run's own single-use hand-off token.
// ============================================================

import { after, NextResponse } from "next/server";
import { serviceClient } from "@/lib/auth/superadmin";
import { authorizeEnrichWorker, enrichAndHandOn } from "@/lib/revenue/enrich-chain";

export const maxDuration = 300;

export async function POST(request: Request) {
  let payload: { runId?: string; link?: number; token?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const runId = (payload.runId ?? "").trim();
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const admin = serviceClient();
  const allowed = await authorizeEnrichWorker(
    admin,
    runId,
    (payload.token ?? "").trim(),
    request.headers.get("authorization"),
  );
  if (!allowed) return NextResponse.json({ error: "Not authorised for this run" }, { status: 401 });

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const link = Number(payload.link ?? 0);

  after(() => enrichAndHandOn(baseUrl, runId, link));

  return NextResponse.json({ accepted: true, runId, link });
}
```

- [ ] **Step 3: Verify it is deployed and gated, without a session**

A 401 proves the route exists and refuses an unauthorised caller. That is the designed answer, not a failure.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/revenue/enrich/worker -H "Content-Type: application/json" -d '{"runId":"00000000-0000-0000-0000-000000000000"}'
```

Expected: `401`. A `404` means the file is in the wrong place; a `400` means the body was not parsed.

- [ ] **Step 4: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint
git add src/lib/revenue/enrich-chain.ts src/app/api/admin/revenue/enrich/worker/route.ts
git commit -m "feat(enrich): chain workers with a single-use hand-off token"
```

---

### Task 7: The start and status route

**Files:**
- Create: `src/app/api/admin/revenue/enrich/route.ts`
- Test: `src/lib/revenue/enrich-cost.test.ts`

**Interfaces:**
- Consumes: `requireFounder` from `@/lib/auth/superadmin`; `estimateEnrichCostMicro`, `rupeesToMicro`, `microToRupees` from `@/lib/revenue/enrich-cost`; `toApexDomain`; `kickEnrichWorker`.
- Produces: `POST /api/admin/revenue/enrich` (body `{ leadIds: number[]; ceilingRupees: number }` → `{ runId }`), `GET /api/admin/revenue/enrich?runId=` → run status, `PATCH` with `{ runId, cancel: true }` → Stop, and `GET /api/admin/revenue/enrich?estimate=1&leadIds=…` → `CostEstimate`.

- [ ] **Step 1: Write the failing cost test**

```ts
// src/lib/revenue/enrich-cost.test.ts
import { describe, it, expect } from "vitest";
import { estimateEnrichCostMicro, microToRupees, rupeesToMicro, USD_INR } from "./enrich-cost";
import { toApexDomain } from "./enrich-domain";

describe("estimateEnrichCostMicro", () => {
  it("counts only rows with a usable domain as costing anything", () => {
    const domains = ["https://a.com", "", "https://gmail.com", "https://b.co.in"].map(toApexDomain);

    const e = estimateEnrichCostMicro(domains);

    expect(e.enrichable).toBe(2);
    expect(e.noDomain).toBe(2);
  });

  it("gives zero for a selection with no usable domain", () => {
    const e = estimateEnrichCostMicro(["", null, null]);
    expect(e.lowMicro).toBe(0);
    expect(e.highMicro).toBe(0);
  });

  it("scales linearly and keeps low below high", () => {
    const one = estimateEnrichCostMicro([toApexDomain("https://a.com")]);
    const ten = estimateEnrichCostMicro(Array(10).fill(toApexDomain("https://a.com")));

    expect(one.lowMicro).toBeLessThan(one.highMicro);
    expect(ten.highMicro).toBe(one.highMicro * 10);
  });

  it("keeps a 50-row estimate in the same region as treg's own published receipt", () => {
    // treg's receipt: 50 companies for $3.62. Allow a wide band.
    const e = estimateEnrichCostMicro(Array(50).fill("a.com"));
    expect(e.highMicro / 1_000_000).toBeGreaterThan(2);
    expect(e.highMicro / 1_000_000).toBeLessThan(20);
  });
});

describe("rupee conversion", () => {
  it("round-trips without drifting more than a paisa", () => {
    expect(microToRupees(rupeesToMicro(500))).toBeCloseTo(500, 2);
  });

  it("uses a fixed rate, so two runs stay comparable", () => {
    expect(microToRupees(1_000_000)).toBe(USD_INR);
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then passes**

Run: `npm test -- src/lib/revenue/enrich-cost.test.ts`
Expected: FAIL first if `enrich-cost.ts` lacks `rupeesToMicro`; then PASS, 6 tests, once Task 3's module is complete.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/admin/revenue/enrich/route.ts
// ============================================================
// Start, watch and stop an enrichment run. Founder-only.
//
// The ceiling is required on start and is the only protection against a
// mis-selection: it is written on the run, and the treg client refuses any call
// that would cross it.
// ============================================================

import { after, NextResponse } from "next/server";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { estimateEnrichCostMicro, microToRupees, rupeesToMicro } from "@/lib/revenue/enrich-cost";
import { toApexDomain } from "@/lib/revenue/enrich-domain";
import { kickEnrichWorker } from "@/lib/revenue/enrich-chain";
import { tregToken } from "@/lib/revenue/treg-client";

export const maxDuration = 300;

export async function GET(request: Request) {
  const gate = await requireFounder();
  if (!gate.ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const url = new URL(request.url);
  const admin = serviceClient();

  // ── Cost estimate for a selection, before anything is spent ──
  if (url.searchParams.get("estimate")) {
    const ids = parseIds(url.searchParams.get("leadIds"));
    if (!ids.length) return NextResponse.json({ error: "leadIds is required" }, { status: 400 });

    const { data: leads } = await admin
      .from("re_discovery_leads")
      .select("website, enrich_status")
      .in("id", ids);

    const fresh = (leads ?? []).filter((l) => l.enrich_status === "pending");
    const estimate = estimateEnrichCostMicro(fresh.map((l) => toApexDomain(l.website)));

    return NextResponse.json({
      ...estimate,
      alreadyEnriched: (leads ?? []).length - fresh.length,
      lowRupees: Math.ceil(microToRupees(estimate.lowMicro)),
      highRupees: Math.ceil(microToRupees(estimate.highMicro)),
      tokenConfigured: !!tregToken(),
    });
  }

  // ── Status of one run ──
  const runId = url.searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const { data: run } = await admin.from("re_enrich_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "No such run" }, { status: 404 });

  // Opening the page nudges a run that has gone quiet: a lost hand-off costs a
  // delay, not a run, and there is no cron on this project to recover it.
  const stale = !run.heartbeat_at || Date.now() - new Date(run.heartbeat_at).getTime() > 90_000;
  if (run.status === "queued" && stale && !run.cancel_requested && run.stop_reason !== "cost_cap") {
    const base = `${url.protocol}//${url.host}`;
    after(() => kickEnrichWorker(base, runId));
  }

  return NextResponse.json({
    ...run,
    spentRupees: microToRupees(run.total_cost_micro),
    ceilingRupees: microToRupees(run.max_cost_micro),
    total: (run.lead_ids ?? []).length,
  });
}

export async function POST(request: Request) {
  const gate = await requireFounder();
  if (!gate.ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  if (!tregToken()) {
    return NextResponse.json({ error: "TREG_TOKEN is not configured on this deployment" }, { status: 503 });
  }

  let body: { leadIds?: number[]; ceilingRupees?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const ids = (body.leadIds ?? []).map(Number).filter((n) => Number.isFinite(n));
  const ceilingRupees = Number(body.ceilingRupees ?? 0);
  if (!ids.length) return NextResponse.json({ error: "Select at least one row" }, { status: 400 });
  if (!(ceilingRupees > 0)) return NextResponse.json({ error: "Set a spending ceiling first" }, { status: 400 });

  const admin = serviceClient();

  // Only rows never enriched, and only rows with a usable domain, go in the
  // run. Putting the others in would spend the ceiling on certain failures.
  const { data: leads } = await admin
    .from("re_discovery_leads")
    .select("id, website, enrich_status")
    .in("id", ids);

  const queued = (leads ?? [])
    .filter((l) => l.enrich_status === "pending" && toApexDomain(l.website))
    .map((l) => l.id);

  const noDomain = (leads ?? []).filter((l) => l.enrich_status === "pending" && !toApexDomain(l.website));
  if (noDomain.length) {
    await admin
      .from("re_discovery_leads")
      .update({ enrich_status: "no_domain", enriched_at: new Date().toISOString() })
      .in("id", noDomain.map((l) => l.id));
  }

  if (!queued.length) {
    return NextResponse.json(
      { error: "None of those rows can be enriched: no website, or already done", noDomain: noDomain.length },
      { status: 400 },
    );
  }

  // One live run at a time. Two would race the same ceiling.
  const { data: live } = await admin
    .from("re_enrich_runs")
    .select("id, heartbeat_at")
    .in("status", ["queued", "running"])
    .limit(1);
  if (live?.length) {
    return NextResponse.json({ error: "An enrichment run is already going", runId: live[0].id }, { status: 409 });
  }

  const { data: run, error } = await admin
    .from("re_enrich_runs")
    .insert({ lead_ids: queued, max_cost_micro: rupeesToMicro(ceilingRupees), status: "queued" })
    .select("id")
    .maybeSingle();

  if (error || !run) {
    return NextResponse.json({ error: error?.message ?? "Could not start the run" }, { status: 500 });
  }

  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}`;
  after(() => kickEnrichWorker(base, run.id));

  return NextResponse.json({ runId: run.id, queued: queued.length, skippedNoDomain: noDomain.length });
}

export async function PATCH(request: Request) {
  const gate = await requireFounder();
  if (!gate.ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { runId?: string; cancel?: boolean };
  if (!body.runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const admin = serviceClient();
  // A deliberate Stop is recorded, so the page offers it back rather than
  // restarting it behind his back.
  await admin
    .from("re_enrich_runs")
    .update({ cancel_requested: true, stop_reason: "cancelled" })
    .eq("id", body.runId);

  return NextResponse.json({ stopping: true });
}

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw.split(",").map(Number).filter((n) => Number.isFinite(n));
}
```

- [ ] **Step 4: Verify the gate and the estimate by hand**

```bash
npm run dev
```

Then, unauthenticated: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/admin/revenue/enrich?runId=x"`
Expected: `403`.

Signed in as the founder in the browser, open `/api/admin/revenue/enrich?estimate=1&leadIds=<three real ids>`.
Expected: JSON with `enrichable`, `noDomain`, `lowRupees`, `highRupees`, `tokenConfigured: true`.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint
git add src/app/api/admin/revenue/enrich/route.ts src/lib/revenue/enrich-cost.test.ts
git commit -m "feat(enrich): add the start, status and stop route with a cost estimate"
```

---

### Task 8: The Enrich tab

**Files:**
- Create: `src/components/revenue/enrich-panel.tsx`
- Modify: the Lead Discovery page under `src/app/(admin)/admin/revenue/discover/` — add an Enrich tab rendering `<EnrichPanel />`. Read the existing page first and follow its tab and card patterns; do not restructure it.

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/admin/revenue/enrich`.
- Produces: `<EnrichPanel />`, a client component.

- [ ] **Step 1: Read the existing page and copy its idiom**

```bash
ls src/app/\(admin\)/admin/revenue/discover/ && grep -rn "Tabs\|TabsTrigger" src/app/\(admin\)/admin/revenue/discover/ | head
```

Match whatever tab primitive is already there. Note from memory: the dropdown menu primitive in this repo is **Base UI, not Radix**, and a `DropdownMenuLabel` outside a `Group` throws and kills the page.

- [ ] **Step 2: Write the panel**

```tsx
"use client";

// ============================================================
// The Enrich tab. Select harvested rows, see what they could cost, set a
// ceiling, start, then close the tab if you like.
//
// Polling, not realtime: a run writes its counters every batch, and a four-second
// poll is cheaper to reason about than a subscription that must be torn down.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";

interface Estimate {
  enrichable: number;
  noDomain: number;
  alreadyEnriched: number;
  lowRupees: number;
  highRupees: number;
  tokenConfigured: boolean;
}

interface RunStatus {
  id: string;
  status: string;
  stop_reason: string | null;
  rows_done: number;
  total: number;
  contacts_found: number;
  emails_verified: number;
  mobiles_found: number;
  spentRupees: number;
  ceilingRupees: number;
}

const POLL_MS = 4000;
/** Survives a reload, so a closed tab finds its run again. */
const RUN_KEY = "ozzo.enrich.runId";

export function EnrichPanel({ selectedLeadIds }: { selectedLeadIds: number[] }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [ceiling, setCeiling] = useState(500);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Estimate, whenever the selection changes ──
  useEffect(() => {
    if (!selectedLeadIds.length) return setEstimate(null);
    let live = true;
    fetch(`/api/admin/revenue/enrich?estimate=1&leadIds=${selectedLeadIds.join(",")}`)
      .then((r) => r.json())
      .then((d) => live && setEstimate(d))
      .catch(() => live && setError("Could not work out the cost"));
    return () => void (live = false);
  }, [selectedLeadIds]);

  const poll = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/admin/revenue/enrich?runId=${runId}`);
      if (!res.ok) throw new Error();
      const data: RunStatus = await res.json();
      setRun(data);

      if (data.status === "queued" || data.status === "running") {
        timer.current = setTimeout(() => poll(runId), POLL_MS);
      } else {
        window.localStorage.removeItem(RUN_KEY);
      }
    } catch {
      // A failed poll is not a failed run; try again.
      timer.current = setTimeout(() => poll(runId), POLL_MS * 2);
    }
  }, []);

  // ── Pick a run back up after a reload ──
  useEffect(() => {
    const saved = window.localStorage.getItem(RUN_KEY);
    if (saved) poll(saved);
    return () => void (timer.current && clearTimeout(timer.current));
  }, [poll]);

  async function start() {
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/revenue/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: selectedLeadIds, ceilingRupees: ceiling }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start");
      window.localStorage.setItem(RUN_KEY, data.runId);
      poll(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    if (!run) return;
    await fetch("/api/admin/revenue/enrich", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id, cancel: true }),
    });
  }

  const live = run?.status === "queued" || run?.status === "running";

  return (
    <div className="space-y-4">
      {estimate && !estimate.tokenConfigured && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          TREG_TOKEN is not set on this deployment, so enrichment cannot run. Add it in Vercel and redeploy.
        </p>
      )}

      {estimate && !live && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Enrich {estimate.enrichable} companies</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>{estimate.enrichable} have a website and can be enriched</li>
            <li>{estimate.noDomain} have no usable website — these cost nothing and are marked as such</li>
            <li>{estimate.alreadyEnriched} were already done and are skipped</li>
          </ul>
          <p className="text-sm">
            Estimated cost <strong>₹{estimate.lowRupees}–₹{estimate.highRupees}</strong>. You are never charged more
            than your ceiling.
          </p>
          <label className="flex items-center gap-2 text-sm">
            Stop spending after ₹
            <input
              type="number"
              min={1}
              value={ceiling}
              onChange={(e) => setCeiling(Number(e.target.value))}
              className="w-24 rounded border px-2 py-1"
            />
          </label>
          <button
            type="button"
            onClick={start}
            disabled={starting || !estimate.enrichable || ceiling < estimate.lowRupees || !estimate.tokenConfigured}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {starting ? "Starting…" : `Enrich ${estimate.enrichable} companies`}
          </button>
          {ceiling < estimate.lowRupees && (
            <p className="text-xs text-amber-700">
              A ceiling below ₹{estimate.lowRupees} would stop the run almost immediately.
            </p>
          )}
        </div>
      )}

      {run && (
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">
              {live ? "Enriching…" : run.stop_reason === "cost_cap" ? "Paused: ceiling reached" : `Run ${run.status}`}
            </h3>
            {live && (
              <button type="button" onClick={stop} className="rounded border px-3 py-1 text-sm">
                Stop
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {run.rows_done} of {run.total} done · {run.contacts_found} people found · {run.emails_verified} emails
            verified · {run.mobiles_found} mobiles · spent ₹{run.spentRupees.toFixed(2)} of ₹
            {run.ceilingRupees.toFixed(0)}
          </p>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.round((run.rows_done / Math.max(1, run.total)) * 100)}%` }}
            />
          </div>
          {live && <p className="text-xs text-muted-foreground">You can close this tab. The run carries on.</p>}
          {run.stop_reason === "cost_cap" && (
            <p className="text-xs text-amber-700">
              Raise the ceiling and start again to carry on from row {run.rows_done} — finished rows are not paid for
              twice.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Wire the tab into the discover page**

Add the tab beside the existing ones, passing the selected row ids from the harvest table.

- [ ] **Step 4: Verify in the browser against a 2-row run**

```bash
npm run dev
```

Open `/admin/revenue/discover`, pick **two** rows that have websites, set the ceiling to ₹20, start. Expected: counters move, spend appears in ₹, the tab can be closed and reopened and the run is picked back up, and Stop ends it.

Then confirm the money and the receipts landed:

```bash
cd wacrm-web && URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL' .env.local | cut -d= -f2- | tr -d '"\r') && KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env.local | cut -d= -f2- | tr -d '"\r') && curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "${URL}/rest/v1/re_enrich_attempts?select=step,served_by,cost_micro,outcome&order=id.desc&limit=10"
```

Expected: one row per call, with a real `served_by` and a `cost_micro` that sums to what the UI showed.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint
git add src/components/revenue/enrich-panel.tsx src/app/\(admin\)/admin/revenue/discover/
git commit -m "feat(enrich): add the Enrich tab with a cost ceiling and live counters"
```

---

### Task 9: The attempt-history drawer

**Files:**
- Create: `src/app/api/admin/revenue/enrich/attempts/route.ts`
- Create: `src/components/revenue/enrich-attempts-drawer.tsx`
- Modify: the harvest table component, to open the drawer from a row.

**Interfaces:**
- Consumes: `re_enrich_attempts`, `re_lead_contacts`, `microToRupees`.
- Produces: `GET /api/admin/revenue/enrich/attempts?leadId=` → `{ attempts: AttemptView[]; contacts: ContactView[] }`; `<EnrichAttemptsDrawer leadId open onClose />`.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/admin/revenue/enrich/attempts/route.ts
import { NextResponse } from "next/server";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { microToRupees } from "@/lib/revenue/enrich-cost";

export async function GET(request: Request) {
  const gate = await requireFounder();
  if (!gate.ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const leadId = Number(new URL(request.url).searchParams.get("leadId"));
  if (!Number.isFinite(leadId)) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

  const admin = serviceClient();
  const [{ data: attempts }, { data: contacts }] = await Promise.all([
    admin
      .from("re_enrich_attempts")
      .select("step, endpoint_id, served_by, cost_micro, outcome, http_status, created_at")
      .eq("lead_id", leadId)
      .order("id", { ascending: true }),
    admin
      .from("re_lead_contacts")
      .select("person_name, person_title, email, email_status, mobile, mobile_status, cost_micro")
      .eq("lead_id", leadId)
      .order("is_primary", { ascending: false }),
  ]);

  return NextResponse.json({
    attempts: (attempts ?? []).map((a) => ({ ...a, rupees: microToRupees(a.cost_micro) })),
    contacts: contacts ?? [],
    totalRupees: microToRupees((attempts ?? []).reduce((sum, a) => sum + a.cost_micro, 0)),
  });
}
```

- [ ] **Step 2: Write the drawer**

```tsx
"use client";

// ============================================================
// Which provider was asked, in what order, what it said, and what it cost.
//
// This is the screen that tells you whether treg's providers actually cover
// Indian SMBs — the one thing nobody could know before running it.
// ============================================================

import { useEffect, useState } from "react";

interface Attempt {
  step: string;
  endpoint_id: string;
  served_by: string;
  outcome: string;
  http_status: number;
  rupees: number;
}
interface Contact {
  person_name: string;
  person_title: string;
  email: string;
  email_status: string;
  mobile: string;
  mobile_status: string;
}

const STEP_LABEL: Record<string, string> = {
  company_people: "1. Who works here",
  person_search: "2. Find the decision-maker",
  email_find: "3. Find their email",
  email_verify: "4. Verify the mailbox",
  phone_find: "5. Find the mobile",
};

const OUTCOME_LABEL: Record<string, string> = {
  hit: "found",
  miss: "nothing",
  cached: "from cache",
  rate_limited: "rate limited, moved on",
  uncharged: "refused, not charged",
  error: "error",
};

export function EnrichAttemptsDrawer({ leadId, open, onClose }: { leadId: number | null; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<{ attempts: Attempt[]; contacts: Contact[]; totalRupees: number } | null>(null);

  useEffect(() => {
    if (!open || !leadId) return;
    setData(null);
    fetch(`/api/admin/revenue/enrich/attempts?leadId=${leadId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ attempts: [], contacts: [], totalRupees: 0 }));
  }, [open, leadId]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-4 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-medium">What we asked, and what it cost</h3>
        <button type="button" onClick={onClose} className="rounded border px-2 py-1 text-sm">
          Close
        </button>
      </div>

      {!data && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data?.contacts.map((c) => (
        <div key={c.email + c.mobile} className="mb-4 rounded-lg border p-3 text-sm">
          <p className="font-medium">{c.person_name || "No name found"}</p>
          {c.person_title && <p className="text-muted-foreground">{c.person_title}</p>}
          {c.email && (
            <p>
              {c.email}{" "}
              <span className={c.email_status === "valid" ? "text-green-700" : "text-amber-700"}>
                ({c.email_status === "catch_all" ? "catch-all — proves nothing" : c.email_status})
              </span>
            </p>
          )}
          {c.mobile && (
            <p>
              {c.mobile} <span className="text-muted-foreground">({c.mobile_status})</span>
            </p>
          )}
        </div>
      ))}

      <ol className="space-y-2">
        {data?.attempts.map((a, i) => (
          <li key={i} className="rounded border p-2 text-sm">
            <div className="flex justify-between">
              <span>{STEP_LABEL[a.step] ?? a.step}</span>
              <span className="text-muted-foreground">₹{a.rupees.toFixed(3)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {a.served_by || a.endpoint_id} — {OUTCOME_LABEL[a.outcome] ?? a.outcome}
            </p>
          </li>
        ))}
      </ol>

      {data && (
        <p className="mt-4 text-sm">
          Total for this company: <strong>₹{data.totalRupees.toFixed(2)}</strong>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Open it from a row and verify against a real enriched lead**

Expected: the five steps in order, the provider that answered each, a per-step cost, and a total that matches that row's `enrich_cost_micro`.

- [ ] **Step 4: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint
git add src/app/api/admin/revenue/enrich/attempts/route.ts src/components/revenue/enrich-attempts-drawer.tsx
git commit -m "feat(enrich): show the per-company attempt history and its cost"
```

---

### Task 10: CSV export with the enriched columns

**Files:**
- Modify: `src/lib/revenue/discovery-query.ts` — extend `CSV_HEADERS` and `toCsv`
- Modify: `src/lib/revenue/discovery-query.test.ts` — extend the CSV tests
- Modify: the existing CSV download handler on the discover route

**Interfaces:**
- Consumes: `CSV_HEADERS`, `toCsv`, `csvCell`, `type DiscoveryRow` from `./discovery-query`.
- Produces: `DiscoveryRow` gains `contactName`, `contactTitle`, `email`, `emailStatus`, `mobile`, `mobileStatus`; `CSV_HEADERS` gains the six matching headers.

- [ ] **Step 1: Read the current CSV shape before touching it**

```bash
grep -n "CSV_HEADERS" -A 25 src/lib/revenue/discovery-query.ts
```

- [ ] **Step 2: Write the failing test**

```ts
// Append to src/lib/revenue/discovery-query.test.ts
it("carries the enriched contact columns, with catch-all distinguishable from valid", () => {
  const row: DiscoveryRow = {
    ...({} as DiscoveryRow),
    name: "Jay AMBE Industries",
    phone: "919876543210",
    website: "https://jayambeindustry.com/",
    contactName: "Rajesh Sharma",
    contactTitle: "Proprietor",
    email: "rajesh@jayambeindustry.com",
    emailStatus: "catch_all",
    mobile: "919812345678",
    mobileStatus: "live",
  };

  const csv = toCsv([row]);
  const [header, line] = csv.split("\n");

  expect(header).toContain("Contact Name");
  expect(header).toContain("Email Status");
  expect(header).toContain("Mobile Status");
  expect(line).toContain("Rajesh Sharma");
  expect(line).toContain("catch_all");
  // Digits only: a leading + would be read as a formula by Excel.
  expect(line).toContain("919812345678");
  expect(line).not.toContain("+91");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/lib/revenue/discovery-query.test.ts`
Expected: FAIL — `Contact Name` not in the header.

- [ ] **Step 4: Extend the headers, the row type and the serialiser**

Add to `DiscoveryRow`: `contactName: string; contactTitle: string; email: string; emailStatus: string; mobile: string; mobileStatus: string`. Append to `CSV_HEADERS`, in the same order: `"Contact Name", "Contact Title", "Email", "Email Status", "Mobile", "Mobile Status"`, and emit them through the existing `csvCell` in `toCsv`. Default every one to `""` wherever a `DiscoveryRow` is built, so an un-enriched harvest still exports.

- [ ] **Step 5: Run the whole suite, not just this file**

Run: `npm test`
Expected: PASS throughout. The existing CSV tests assert header positions, so a header inserted in the middle rather than appended will fail here — append.

- [ ] **Step 6: Download a real CSV and open it**

Expected: the six new columns present, populated for enriched rows and empty for the rest, and the mobile column showing `91…` rather than `+91…`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/revenue/discovery-query.ts src/lib/revenue/discovery-query.test.ts src/app/\(admin\)/admin/revenue/discover/
git commit -m "feat(enrich): export contact, email and mobile columns in the harvest CSV"
```

---

### Task 11: The 90-day purge and the opt-out

**Files:**
- Modify: `src/lib/revenue/discovery-runner.ts` — extend `purgeOldLeads`
- Test: `src/lib/revenue/enrich-retention.test.ts`
- Modify: `src/app/api/admin/revenue/enrich/attempts/route.ts` — honour `opted_out`

**Interfaces:**
- Consumes: `purgeOldLeads(admin)`.
- Produces: `purgeOldContacts(admin: Admin): Promise<number>`; exports exclude `opted_out` rows.

- [ ] **Step 1: Read how discovery already purges**

```bash
grep -n "purgeOldLeads" -A 30 src/lib/revenue/discovery-runner.ts
```

Note from memory: the purge runs **from the GET handler on page load**, not from a cron — `CRON_SECRET` is unset, so `/api/cron/retention` has never actually run. Follow the page-load pattern.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/revenue/enrich-retention.test.ts
import { describe, it, expect, vi } from "vitest";
import { purgeOldContacts } from "./discovery-runner";

describe("purgeOldContacts", () => {
  it("deletes contacts older than 90 days but keeps an opted-out tombstone", async () => {
    const calls: { table: string; filters: Record<string, unknown> }[] = [];
    const admin = {
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const chain: Record<string, unknown> = {
          delete: () => chain,
          lt: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            calls.push({ table, filters });
            return Promise.resolve({ error: null, count: 3 });
          },
        };
        return chain as never;
      },
    };

    await purgeOldContacts(admin as never);

    expect(calls[0].table).toBe("re_lead_contacts");
    // Opted-out rows survive the purge as a do-not-contact record.
    expect(calls[0].filters.opted_out).toBe(false);
    const cutoff = new Date(String(calls[0].filters.created_at));
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/lib/revenue/enrich-retention.test.ts`
Expected: FAIL — `purgeOldContacts` is not exported.

- [ ] **Step 4: Write the purge**

```ts
// Append to src/lib/revenue/discovery-runner.ts, beside purgeOldLeads.

/** Matches the harvest's own bound. Business data is kept; people are not. */
const CONTACT_RETENTION_DAYS = 90;

/**
 * Drops enriched contacts older than the retention bound.
 *
 * A director's name, personal email and personal mobile are personal data about
 * a named individual, which India's DPDP Act 2023 governs. The harvest already
 * bounds prospect rows at 90 days; contacts get the same bound rather than being
 * warehoused.
 *
 * Opted-out rows are deliberately NOT deleted: they are the do-not-contact
 * record, and losing one would mean contacting someone who asked not to be.
 */
export async function purgeOldContacts(admin: Admin): Promise<number> {
  const cutoff = new Date(Date.now() - CONTACT_RETENTION_DAYS * 86_400_000).toISOString();

  const { error, count } = await admin
    .from("re_lead_contacts")
    .delete({ count: "exact" })
    .lt("created_at", cutoff)
    .eq("opted_out", false);

  if (error) {
    console.error("[enrich] could not purge old contacts", error.message);
    return 0;
  }
  return count ?? 0;
}
```

- [ ] **Step 5: Call it wherever `purgeOldLeads` is called, and exclude opt-outs from export**

In the discover route's GET handler, call `purgeOldContacts(admin)` next to the existing `purgeOldLeads(admin)`. In the CSV builder and the attempts route, filter `.eq("opted_out", false)` so an opted-out person is never exported again.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS throughout.

- [ ] **Step 7: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint
git add src/lib/revenue/discovery-runner.ts src/lib/revenue/enrich-retention.test.ts src/app/api/admin/revenue/enrich/attempts/route.ts src/app/\(admin\)/admin/revenue/discover/
git commit -m "feat(enrich): bound enriched contacts to 90 days and honour opt-outs"
```

---

### Task 12: Deploy and verify on production

**Files:** none.

- [ ] **Step 1: Set `TREG_TOKEN` in Vercel**

Project settings → Environment Variables → `TREG_TOKEN`, all environments. Note from memory: Vercel names the Supabase service key `service_role`, so do not assume env names match the local file.

- [ ] **Step 2: Confirm the migration ran on production**

Re-run Task 2 Step 3's curl loop against production. Expected: `200` four times.

- [ ] **Step 3: Push to main**

```bash
git push origin main
```

Vercel deploys `main`; branch work never reaches live.

- [ ] **Step 4: Probe the deployed worker route's auth branch**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.ozzo.co.in/api/admin/revenue/enrich/worker -H "Content-Type: application/json" -d '{"runId":"00000000-0000-0000-0000-000000000000"}'
```

Expected: `401` — deployed and gated. `404` means it is not deployed; `503` would mean an env variable is missing.

- [ ] **Step 5: Run five real rows end to end on production, with a ₹50 ceiling**

Expected: counters move, the run finishes by itself with the tab closed, `re_enrich_attempts` holds one row per call, and the summary columns on `re_discovery_leads` are populated.

- [ ] **Step 6: Report the commit hash and the real numbers**

A fix is not done until it is pushed and deployed. Give the founder the hash, the rows enriched, the hit rates, and the rupees spent.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the three guardrails → Task 3; D1 → Task 7 (separate route, explicit ceiling); D2 → Tasks 5 and 6; D3 → Task 1; D4 → Task 4; D5 → Tasks 2, 3 and 9; D6 → Tasks 2 and 5; D7 → Tasks 5 and 8; D8 → nothing built, as intended; D9 → Task 5 (`ENRICH_CONCURRENCY`); D10 → Tasks 4, 5 and 9; data model → Task 2; client contract → Task 3; UI → Tasks 8 and 9; Step 0 spike → Task 0; DPDP decisions → Task 11; testing → the test steps throughout. The three "Future work" items are deliberately unplanned.

**Placeholder scan.** One intentional marked placeholder remains: `PRICE_USD.email_find` and `PRICE_USD.phone_find` in Task 3 carry `REPLACE with the spike's observed average`, which Task 0 Step 5 fills. Routed prices are `null` in treg's catalogue, so they cannot be known before the spike — this is a measured value, not an unwritten decision.

**Type consistency.** `EnrichStep` is defined once in `treg-client.ts` and its five members match the `re_enrich_attempts.step` CHECK constraint in Task 2 exactly. `TregOutcome`'s six members match the `outcome` CHECK constraint. `EmailStatus` and `MobileStatus` match their CHECK constraints including the empty string. `toApexDomain` returns `string | null` and every caller handles null. `WaterfallResult.status` values are the same four written to `re_discovery_leads.enrich_status`, plus `pending` as the column default and `failed` set by the runner's catch — six values, no constraint on that column, so no mismatch. `ceilingHit()` is read by the runner and by `enrichLead`.
