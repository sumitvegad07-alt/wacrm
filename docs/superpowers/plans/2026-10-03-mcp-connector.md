# OZZO AI Connector (MCP Server) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an account Admin connect their own AI tool (Claude, ChatGPT, Perplexity, Gemini Enterprise) to OZZO and ask read-only questions about their business data in natural language.

**Architecture:** A read-only MCP server at `/api/mcp` inside `wacrm-web`, authenticated by OAuth 2.1 + Dynamic Client Registration. Every query runs under the **connecting admin's own Supabase session**, so `execute_report` (which is `SECURITY INVOKER`) keeps working and RLS enforces tenant isolation at the database. The AI sees only three generic tools over a catalog of 22 data sets; it does its own language understanding, comparison and file generation.

**Tech Stack:** Next.js App Router (route handlers), TypeScript, Supabase/Postgres, vitest, `@modelcontextprotocol/sdk` (TypeScript), date-fns + `Intl.DateTimeFormat` for timezone work.

**Spec:** [docs/superpowers/specs/2026-10-03-mcp-connector-design.md](../specs/2026-10-03-mcp-connector-design.md) — read it first. This plan argues from it.

---

## Global Constraints

Every task's requirements implicitly include this section.

**Founder working rules (non-negotiable — these are how the repo operates):**
- **Push directly to `main`.** Never create a branch or a PR. Vercel deploys `main`; branched work never reaches production.
- **Nothing is "done" until committed, pushed and deployed.** Always report the commit hash.
- **Every fix applies to all tenants** and all future signups by default. Never scope to one account unless explicitly told.
- **Never trigger an EAS build** for `wacrm-mobile`. Commit and push mobile changes; the founder batches builds himself. Same for `eas update`.
- **`wacrm-web/PROJECT.md` is the living doc.** There is no `CLAUDE.md` in either repo.
- Database migrations may be applied directly to production via the Supabase MCP `apply_migration` tool (standing permission). Always verify with a follow-up query.

**Technical constraints:**
- Read-only. No `INSERT`, `UPDATE` or `DELETE` on business data anywhere in `src/lib/mcp/` or `src/app/api/mcp/`.
- Admin only. `profiles.account_role` must be admin-or-above, re-checked on **every** call.
- OAuth only. No API-key path for MCP (spec §2.1). The existing `/api/v1` API-key surface is untouched.
- Supabase project ref (production, Mumbai): `ltigfpywdbfilsagtpyd`
- Account timezone: `accounts.settings.timezone`, defaulting to `"Asia/Kolkata"`.
- Encryption: reuse `encrypt()` / `decrypt()` from `src/lib/whatsapp/encryption.ts` (AES-256-GCM, reads `ENCRYPTION_KEY`).
- Test command: `npm test` (vitest, `src/**/*.test.ts`). Typecheck: `npm run typecheck`. Both must pass before every commit.
- Row ceiling: **1,000** per call, clamped server-side, never honoured upward. Set `truncated: true` when clamped.

---

## Codebase facts you will need

A fresh session must not rediscover these. Verified 2026-10-03.

| Thing | Where | Signature / shape |
|---|---|---|
| Report engine RPC wrapper | `src/lib/dashboard/report-rpc.ts` | `runReport(supabase, accountId, module, dimensions, measures, filters, sortColumn?, limit?) => Promise<ReportRow[]>` |
| Raw RPC | Postgres fn `execute_report` | params `p_account_id, p_module, p_dimensions, p_measures, p_filters, p_sort_column, p_sort_direction, p_limit, p_offset`. **`SECURITY INVOKER` — must stay so.** |
| Report definitions | `src/lib/reports/*ReportConfig.ts`, indexed by `src/lib/reports/registry.ts` → `getReportByModule(moduleName)` | `ReportDefinition { moduleName, label, requiredModule?, dimensions: ReportDimension[], measures: ReportMeasure[], filters: ReportFilterDef[], kpis, defaultPeriod? }` |
| Dimension / measure / filter shape | `src/lib/reports/types.ts` | each has `key`, `label`; measures have `type: 'currency'\|'number'\|'percent'`; all three support `requiredModule?` for module-toggle gating |
| The 11 report modules | `src/lib/reports/registry.ts` | `sales, order, quotation, payment, ageing, lead, deal, visit, dsr, expense, task` |
| Period presets (canonical names) | `src/components/reports/report-filter-drawer.tsx` → `PERIOD_PRESETS`, `getDatesForPeriod` | **client component, browser-timezone** — see Task 2 |
| Account timezone helper pattern | `src/lib/retention/run.ts` | reads `accounts.settings.timezone`, defaults `"Asia/Kolkata"` |
| Account-local date formatting pattern | `src/lib/proposals/today.ts` | `Intl.DateTimeFormat("en-CA", { timeZone, ... })` yields `yyyy-mm-dd` |
| Encryption | `src/lib/whatsapp/encryption.ts` | `encrypt(text: string): string`, `decrypt(encryptedText: string): string` |
| Rate limiting | `src/lib/rate-limit.ts` | `checkRateLimit(bucketKey, config)`, `RATE_LIMITS`, `__resetRateLimitForTests()` |
| Server Supabase client (cookie session) | `src/lib/supabase/server.ts` | `createClient(): Promise<SupabaseClient>` |
| API error envelope (reuse the shape) | `src/lib/api/v1/respond.ts` | `unauthorized()`, `forbidden(msg)`, `rateLimited(limit)`, `toApiErrorResponse(err)` |
| Plan catalog | `src/lib/plans/catalog.ts` | `PlanId`, `ProductLine`, `PLAN_LINES: Record<PlanId, Record<ProductLine, boolean>>` |
| Existing API-key auth (reference only, **not used here**) | `src/lib/auth/api-context.ts` | `requireApiKey(request, scope?)` |

### Table columns verified in production

```
location_pings            id, account_id, session_id, user_id, lat, lng, accuracy_m,
                          speed_mps, battery_pct, recorded_at, received_at, is_mocked,
                          client_ping_id, source
location_daily_summary    id, account_id, user_id, day, distance_km, ping_count,
                          mocked_count, first_at, last_at, first_lat, first_lng,
                          last_lat, last_lng, created_at
tracking_sessions         id, account_id, user_id, started_at, ended_at, device_id,
                          end_reason, punch_in_* / punch_out_* (lat, lng, accuracy_m,
                          is_mocked, distance_m, location_id, photo_url),
                          odometer_in_reading, odometer_out_reading
route_executions          id, account_id, route_id, user_id, execution_date, status,
                          started_at, completed_at, tracking_session_id
route_execution_stops     id, account_id, execution_id, contact_id, planned_sequence,
                          actual_sequence, status, skip_reason, site_visit_id, visited_at
route_customers           id, account_id, route_id, contact_id, sequence, archived_at,
                          must_visit
device_health_snapshots   id, account_id, session_id, user_id, recorded_at, reason,
                          app_version, os_version, android_api_level, manufacturer,
                          model, battery_pct, is_charging, low_power_mode,
                          battery_optimization_on, location_services_on,
                          fg_location_permission, bg_location_permission,
                          notification_permission
profiles                  id, user_id, full_name, email, role, account_id, account_role,
                          employee_code, mobile, phone, department, designation,
                          manager_id, employee_role_id, branch, status, web_access,
                          mobile_access, default_approver_id, holiday_list_id
```

All 22 modules carry `account_id`, `profiles` included. The historical
`profiles.plain_password` column is already dropped in production.

### Counting note: 21 modules, 24 data sets

The spec counts **21 chosen modules + DSR**. This plan delivers **24 data sets**, because
the spec's single "route plans & execution" module is better exposed as three separate data
sets — `routes` (the plan), `route_runs` (one per employee per day) and `route_stops`
(the individual stops, including skips). That split is what makes acceptance question 4 a
single call. Nothing was added beyond the agreed scope; one module simply has three shapes.

Final tally: 11 report-route data sets (10 modules + DSR) + 13 reader-route data sets = 24.

### Two findings that simplify the work

1. **Route A descriptors are derived, not written.** `ReportDefinition` already carries
   `dimensions`, `measures`, `filters` with keys, labels and `requiredModule` gating. So
   `describe_data` for all 11 report modules is generated from the existing configs. A new
   report config added later is exposed to the AI with **zero** extra code.

2. **Route adherence is already a stored fact.** `route_execution_stops.status` plus
   `skip_reason`, `site_visit_id` and planned-vs-actual sequence means acceptance question 4
   ("who skipped, and which customers") is one `fetch_data` call, not an AI-side comparison
   of two lists. More reliable, and cheaper.

---

## Scope: three phases, this plan covers Phases 1 and 2

This module is large (22 data sets, an OAuth server, an admin surface). Splitting it keeps
each phase independently shippable and testable.

| Phase | Delivers | Plan |
|---|---|---|
| **1. Foundation + vertical slice** (Tasks 1–15) | OAuth, the three tools, the catalog machinery, gating, audit, limits, and 3 working modules. **A real Claude answers acceptance question 1.** | This document |
| **2. Full module coverage** (Tasks 16–21) | The remaining 19 data sets, GPS dwell clustering, the privacy switch. **All four acceptance questions pass.** | This document |
| **3. Admin surface + launch** (outlined at the end) | "Connected AI tools" screen, audit-log viewer, 10 ready-made questions, ChatGPT handshake, rollout flag, mobile consent wording. | Its own plan, written **after** Phase 1 lands |

Phase 3 is deliberately not detailed yet. Its two biggest items — the ChatGPT handshake and
the exact Allow-screen behaviour — depend on how the OAuth flow actually behaves against
real clients. Writing them in detail now would bake in guesses that Phase 1 will correct.

---

## File structure

**Create:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/20261003120000_mcp_connector.sql` | 4 tables + indexes + RLS |
| `src/lib/mcp/periods.ts` | Named period → account-local date range |
| `src/lib/mcp/periods.test.ts` | |
| `src/lib/mcp/types.ts` | `FieldDef`, `FilterDef`, `DataSetDescriptor` only. `McpContext` lives in `session.ts`, `FetchArgs` / `FetchResult` in `fetch.ts`, `TenantContext` in `gating.ts` — each type beside the code that owns it. |
| `src/lib/mcp/catalog.ts` | The 22 data sets: Route A derived from report configs, Route B hand-written descriptors. Single source of truth for gating. |
| `src/lib/mcp/catalog.test.ts` | Integrity test over every descriptor |
| `src/lib/mcp/gating.ts` | Plan line + module toggle + privacy switch → visible data sets |
| `src/lib/mcp/gating.test.ts` | |
| `src/lib/mcp/session.ts` | Stored admin Supabase session: load, refresh (serialised), invalidate |
| `src/lib/mcp/session.test.ts` | |
| `src/lib/mcp/limits.ts` | Row clamp, truncation flag, per-account daily budget |
| `src/lib/mcp/limits.test.ts` | |
| `src/lib/mcp/audit.ts` | Writes `mcp_call_log` |
| `src/lib/mcp/fetch.ts` | Route A (report engine) and Route B (described reader) |
| `src/lib/mcp/fetch.test.ts` | |
| `src/lib/mcp/dwell.ts` | Cluster `location_pings` into stop-and-dwell rows (Phase 2) |
| `src/lib/mcp/dwell.test.ts` | |
| `src/lib/mcp/tools.ts` | The three tool definitions + dispatch |
| `src/lib/mcp/tools.test.ts` | |
| `src/lib/mcp/oauth/store.ts` | DCR clients, auth codes, connections — data access |
| `src/lib/mcp/oauth/pkce.ts` | PKCE challenge verification |
| `src/lib/mcp/oauth/pkce.test.ts` | |
| `src/app/api/mcp/route.ts` | The MCP endpoint (JSON-RPC over Streamable HTTP) |
| `src/app/api/mcp/oauth/register/route.ts` | RFC 7591 DCR |
| `src/app/api/mcp/oauth/authorize/route.ts` | Login + Allow screen |
| `src/app/api/mcp/oauth/token/route.ts` | Code exchange + refresh |
| `src/app/.well-known/oauth-protected-resource/route.ts` | RFC 9728 |
| `src/app/.well-known/oauth-authorization-server/route.ts` | RFC 8414 |
| `src/app/api/mcp/__tests__/isolation.test.ts` | Cross-tenant + gating integration tests |
| `src/app/api/mcp/__tests__/trust.test.ts` | Dashboard vs connector number equality |

**Modify:** `wacrm-web/PROJECT.md` (document the module, final task).

---

# PHASE 1 — Foundation and vertical slice

### Task 1: Database schema

**Files:**
- Create: `supabase/migrations/20261003120000_mcp_connector.sql`

**Interfaces:**
- Produces: tables `mcp_oauth_clients`, `mcp_oauth_codes`, `mcp_connections`, `mcp_call_log`; settings key `accounts.settings.mcp_allow_workforce_data`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- MCP AI connector. Lets an account Admin connect their own AI tool
-- (Claude / ChatGPT / Perplexity) to OZZO, read-only, over OAuth 2.1.
--
-- Why a stored Supabase session rather than a service-role client:
-- execute_report is SECURITY INVOKER and must stay so, which means it
-- needs a real logged-in user. Storing the admin's own session makes
-- every AI query run as that admin, so RLS enforces tenant isolation
-- at the database instead of relying on an explicit filter in code.
-- ============================================================

-- Dynamically registered OAuth clients (RFC 7591). One row per AI tool
-- installation that introduces itself. Not secret.
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id     text PRIMARY KEY,
  client_name   text NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Short-lived, single-use authorization codes with their PKCE challenge.
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code                  text PRIMARY KEY,
  client_id             text NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  redirect_uri          text NOT NULL,
  code_challenge        text NOT NULL,
  code_challenge_method text NOT NULL,
  -- The admin's Supabase refresh token, AES-GCM encrypted. Moves to
  -- mcp_connections on exchange and is deleted with the code.
  sb_refresh_encrypted  text NOT NULL,
  expires_at            timestamptz NOT NULL,
  consumed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expires_idx ON mcp_oauth_codes (expires_at);

-- One row per connected AI tool.
CREATE TABLE IF NOT EXISTS mcp_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id            text NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  client_name          text NOT NULL,
  -- SHA-256 of the bearer tokens we issue. Plaintext is never stored,
  -- same discipline as api_keys (see migration 026).
  access_token_hash    text NOT NULL UNIQUE,
  refresh_token_hash   text NOT NULL UNIQUE,
  -- The admin's Supabase refresh token, AES-GCM encrypted. Rotates on use.
  sb_refresh_encrypted text NOT NULL,
  access_expires_at    timestamptz NOT NULL,
  last_used_at         timestamptz,
  revoked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_connections_account_idx ON mcp_connections (account_id);
CREATE INDEX IF NOT EXISTS mcp_connections_access_hash_idx ON mcp_connections (access_token_hash);
CREATE INDEX IF NOT EXISTS mcp_connections_refresh_hash_idx ON mcp_connections (refresh_token_hash);

-- Audit. Every tool call writes exactly one row. This is the only way a
-- leaked token would ever be noticed, and it is also the demand data that
-- decides which module to expose next.
CREATE TABLE IF NOT EXISTS mcp_call_log (
  id            bigserial PRIMARY KEY,
  connection_id uuid REFERENCES mcp_connections(id) ON DELETE SET NULL,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  client_name   text,
  tool          text NOT NULL,
  data_set      text,
  row_count     integer,
  truncated     boolean NOT NULL DEFAULT false,
  duration_ms   integer,
  error_code    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_call_log_account_created_idx ON mcp_call_log (account_id, created_at DESC);

ALTER TABLE mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_call_log      ENABLE ROW LEVEL SECURITY;

-- No policies on mcp_oauth_clients / mcp_oauth_codes: only the server-side
-- OAuth routes touch them, through the service-role client. RLS on with no
-- policy = deny all for every normal role, which is what we want.

-- Admins see their own account's connections and audit rows (read-only;
-- disconnect goes through a server action, not a direct client write).
DROP POLICY IF EXISTS mcp_connections_select ON mcp_connections;
CREATE POLICY mcp_connections_select ON mcp_connections FOR SELECT
  USING (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS mcp_call_log_select ON mcp_call_log;
CREATE POLICY mcp_call_log_select ON mcp_call_log FOR SELECT
  USING (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = (SELECT auth.uid())
  ));

COMMENT ON TABLE mcp_connections IS
  'One connected AI tool per row. sb_refresh_encrypted holds the connecting admin''s Supabase refresh token so every AI query runs as that admin and RLS applies.';
```

Note the `(SELECT auth.uid())` wrapping — that is the initplan pattern from the
2026-09-13 performance sprint. Do not write a bare `auth.uid()` in a policy.

- [ ] **Step 2: Apply to production**

Use the Supabase MCP tool `apply_migration` with `project_id: ltigfpywdbfilsagtpyd`,
name `mcp_connector`, and the SQL above.

- [ ] **Step 3: Verify it landed**

Run via Supabase MCP `execute_sql`:

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like 'mcp_%' order by table_name;
```

Expected: exactly four rows — `mcp_call_log`, `mcp_connections`, `mcp_oauth_clients`, `mcp_oauth_codes`.

```sql
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename like 'mcp_%';
```

Expected: `rowsecurity = true` on all four.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261003120000_mcp_connector.sql
git commit -m "feat(mcp): schema for the AI connector (OAuth clients, codes, connections, audit log)"
git push origin main
```

---

### Task 2: Account-local period resolution

The highest-risk pure logic in the module. `getDatesForPeriod` in
`src/components/reports/report-filter-drawer.tsx` resolves periods using `new Date()` and
date-fns in the **browser's** timezone. On a server in UTC that is wrong by 5.5 hours for an
Indian tenant — the exact class of bug that produced the DSR "0 visits" report.

**Critical:** this must reproduce the dashboard's *semantics* exactly, including its quirks,
or the Task 15 trust test fails and AI answers will disagree with the dashboard. Note that
`last_90_days` is `subDays(now, 90)` through end-of-today, i.e. 91 calendar days inclusive.
**Replicate that. Do not "fix" it here.** (Logged as a deferred question at the end of this plan.)

**Files:**
- Create: `src/lib/mcp/periods.ts`, `src/lib/mcp/periods.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MCP_PERIODS: readonly string[]       // the 13 preset names, no "custom"
  export interface ResolvedPeriod { start_date: string; end_date: string; label: string; timezone: string }
  export function resolvePeriod(period: string, timezone: string, now?: Date): ResolvedPeriod
  export function todayInZone(timezone: string, now?: Date): string   // yyyy-mm-dd
  export function isMcpPeriod(v: unknown): v is string
  ```
  `start_date` / `end_date` are `yyyy-mm-dd` strings in the account's timezone — the same
  shape `execute_report` already receives as `filters.date_range`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/periods.test.ts
import { describe, expect, it } from "vitest";
import { MCP_PERIODS, isMcpPeriod, resolvePeriod, todayInZone } from "./periods";

const IST = "Asia/Kolkata";

describe("todayInZone", () => {
  it("returns the Indian date, not the UTC date, late in the UTC evening", () => {
    // 2026-10-03T19:30:00Z is 2026-10-04T01:00 IST.
    expect(todayInZone(IST, new Date("2026-10-03T19:30:00Z"))).toBe("2026-10-04");
  });

  it("returns the Indian date just after midnight IST", () => {
    // 2026-10-03T18:35:00Z is 2026-10-04T00:05 IST.
    expect(todayInZone(IST, new Date("2026-10-03T18:35:00Z"))).toBe("2026-10-04");
  });

  it("honours a non-Indian account timezone", () => {
    expect(todayInZone("America/New_York", new Date("2026-10-03T02:00:00Z"))).toBe("2026-10-02");
  });
});

describe("resolvePeriod", () => {
  it("resolves today in account time, not UTC", () => {
    const r = resolvePeriod("today", IST, new Date("2026-10-03T19:30:00Z"));
    expect(r.start_date).toBe("2026-10-04");
    expect(r.end_date).toBe("2026-10-04");
  });

  it("resolves yesterday relative to the account's today", () => {
    const r = resolvePeriod("yesterday", IST, new Date("2026-10-03T19:30:00Z"));
    expect(r.start_date).toBe("2026-10-03");
    expect(r.end_date).toBe("2026-10-03");
  });

  it("resolves this_month across a month boundary in account time", () => {
    // 2026-09-30T19:00:00Z is 2026-10-01 00:30 IST — October, not September.
    const r = resolvePeriod("this_month", IST, new Date("2026-09-30T19:00:00Z"));
    expect(r.start_date).toBe("2026-10-01");
    expect(r.end_date).toBe("2026-10-31");
  });

  it("resolves last_month", () => {
    const r = resolvePeriod("last_month", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-09-01");
    expect(r.end_date).toBe("2026-09-30");
  });

  it("resolves last_180_days inclusive of today, matching the dashboard", () => {
    const r = resolvePeriod("last_180_days", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.end_date).toBe("2026-10-03");
    expect(r.start_date).toBe("2026-04-06"); // 180 days before 2026-10-03
  });

  it("resolves this_quarter", () => {
    const r = resolvePeriod("this_quarter", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-10-01");
    expect(r.end_date).toBe("2026-12-31");
  });

  it("resolves current_year", () => {
    const r = resolvePeriod("current_year", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-01-01");
    expect(r.end_date).toBe("2026-12-31");
  });

  it("carries the timezone and a human label for the AI to quote", () => {
    const r = resolvePeriod("last_180_days", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.timezone).toBe(IST);
    expect(r.label).toBe("Last 180 Days");
  });

  it("rejects an unknown period rather than silently returning everything", () => {
    expect(() => resolvePeriod("last_fortnight", IST)).toThrow(/unknown period/i);
  });

  it("rejects custom ranges — the AI must not send raw dates", () => {
    expect(() => resolvePeriod("custom", IST)).toThrow(/unknown period/i);
  });
});

describe("MCP_PERIODS", () => {
  it("offers the 13 dashboard presets and excludes custom", () => {
    expect(MCP_PERIODS).toHaveLength(13);
    expect(MCP_PERIODS).not.toContain("custom");
    expect(MCP_PERIODS).toContain("last_180_days");
  });

  it("type-narrows known names only", () => {
    expect(isMcpPeriod("today")).toBe(true);
    expect(isMcpPeriod("custom")).toBe(false);
    expect(isMcpPeriod(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/mcp/periods.test.ts`
Expected: FAIL — cannot resolve `./periods`.

- [ ] **Step 3: Implement**

```ts
// src/lib/mcp/periods.ts
// ============================================================
// Named period -> account-local date range.
//
// The AI never sends raw dates. It sends a preset name and OZZO works out
// the real dates in the tenant's own timezone, server-side. This is the
// single rule that makes date correctness impossible for the AI to get
// wrong — and it exists because the dashboard's own getDatesForPeriod()
// runs in the *browser's* timezone, which on a UTC server is 5.5 hours
// out for an Indian tenant (the DSR "0 visits" bug).
//
// Semantics deliberately mirror src/components/reports/report-filter-drawer.tsx
// including its quirks (last_90_days spans 91 inclusive days). The trust
// test asserts the connector and the dashboard return identical numbers,
// so "fixing" a quirk here would break that equality.
// ============================================================

const LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_quarter: "This Quarter",
  previous_quarter: "Previous Quarter",
  current_year: "Current Year",
  previous_year: "Previous Year",
  last_90_days: "Last 90 Days",
  last_180_days: "Last 180 Days",
  last_365_days: "Last 365 Days",
};

export const MCP_PERIODS: readonly string[] = Object.keys(LABELS);

export interface ResolvedPeriod {
  start_date: string;
  end_date: string;
  label: string;
  timezone: string;
}

export function isMcpPeriod(v: unknown): v is string {
  return typeof v === "string" && v in LABELS;
}

/** yyyy-mm-dd for `now` as seen in `timezone`. en-CA formats in that order. */
export function todayInZone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Parse yyyy-mm-dd into its parts. Calendar arithmetic below is done on
 *  these numbers, never on a Date, so no timezone can re-enter. */
function parts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Shift a calendar date by n days using UTC midnight, which has no DST. */
function shiftDays(ymd: string, n: number): string {
  const { y, m, d } = parts(ymd);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Day of week for a calendar date, 0 = Sunday — matching date-fns'
 *  startOfWeek default that the dashboard uses. */
function dow(ymd: string): number {
  const { y, m, d } = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function resolvePeriod(
  period: string,
  timezone: string,
  now: Date = new Date()
): ResolvedPeriod {
  if (!isMcpPeriod(period)) {
    throw new Error(
      `Unknown period "${period}". Allowed: ${MCP_PERIODS.join(", ")}`
    );
  }

  const today = todayInZone(timezone, now);
  const { y, m } = parts(today);
  const wrap = (start_date: string, end_date: string): ResolvedPeriod => ({
    start_date,
    end_date,
    label: LABELS[period],
    timezone,
  });

  switch (period) {
    case "today":
      return wrap(today, today);
    case "yesterday": {
      const y1 = shiftDays(today, -1);
      return wrap(y1, y1);
    }
    case "this_week": {
      const start = shiftDays(today, -dow(today));
      return wrap(start, shiftDays(start, 6));
    }
    case "last_week": {
      const start = shiftDays(today, -dow(today) - 7);
      return wrap(start, shiftDays(start, 6));
    }
    case "this_month":
      return wrap(fmt(y, m, 1), fmt(y, m, daysInMonth(y, m)));
    case "last_month": {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      return wrap(fmt(ly, lm, 1), fmt(ly, lm, daysInMonth(ly, lm)));
    }
    case "this_quarter": {
      const qs = Math.floor((m - 1) / 3) * 3 + 1;
      return wrap(fmt(y, qs, 1), fmt(y, qs + 2, daysInMonth(y, qs + 2)));
    }
    case "previous_quarter": {
      const qs = Math.floor((m - 1) / 3) * 3 + 1;
      const ps = qs === 1 ? 10 : qs - 3;
      const py = qs === 1 ? y - 1 : y;
      return wrap(fmt(py, ps, 1), fmt(py, ps + 2, daysInMonth(py, ps + 2)));
    }
    case "current_year":
      return wrap(fmt(y, 1, 1), fmt(y, 12, 31));
    case "previous_year":
      return wrap(fmt(y - 1, 1, 1), fmt(y - 1, 12, 31));
    case "last_90_days":
      return wrap(shiftDays(today, -90), today);
    case "last_180_days":
      return wrap(shiftDays(today, -180), today);
    case "last_365_days":
      return wrap(shiftDays(today, -365), today);
    default:
      throw new Error(`Unknown period "${period}"`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/mcp/periods.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/periods.ts src/lib/mcp/periods.test.ts
git commit -m "feat(mcp): account-local named-period resolution"
git push origin main
```

---

### Task 3: Catalog types and Route A derivation

**Files:**
- Create: `src/lib/mcp/types.ts`, `src/lib/mcp/catalog.ts`, `src/lib/mcp/catalog.test.ts`

**Interfaces:**
- Consumes: `MCP_PERIODS` from Task 2; `getReportByModule` from `src/lib/reports/registry.ts`.
- Produces:
  ```ts
  export type ProductLine = "crm" | "wfa" | "sfa" | "fsm";   // re-exported from plans/catalog
  export interface FieldDef { key: string; label: string; type: "text"|"number"|"currency"|"date"|"datetime"|"boolean" }
  export interface FilterDef { key: string; label: string; type: "id"|"text"|"select"|"date_range"|"time_of_day"; options?: string[] }
  export interface DataSetDescriptor {
    name: string;                 // the name the AI uses, e.g. "visits"
    title: string;                // human label
    route: "report" | "reader";
    line: ProductLine;            // required plan line
    requiredModule?: string;      // accounts module toggle key, if any
    sensitive?: boolean;          // behind mcp_allow_workforce_data
    reportModule?: string;        // route "report": the execute_report module name
    table?: string;               // route "reader": base table
    fields: FieldDef[];           // ALLOW-LIST. no select *, ever.
    filters: FilterDef[];
    dimensions: FieldDef[];       // group_by options
    measures: FieldDef[];
    notes: string;                // business rules, prose, for the AI
    examples: string[];           // 2+ worked example calls
  }
  export function allDataSets(): DataSetDescriptor[]
  export function getDataSet(name: string): DataSetDescriptor | undefined
  ```

- [ ] **Step 1: Write the failing integrity test**

```ts
// src/lib/mcp/catalog.test.ts
import { describe, expect, it } from "vitest";
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

  it("marks exactly the three workforce data sets as sensitive", () => {
    expect(sets.filter((s) => s.sensitive).map((s) => s.name).sort())
      .toEqual(["attendance", "device_health", "location_trail"]);
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

  it("looks up by name", () => {
    expect(getDataSet("visits")?.route).toBe("report");
    expect(getDataSet("nope")).toBeUndefined();
  });
});
```

Note: the `sensitive` and reader-table assertions will not all pass until Phase 2 adds the
remaining descriptors. Keep them in from the start — a red test is the to-do list.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/mcp/catalog.test.ts`
Expected: FAIL — cannot resolve `./catalog`.

- [ ] **Step 3: Implement `types.ts`**

Write the interfaces exactly as given in the **Interfaces** block above.

- [ ] **Step 4: Implement Route A derivation in `catalog.ts`**

```ts
// src/lib/mcp/catalog.ts
// ============================================================
// The 22 data sets the AI may read.
//
// Route A (11) is DERIVED from the existing report configs, so a report
// added later is exposed to the AI with no code change here. Route B (11)
// is hand-written because those modules have no report.
//
// This file is the single source of truth for gating: tools, prompts and
// the Allow screen all read `line`, `requiredModule` and `sensitive` from
// these descriptors, so they cannot drift apart.
// ============================================================
import { getReportByModule } from "@/lib/reports/registry";
import type { DataSetDescriptor, FieldDef, ProductLine } from "./types";
import { MCP_PERIODS } from "./periods";

/** Report module -> the name the AI uses, its plan line, and its prose notes. */
const REPORT_SETS: Array<{
  name: string;
  reportModule: string;
  line: ProductLine;
  notes: string;
  examples: string[];
}> = [
  {
    name: "visits",
    reportModule: "visit",
    line: "wfa",
    notes:
      "Customer visits logged by field employees. A visit is 'productive' only if it produced an order — never infer productivity from duration or from a photo being attached. Check-in and check-out are separate timestamps; an open visit has no check-out.",
    examples: [
      'fetch_data({ dataset: "visits", period: "last_180_days", filters: { customer_id: "<id>" }, measures: ["visit_count"] })',
      'fetch_data({ dataset: "visits", period: "today", group_by: ["user"], measures: ["visit_count"] })',
    ],
  },
  {
    name: "orders",
    reportModule: "order",
    line: "crm",
    notes:
      "Sales orders with their line items. Amounts are in INR. An order's value is its net amount after scheme discounts, not the sum of list prices. Cancelled orders are included unless you filter them out by status.",
    examples: [
      'fetch_data({ dataset: "orders", period: "today", group_by: ["user","customer"], measures: ["order_count","net_amount"] })',
      'fetch_data({ dataset: "orders", period: "this_month", fields: ["customer","user","net_amount","created_at"] })',
    ],
  },
  {
    name: "sales",
    reportModule: "sales",
    line: "crm",
    notes:
      "Closed sales only — orders with status Closed, dated by when the dispatch completed rather than when the order was placed. This is the figure to use for 'how much did we actually sell', not the orders data set.",
    examples: [
      'fetch_data({ dataset: "sales", period: "this_month", measures: ["net_amount"] })',
      'fetch_data({ dataset: "sales", period: "previous_quarter", group_by: ["user"], measures: ["net_amount"] })',
    ],
  },
  {
    name: "quotations",
    reportModule: "quotation",
    line: "crm",
    notes:
      "Quotations issued to customers and leads. A quotation is not revenue — it becomes revenue only when it converts to an order. Quotations can be raised against a lead that has no customer record yet.",
    examples: [
      'fetch_data({ dataset: "quotations", period: "this_month", group_by: ["status"], measures: ["quotation_count","net_amount"] })',
      'fetch_data({ dataset: "quotations", period: "last_90_days", fields: ["customer","net_amount","status"] })',
    ],
  },
  {
    name: "payments",
    reportModule: "payment",
    line: "crm",
    notes:
      "Payments received. Collected totals exclude Cancelled payments. A payment can be partly allocated across several orders, so payment totals need not equal any single order's value.",
    examples: [
      'fetch_data({ dataset: "payments", period: "this_month", measures: ["amount"] })',
      'fetch_data({ dataset: "payments", period: "this_week", group_by: ["user"], measures: ["amount"] })',
    ],
  },
  {
    name: "outstanding",
    reportModule: "ageing",
    line: "crm",
    notes:
      "Outstanding receivables by age bucket. This is an absence report: it shows what has NOT been paid, so a customer with no row owes nothing. 'Days Since Last Order' must never be summed across customers — adding one customer's 40 days to another's 90 gives 130, which means nothing.",
    examples: [
      'fetch_data({ dataset: "outstanding", group_by: ["customer"], measures: ["outstanding_amount"], sort: "outstanding_amount", limit: 10 })',
      'fetch_data({ dataset: "outstanding", fields: ["customer","outstanding_amount","days_since_last_order"] })',
    ],
  },
  {
    name: "leads",
    reportModule: "lead",
    line: "crm",
    notes:
      "Leads not yet converted to customers. Lead sources, statuses and industries are per-account configurable lists, so do not assume a fixed set of values — read them from the filter options.",
    examples: [
      'fetch_data({ dataset: "leads", period: "previous_quarter", group_by: ["source"], measures: ["lead_count"] })',
      'fetch_data({ dataset: "leads", period: "this_month", fields: ["name","source","status","owner"] })',
    ],
  },
  {
    name: "deals",
    reportModule: "deal",
    line: "crm",
    notes:
      "Opportunities moving through a pipeline. Pipelines and their stages are per-account configurable. A deal's value is expected, not realised — do not report it as revenue.",
    examples: [
      'fetch_data({ dataset: "deals", group_by: ["stage"], measures: ["deal_count","deal_value"] })',
      'fetch_data({ dataset: "deals", period: "this_month", fields: ["name","stage","deal_value","assigned_to"] })',
    ],
  },
  {
    name: "expenses",
    reportModule: "expense",
    line: "wfa",
    notes:
      "Employee expense claims. Status is a pivot: Pending, Approved and Rejected are separate columns rather than rows. Expense types and their rate tiers are per-account configurable. Approval may be advisory only — an account can run without enforced approval.",
    examples: [
      'fetch_data({ dataset: "expenses", period: "this_month", group_by: ["user"], measures: ["approved_amount"] })',
      'fetch_data({ dataset: "expenses", period: "last_month", group_by: ["expense_type"], measures: ["claimed_amount"] })',
    ],
  },
  {
    name: "tasks",
    reportModule: "task",
    line: "crm",
    notes:
      "Tasks and follow-ups. Activity types are per-account configurable (read the filter options rather than assuming). A task is overdue when its due date has passed and it is not Completed.",
    examples: [
      'fetch_data({ dataset: "tasks", group_by: ["assignee"], measures: ["open_count","overdue_count"] })',
      'fetch_data({ dataset: "tasks", period: "this_week", fields: ["title","assignee","due_date","status"] })',
    ],
  },
  {
    name: "daily_summary",
    reportModule: "dsr",
    line: "wfa",
    notes:
      "Daily Sales Report — one row per employee per day combining visits, orders, collections and distance travelled. Distance comes from odometer readings, not GPS. Use this for 'how was each rep's day' rather than stitching several data sets together.",
    examples: [
      'fetch_data({ dataset: "daily_summary", period: "today", fields: ["user","visit_count","order_count","collected_amount","distance_km"] })',
      'fetch_data({ dataset: "daily_summary", period: "this_week", group_by: ["user"], measures: ["visit_count","order_count"] })',
    ],
  },
];

const asField = (x: { key: string; label: string }, type: FieldDef["type"]): FieldDef => ({
  key: x.key,
  label: x.label,
  type,
});

function fromReportConfig(entry: (typeof REPORT_SETS)[number]): DataSetDescriptor | null {
  const def = getReportByModule(entry.reportModule);
  if (!def) return null;

  const dimensions = def.dimensions.map((d) => asField(d, "text"));
  const measures = def.measures.map((m) =>
    asField(m, m.type === "currency" ? "currency" : "number")
  );

  return {
    name: entry.name,
    title: def.label,
    route: "report",
    line: entry.line,
    requiredModule: typeof def.requiredModule === "string" ? def.requiredModule : undefined,
    reportModule: entry.reportModule,
    // For a report data set the readable "fields" are its dimensions plus
    // its measures — that is exactly what execute_report can return, so the
    // allow-list and the engine's capability are the same set by construction.
    fields: [...dimensions, ...measures],
    filters: [
      { key: "period", label: "Period", type: "date_range", options: [...MCP_PERIODS] },
      ...def.filters.map((f) => ({
        key: f.key,
        label: f.label,
        type: (f.type === "date_range" ? "date_range" : f.type === "select" || f.type === "multiselect" ? "select" : "id") as
          "id" | "select" | "date_range",
        options: f.options?.map((o) => o.value),
      })),
    ],
    dimensions,
    measures,
    notes: entry.notes,
    examples: entry.examples,
  };
}

/** Route B descriptors. Phase 1 adds customers, products and employees;
 *  Phase 2 adds the remaining eight. */
const READER_SETS: DataSetDescriptor[] = [
  // filled in by Task 4 and Phase 2
];

export function allDataSets(): DataSetDescriptor[] {
  const a = REPORT_SETS.map(fromReportConfig).filter(
    (x): x is DataSetDescriptor => x !== null
  );
  return [...a, ...READER_SETS];
}

const BY_NAME = new Map(allDataSets().map((s) => [s.name, s]));

export function getDataSet(name: string): DataSetDescriptor | undefined {
  return BY_NAME.get(name);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/mcp/catalog.test.ts`
Expected: the 11-report-module test, description tests and duplicate test PASS. The
`sensitive` test FAILS (no reader sets yet) — that is the Phase 2 to-do list. Note it and move on.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/mcp/types.ts src/lib/mcp/catalog.ts src/lib/mcp/catalog.test.ts
git commit -m "feat(mcp): data-set catalog with report-config derivation"
git push origin main
```

---

### Task 4: The first three reader descriptors

Phase 1 needs `customers` (to resolve names to ids — load-bearing for almost every
question), plus `products` and `employees`.

**Files:**
- Modify: `src/lib/mcp/catalog.ts` (the `READER_SETS` array)
- Modify: `src/lib/mcp/catalog.test.ts` (add the assertions below)

**Interfaces:**
- Consumes: `DataSetDescriptor` from Task 3.
- Produces: data sets named `customers`, `products`, `employees`.

- [ ] **Step 1: Add the failing tests**

```ts
// append to src/lib/mcp/catalog.test.ts
describe("reader descriptors", () => {
  it("customers can be searched by name and never exposes an internal flag", () => {
    const s = getDataSet("customers")!;
    expect(s.table).toBe("contacts");
    expect(s.filters.map((f) => f.key)).toContain("search");
    expect(s.fields.map((f) => f.key)).toContain("name");
    expect(s.fields.map((f) => f.key)).toContain("outstanding_amount");
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

  it("products is gated on the catalogue line", () => {
    const s = getDataSet("products")!;
    expect(s.table).toBe("products");
    expect(s.line).toBe("crm");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/mcp/catalog.test.ts -t "reader descriptors"`
Expected: FAIL — `getDataSet("customers")` is undefined.

- [ ] **Step 3: Implement the three descriptors**

Replace the empty `READER_SETS` array in `src/lib/mcp/catalog.ts`:

```ts
const READER_SETS: DataSetDescriptor[] = [
  {
    name: "customers",
    title: "Customers",
    route: "reader",
    line: "crm",
    table: "contacts",
    fields: [
      { key: "id", label: "Customer ID", type: "text" },
      { key: "name", label: "Customer Name", type: "text" },
      { key: "customer_code", label: "Customer Code", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "address", label: "Address", type: "text" },
      { key: "area", label: "Area", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
      { key: "country", label: "Country", type: "text" },
      { key: "gst_number", label: "GSTIN", type: "text" },
      { key: "outstanding_amount", label: "Outstanding", type: "currency" },
      { key: "assigned_user_id", label: "Assigned To", type: "text" },
      { key: "is_active", label: "Active", type: "boolean" },
      { key: "created_at", label: "Created", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Name or code contains", type: "text" },
      { key: "id", label: "Customer ID", type: "id" },
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
      { key: "area", label: "Area", type: "text" },
      { key: "assigned_user_id", label: "Assigned To", type: "id" },
      { key: "is_active", label: "Active only", type: "select", options: ["true", "false"] },
    ],
    dimensions: [
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
      { key: "area", label: "Area", type: "text" },
    ],
    measures: [{ key: "customer_count", label: "Customers", type: "number" }],
    notes:
      "The customer master. Start here whenever a question names a company — use the `search` filter to turn a name into an id, then pass that id to another data set. City, state, country and area are denormalised from the territory hierarchy by a database trigger, so they are filled even for customers created with only a Territory. Inactive customers are soft-deleted, not removed; filter is_active unless the question is about history.",
    examples: [
      'fetch_data({ dataset: "customers", filters: { search: "Shah Traders" }, fields: ["id","name","city","outstanding_amount"] })',
      'fetch_data({ dataset: "customers", group_by: ["city"], measures: ["customer_count"] })',
    ],
  },
  {
    name: "products",
    title: "Products",
    route: "reader",
    line: "crm",
    table: "products",
    fields: [
      { key: "id", label: "Product ID", type: "text" },
      { key: "name", label: "Product Name", type: "text" },
      { key: "sku", label: "SKU", type: "text" },
      { key: "category_id", label: "Category", type: "text" },
      { key: "unit_id", label: "Base Unit", type: "text" },
      { key: "price", label: "Price", type: "currency" },
      { key: "hsn_code", label: "HSN Code", type: "text" },
      { key: "is_active", label: "Active", type: "boolean" },
    ],
    filters: [
      { key: "search", label: "Name or SKU contains", type: "text" },
      { key: "id", label: "Product ID", type: "id" },
      { key: "category_id", label: "Category", type: "id" },
      { key: "is_active", label: "Active only", type: "select", options: ["true", "false"] },
    ],
    dimensions: [{ key: "category_id", label: "Category", type: "text" }],
    measures: [{ key: "product_count", label: "Products", type: "number" }],
    notes:
      "The product master. `price` is the base-unit price: an account with Multi Unit enabled sells in other units whose prices are derived by conversion factor, so a line item's rate need not equal this price. Customer-specific pricing from Price Lists overrides it again. Use this data set for the catalogue, not to compute what a customer was charged.",
    examples: [
      'fetch_data({ dataset: "products", filters: { search: "turmeric" }, fields: ["id","name","sku","price"] })',
      'fetch_data({ dataset: "products", group_by: ["category_id"], measures: ["product_count"] })',
    ],
  },
  {
    name: "employees",
    title: "Employees",
    route: "reader",
    line: "wfa",
    table: "profiles",
    fields: [
      { key: "id", label: "Employee ID", type: "text" },
      { key: "full_name", label: "Name", type: "text" },
      { key: "employee_code", label: "Employee Code", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "mobile", label: "Mobile", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "branch", label: "Branch", type: "text" },
      { key: "manager_id", label: "Reports To", type: "text" },
      { key: "account_role", label: "Role", type: "text" },
      { key: "status", label: "Status", type: "text" },
    ],
    filters: [
      { key: "search", label: "Name or code contains", type: "text" },
      { key: "id", label: "Employee ID", type: "id" },
      { key: "manager_id", label: "Reports To", type: "id" },
      { key: "department", label: "Department", type: "text" },
      { key: "status", label: "Status", type: "select", options: ["active", "inactive"] },
    ],
    dimensions: [
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "branch", label: "Branch", type: "text" },
    ],
    measures: [{ key: "employee_count", label: "Employees", type: "number" }],
    notes:
      "The employee roster. Start here whenever a question names a person. IMPORTANT id trap: this data set's `id` is profiles.id, which is NOT the same as the auth user id. Visits, deals and expenses key on profiles.id; leads, payments and some task columns key on the auth user id. Always pass the id this data set returns and let OZZO map it. `manager_id` is the reporting-hierarchy parent and is only meaningful when that module is switched on.",
    examples: [
      'fetch_data({ dataset: "employees", filters: { search: "Ramesh" }, fields: ["id","full_name","employee_code","designation"] })',
      'fetch_data({ dataset: "employees", group_by: ["department"], measures: ["employee_count"] })',
    ],
  },
];
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/mcp/catalog.test.ts`
Expected: the reader-descriptor tests PASS. The `sensitive` test still fails until Phase 2.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/mcp/catalog.ts src/lib/mcp/catalog.test.ts
git commit -m "feat(mcp): customers, products and employees reader descriptors"
git push origin main
```

---

### Task 5: Gating — plan line, module toggle, privacy switch

**Files:**
- Create: `src/lib/mcp/gating.ts`, `src/lib/mcp/gating.test.ts`

**Interfaces:**
- Consumes: `allDataSets`, `getDataSet` (Task 3/4); `PLAN_LINES`, `PlanId` from `src/lib/plans/catalog.ts`.
- Produces:
  ```ts
  export interface TenantContext { plan: PlanId; moduleSettings: Record<string, boolean>; allowWorkforceData: boolean }
  export function visibleDataSets(ctx: TenantContext): DataSetDescriptor[]
  export function assertDataSetAllowed(name: string, ctx: TenantContext): DataSetDescriptor  // throws
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/gating.test.ts
import { describe, expect, it } from "vitest";
import { assertDataSetAllowed, visibleDataSets } from "./gating";
import type { TenantContext } from "./gating";

const crmOnly: TenantContext = { plan: "CRM", moduleSettings: {}, allowWorkforceData: false };
const sfa: TenantContext = { plan: "CRM_SFA", moduleSettings: {}, allowWorkforceData: false };
const sfaWithWorkforce: TenantContext = { ...sfa, allowWorkforceData: true };

describe("visibleDataSets", () => {
  it("hides SFA data sets from a CRM-only tenant", () => {
    const names = visibleDataSets(crmOnly).map((s) => s.name);
    expect(names).toContain("orders");
    expect(names).not.toContain("routes");
    expect(names).not.toContain("visits"); // wfa line
  });

  it("shows WFA and SFA data sets to a CRM+SFA tenant", () => {
    const names = visibleDataSets(sfa).map((s) => s.name);
    expect(names).toContain("visits");
    expect(names).toContain("orders");
  });

  it("hides the sensitive three until the workforce switch is on", () => {
    expect(visibleDataSets(sfa).map((s) => s.name)).not.toContain("location_trail");
    expect(visibleDataSets(sfaWithWorkforce).map((s) => s.name)).toContain("location_trail");
  });

  it("respects a module toggle that is switched off", () => {
    const off: TenantContext = { ...sfa, moduleSettings: { quotation: false } };
    expect(visibleDataSets(off).map((s) => s.name)).not.toContain("quotations");
  });
});

describe("assertDataSetAllowed", () => {
  it("returns the descriptor when allowed", () => {
    expect(assertDataSetAllowed("orders", crmOnly).name).toBe("orders");
  });

  // Hiding something from the menu is NOT security: the AI can guess a name.
  it("refuses a sensitive data set called by name when the switch is off", () => {
    expect(() => assertDataSetAllowed("location_trail", sfa)).toThrow(/not enabled/i);
  });

  it("refuses an out-of-plan data set called by name, with an upgrade hint", () => {
    expect(() => assertDataSetAllowed("routes", crmOnly)).toThrow(/plan/i);
  });

  it("refuses an unknown data set", () => {
    expect(() => assertDataSetAllowed("salaries", sfa)).toThrow(/unknown/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/mcp/gating.test.ts`
Expected: FAIL — cannot resolve `./gating`.

- [ ] **Step 3: Implement**

```ts
// src/lib/mcp/gating.ts
// ============================================================
// What this tenant's AI may see.
//
// Three independent gates, all read from the descriptor so they cannot
// drift from the catalog:
//   1. plan line   — PLAN_LINES from the plan catalog
//   2. module toggle — accounts.settings module switches
//   3. the workforce privacy switch — the sensitive three
//
// visibleDataSets() builds the menu. assertDataSetAllowed() is the
// enforcement point, and both must be used: hiding a name from the menu
// is not security, because the AI can simply guess it.
// ============================================================
import { PLAN_LINES, type PlanId } from "@/lib/plans/catalog";
import { allDataSets, getDataSet } from "./catalog";
import type { DataSetDescriptor } from "./types";

export interface TenantContext {
  plan: PlanId;
  moduleSettings: Record<string, boolean>;
  allowWorkforceData: boolean;
}

function lineAllowed(s: DataSetDescriptor, ctx: TenantContext): boolean {
  return PLAN_LINES[ctx.plan]?.[s.line] === true;
}

function moduleAllowed(s: DataSetDescriptor, ctx: TenantContext): boolean {
  if (!s.requiredModule) return true;
  // Absent means "not explicitly disabled". Only an explicit false hides it,
  // matching how the dashboard reads module_settings.
  return ctx.moduleSettings[s.requiredModule] !== false;
}

function sensitiveAllowed(s: DataSetDescriptor, ctx: TenantContext): boolean {
  return !s.sensitive || ctx.allowWorkforceData;
}

export function visibleDataSets(ctx: TenantContext): DataSetDescriptor[] {
  return allDataSets().filter(
    (s) => lineAllowed(s, ctx) && moduleAllowed(s, ctx) && sensitiveAllowed(s, ctx)
  );
}

export function assertDataSetAllowed(
  name: string,
  ctx: TenantContext
): DataSetDescriptor {
  const s = getDataSet(name);
  if (!s) throw new Error(`Unknown data set "${name}". Call list_data for what is available.`);
  if (!lineAllowed(s, ctx)) {
    throw new Error(
      `"${name}" needs the ${s.line.toUpperCase()} plan, which this account does not have.`
    );
  }
  if (!moduleAllowed(s, ctx)) {
    throw new Error(`"${name}" is switched off in this account's settings.`);
  }
  if (!sensitiveAllowed(s, ctx)) {
    throw new Error(
      `"${name}" contains employee location, attendance or device data, which is not enabled for AI tools on this account. The account owner can switch it on in Settings.`
    );
  }
  return s;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/mcp/gating.test.ts`
Expected: tests referencing `routes` / `location_trail` fail until Phase 2 adds them; all
others PASS. Keep the failures as the to-do list.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/mcp/gating.ts src/lib/mcp/gating.test.ts
git commit -m "feat(mcp): plan, module and privacy gating for data sets"
git push origin main
```

---

### Task 6: PKCE verification

**Files:**
- Create: `src/lib/mcp/oauth/pkce.ts`, `src/lib/mcp/oauth/pkce.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function verifyPkce(verifier: string, challenge: string, method: string): boolean
  export function isSupportedChallengeMethod(m: unknown): m is "S256"
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/oauth/pkce.test.ts
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isSupportedChallengeMethod, verifyPkce } from "./pkce";

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("verifyPkce", () => {
  it("accepts a matching S256 verifier", () => {
    const v = randomBytes(32).toString("base64url");
    expect(verifyPkce(v, challengeFor(v), "S256")).toBe(true);
  });

  it("rejects a mismatched verifier", () => {
    const v = randomBytes(32).toString("base64url");
    expect(verifyPkce(v, challengeFor("something-else"), "S256")).toBe(false);
  });

  it("rejects the plain method — S256 only, per OAuth 2.1", () => {
    expect(verifyPkce("abc", "abc", "plain")).toBe(false);
  });

  it("rejects an empty verifier", () => {
    expect(verifyPkce("", challengeFor(""), "S256")).toBe(false);
  });
});

describe("isSupportedChallengeMethod", () => {
  it("allows only S256", () => {
    expect(isSupportedChallengeMethod("S256")).toBe(true);
    expect(isSupportedChallengeMethod("plain")).toBe(false);
    expect(isSupportedChallengeMethod(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/mcp/oauth/pkce.test.ts`
Expected: FAIL — cannot resolve `./pkce`.

- [ ] **Step 3: Implement**

```ts
// src/lib/mcp/oauth/pkce.ts
// ============================================================
// PKCE (RFC 7636) verification. OAuth 2.1 requires it and forbids the
// "plain" method, so only S256 is accepted here.
// ============================================================
import { createHash, timingSafeEqual } from "node:crypto";

export function isSupportedChallengeMethod(m: unknown): m is "S256" {
  return m === "S256";
}

export function verifyPkce(
  verifier: string,
  challenge: string,
  method: string
): boolean {
  if (!isSupportedChallengeMethod(method)) return false;
  if (!verifier || !challenge) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/mcp/oauth/pkce.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/lib/mcp/oauth/pkce.ts src/lib/mcp/oauth/pkce.test.ts
git commit -m "feat(mcp): S256-only PKCE verification"
git push origin main
```

---

### Task 7: OAuth store

**Files:**
- Create: `src/lib/mcp/oauth/store.ts`

**Interfaces:**
- Consumes: `supabaseAdmin()` from `src/lib/flows/admin-client`; `encrypt`/`decrypt` from `src/lib/whatsapp/encryption`; `hashApiKey`, `generateApiKey` patterns from `src/lib/api-keys/keys`.
- Produces:
  ```ts
  export interface DcrClient { client_id: string; client_name: string; redirect_uris: string[] }
  export async function registerClient(name: string, redirectUris: string[]): Promise<DcrClient>
  export async function getClient(clientId: string): Promise<DcrClient | null>
  export async function createAuthCode(input: {
    clientId: string; accountId: string; profileId: string; redirectUri: string;
    codeChallenge: string; codeChallengeMethod: string; sbRefreshToken: string;
  }): Promise<string>
  export async function consumeAuthCode(code: string): Promise<{
    client_id: string; account_id: string; profile_id: string; redirect_uri: string;
    code_challenge: string; code_challenge_method: string; sb_refresh_token: string;
  } | null>
  export interface ConnectionRow {
    id: string; account_id: string; profile_id: string; client_id: string;
    client_name: string; sb_refresh_token: string; access_expires_at: string;
  }
  export async function createConnection(input: {
    accountId: string; profileId: string; clientId: string; clientName: string; sbRefreshToken: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>
  export async function findConnectionByAccessToken(token: string): Promise<ConnectionRow | null>
  export async function rotateByRefreshToken(token: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null>
  export async function updateStoredSbRefresh(connectionId: string, sbRefreshToken: string): Promise<void>
  export async function revokeConnection(connectionId: string): Promise<void>
  export async function touchConnection(connectionId: string): Promise<void>
  ```

Implementation requirements (no unit-test file — this is thin I/O, exercised by the
integration tests in Task 15 and by the hand-run handshake in Tasks 10 and 11):
- Access tokens: `randomBytes(32).toString("base64url")` prefixed `ozzo_mcp_`. Store SHA-256 only.
- Access token lifetime: 3600 seconds. Refresh token: no fixed expiry; the connection dies after 90 days of `last_used_at` inactivity (enforced in `findConnectionByAccessToken`).
- `sbRefreshToken` is always `encrypt()`-ed before writing and `decrypt()`-ed on read.
- `consumeAuthCode` must be single-use: set `consumed_at` and reject a second call. Reject expired codes.
- `createAuthCode`: code is 32 random bytes base64url, 10-minute expiry.
- `rotateByRefreshToken` issues a new access+refresh pair and invalidates the old refresh token.

- [ ] **Step 1: Implement the store per the interface above**
- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/oauth/store.ts
git commit -m "feat(mcp): OAuth client, code and connection store"
git push origin main
```

---

### Task 8: OAuth metadata endpoints

**Files:**
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`

**Interfaces:**
- Produces: two `GET` handlers returning the documents below. ChatGPT reads both before it will connect; getting a field name wrong here is the most common cause of a silent connect failure.

- [ ] **Step 1: Implement protected-resource metadata (RFC 9728)**

```ts
// src/app/.well-known/oauth-protected-resource/route.ts
import { NextResponse } from "next/server";

/** RFC 9728. Tells an MCP client which authorization server guards /api/mcp. */
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ozzo.co.in";
  return NextResponse.json(
    {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      scopes_supported: ["ozzo.read"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
```

- [ ] **Step 2: Implement authorization-server metadata (RFC 8414)**

```ts
// src/app/.well-known/oauth-authorization-server/route.ts
import { NextResponse } from "next/server";

/** RFC 8414. OAuth 2.1: S256 PKCE only, DCR advertised. */
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ozzo.co.in";
  return NextResponse.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/api/mcp/oauth/authorize`,
      token_endpoint: `${base}/api/mcp/oauth/token`,
      registration_endpoint: `${base}/api/mcp/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["ozzo.read"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
```

- [ ] **Step 3: Verify both locally**

Run the dev server, then:

```bash
curl -s http://localhost:3000/.well-known/oauth-authorization-server | head -40
curl -s http://localhost:3000/.well-known/oauth-protected-resource | head -40
```

Expected: valid JSON from both, `code_challenge_methods_supported: ["S256"]` present.

- [ ] **Step 4: Commit**

```bash
git add src/app/.well-known
git commit -m "feat(mcp): OAuth protected-resource and authorization-server metadata"
git push origin main
```

---

### Task 9: Dynamic Client Registration

**Files:**
- Create: `src/app/api/mcp/oauth/register/route.ts`

**Interfaces:**
- Consumes: `registerClient` (Task 7).
- Produces: `POST` handler returning `{ client_id, client_name, redirect_uris, token_endpoint_auth_method: "none", grant_types, response_types }` with HTTP 201.

- [ ] **Step 1: Implement**

Requirements:
- Accept `{ client_name, redirect_uris, grant_types?, response_types?, token_endpoint_auth_method? }`.
- Reject a missing or empty `redirect_uris`, or any entry that is not `https:` (allow `http://localhost` and `http://127.0.0.1` for local testing) — 400 with `{ error: "invalid_redirect_uri" }`.
- `token_endpoint_auth_method` must be `"none"` (public client); reject anything else with `{ error: "invalid_client_metadata" }`.
- Rate-limit by IP using `checkRateLimit` with a new `RATE_LIMITS.mcpRegister` entry (add it to `src/lib/rate-limit.ts`): 20 registrations per hour per IP. This endpoint is unauthenticated by design, so it needs its own ceiling.
- Return 201 with the registered client.

- [ ] **Step 2: Verify locally**

```bash
curl -s -X POST http://localhost:3000/api/mcp/oauth/register \
  -H 'content-type: application/json' \
  -d '{"client_name":"Test Client","redirect_uris":["https://example.com/cb"],"token_endpoint_auth_method":"none"}'
```

Expected: HTTP 201 with a `client_id`.

```bash
curl -s -X POST http://localhost:3000/api/mcp/oauth/register \
  -H 'content-type: application/json' \
  -d '{"client_name":"Bad","redirect_uris":["http://evil.example.com/cb"],"token_endpoint_auth_method":"none"}'
```

Expected: HTTP 400, `invalid_redirect_uri`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mcp/oauth/register/route.ts src/lib/rate-limit.ts
git commit -m "feat(mcp): dynamic client registration (RFC 7591)"
git push origin main
```

---

### Task 10: Authorize endpoint and the Allow screen

The only screen where the admin makes a real choice. The module list must be generated from
`visibleDataSets()` so it can never overstate what the AI will actually be able to read.

**Files:**
- Create: `src/app/api/mcp/oauth/authorize/route.ts`

**Interfaces:**
- Consumes: `createClient()` from `src/lib/supabase/server`; `getClient`, `createAuthCode` (Task 7); `visibleDataSets` (Task 5); `isSupportedChallengeMethod` (Task 6).
- Produces: `GET` (render) and `POST` (approve) handlers.

- [ ] **Step 1: Implement the GET handler**

Requirements, in order — each failure must be a readable HTML page, not a JSON error, because a human is looking at it:
1. Validate `client_id` exists, `redirect_uri` is one of that client's registered URIs, `response_type=code`, `code_challenge` present, `code_challenge_method=S256`. A bad `redirect_uri` must **not** redirect — render an error page instead (otherwise it is an open redirector).
2. Load the signed-in user via `createClient()`. If not signed in, render the existing login UI (or redirect to `/login?next=<this url>`), then return here.
3. Load the caller's `profiles` row. If `account_role` is not admin-or-above, render: *"Only an Admin can connect an AI tool to OZZO. Ask your account owner."* — no code is issued.
4. Build the readable-module sentence from `visibleDataSets()` for that tenant.
5. Render the Allow screen exactly as spec §7.1 words it, including the line stating the data leaves OZZO and names the connecting client, and the note that employee location/attendance/device data is excluded unless the account owner enables it.

- [ ] **Step 2: Implement the POST handler**

Requirements:
1. Re-validate every item from step 1 — never trust the form round-trip.
2. Re-check `account_role` is admin-or-above.
3. Read the caller's Supabase session refresh token from the server client's session.
4. `createAuthCode({...})` with that refresh token.
5. Redirect 302 to `redirect_uri?code=<code>&state=<state>`.

- [ ] **Step 3: Verify by hand**

Register a test client (Task 9's curl), then open in a browser:

```
http://localhost:3000/api/mcp/oauth/authorize?client_id=<id>&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&response_type=code&code_challenge=<S256>&code_challenge_method=S256&state=xyz
```

Expected: signed out → login; signed in as a non-admin → the refusal page, no code; signed in
as an admin → the Allow screen listing the modules that tenant actually has. Clicking Allow
redirects to `example.com/cb?code=…&state=xyz`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mcp/oauth/authorize/route.ts
git commit -m "feat(mcp): authorize endpoint with admin-only consent screen"
git push origin main
```

---

### Task 11: Token endpoint

**Files:**
- Create: `src/app/api/mcp/oauth/token/route.ts`

**Interfaces:**
- Consumes: `consumeAuthCode`, `createConnection`, `rotateByRefreshToken` (Task 7); `verifyPkce` (Task 6).
- Produces: `POST` handler returning `{ access_token, token_type: "Bearer", expires_in, refresh_token, scope: "ozzo.read" }`.

- [ ] **Step 1: Implement**

Requirements:
- `grant_type=authorization_code`: consume the code (single-use), verify the PKCE verifier against the stored challenge, verify `redirect_uri` and `client_id` match the code's, then `createConnection` carrying the stored Supabase refresh token. Any failure → 400 `{ error: "invalid_grant" }`. Do not leak which check failed.
- `grant_type=refresh_token`: `rotateByRefreshToken`. Failure → 400 `invalid_grant`.
- Any other grant → 400 `unsupported_grant_type`.
- Accept both `application/x-www-form-urlencoded` (what most clients send) and JSON.
- `Cache-Control: no-store` on every response.

- [ ] **Step 2: Verify the full handshake by hand**

Using the code from Task 10:

```bash
curl -s -X POST http://localhost:3000/api/mcp/oauth/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "grant_type=authorization_code&code=<code>&redirect_uri=https://example.com/cb&client_id=<id>&code_verifier=<verifier>"
```

Expected: JSON with `access_token` and `refresh_token`. Re-running the same command must
fail with `invalid_grant` (single-use code).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mcp/oauth/token/route.ts
git commit -m "feat(mcp): token endpoint with PKCE and refresh rotation"
git push origin main
```

---

### Task 12: Session, limits and audit

**Files:**
- Create: `src/lib/mcp/session.ts`, `src/lib/mcp/session.test.ts`, `src/lib/mcp/limits.ts`, `src/lib/mcp/limits.test.ts`, `src/lib/mcp/audit.ts`

**Interfaces:**
- Consumes: `findConnectionByAccessToken`, `updateStoredSbRefresh`, `touchConnection` (Task 7).
- Produces:
  ```ts
  // session.ts
  export interface McpContext {
    connectionId: string; accountId: string; profileId: string; clientName: string;
    supabase: SupabaseClient;            // authenticated AS THE ADMIN. never service-role.
    tenant: TenantContext; timezone: string;
  }
  export async function requireMcpContext(request: Request): Promise<McpContext>  // throws
  // limits.ts
  export const MCP_ROW_CEILING = 1000;
  export const MCP_DAILY_CALL_BUDGET = 2000;
  export function clampLimit(requested: number | undefined): number
  export function wasTruncated(returned: number, limit: number): boolean
  export async function assertDailyBudget(accountId: string): Promise<void>
  // audit.ts
  export async function logCall(input: {
    connectionId: string | null; accountId: string; profileId: string | null;
    clientName: string | null; tool: string; dataSet?: string; rowCount?: number;
    truncated?: boolean; durationMs?: number; errorCode?: string;
  }): Promise<void>
  ```

- [ ] **Step 1: Write the failing limits tests**

```ts
// src/lib/mcp/limits.test.ts
import { describe, expect, it } from "vitest";
import { MCP_ROW_CEILING, clampLimit, wasTruncated } from "./limits";

describe("clampLimit", () => {
  it("defaults to the ceiling when the AI asks for nothing", () => {
    expect(clampLimit(undefined)).toBe(MCP_ROW_CEILING);
  });

  it("honours a smaller request", () => {
    expect(clampLimit(10)).toBe(10);
  });

  it("clamps a larger request rather than honouring it", () => {
    expect(clampLimit(50_000)).toBe(MCP_ROW_CEILING);
  });

  it("rejects nonsense without throwing", () => {
    expect(clampLimit(0)).toBe(MCP_ROW_CEILING);
    expect(clampLimit(-5)).toBe(MCP_ROW_CEILING);
  });
});

describe("wasTruncated", () => {
  it("flags a full page, because more rows may exist", () => {
    expect(wasTruncated(1000, 1000)).toBe(true);
  });

  it("does not flag a partial page", () => {
    expect(wasTruncated(37, 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/mcp/limits.test.ts`
Expected: FAIL — cannot resolve `./limits`.

- [ ] **Step 3: Implement `limits.ts`**

```ts
// src/lib/mcp/limits.ts
// ============================================================
// Cost control. The connector is free on every plan, so an AI that makes
// fifty lookups to answer one prompt is billable load. These are
// deliberately loose opening values, to be tuned from mcp_call_log after
// a month of real usage rather than guessed now.
// ============================================================
export const MCP_ROW_CEILING = 1000;
export const MCP_DAILY_CALL_BUDGET = 2000;

/** A hard ceiling, never a suggestion: a larger request is clamped. */
export function clampLimit(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return MCP_ROW_CEILING;
  }
  return Math.min(Math.floor(requested), MCP_ROW_CEILING);
}

/** A full page means more rows may exist. The AI must be able to say so —
 *  a silent cut-off is how an AI reports 4 lakh when the truth is 12. */
export function wasTruncated(returned: number, limit: number): boolean {
  return returned >= limit;
}
```

`assertDailyBudget(accountId)` counts today's `mcp_call_log` rows for that account (using
the account's own timezone for "today" via `todayInZone`) and throws when the count exceeds
`MCP_DAILY_CALL_BUDGET`.

- [ ] **Step 4: Run the limits tests**

Run: `npx vitest run src/lib/mcp/limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `session.ts`**

`requireMcpContext(request)` must, in this order:
1. Extract the bearer token from `Authorization`. Missing or malformed → throw 401.
2. `findConnectionByAccessToken`. Not found, revoked, expired, or `last_used_at` older than 90 days → throw 401.
3. `assertDailyBudget(accountId)` → throw 429 when exhausted.
4. Build a Supabase client **authenticated as the admin**: `createSupabaseClient(url, ANON_KEY)` then `setSession({ refresh_token: decrypted, access_token: "" })`, which exchanges the refresh token for a fresh session. Persist the rotated refresh token via `updateStoredSbRefresh`. **Refresh must be serialised per connection id** (a module-level `Map<string, Promise<...>>`) so two concurrent AI calls cannot race and invalidate each other's token.
5. If the exchange fails, throw an error whose message is exactly: `Your OZZO connection has expired. Please reconnect OZZO in your AI tool.`
6. Re-read `profiles.account_role` through that client. Not admin-or-above → throw 403. **This is why demotion takes effect immediately rather than at next refresh.**
7. Read `accounts.plan`, `accounts.settings` → build `TenantContext` and `timezone`.
8. `touchConnection(id)` fire-and-forget. Return the context.

Write `src/lib/mcp/session.test.ts` covering, with the store and Supabase client mocked:
missing header → 401; unknown token → 401; revoked → 401; 91-day-idle → 401; non-admin
profile → 403; concurrent calls trigger exactly one refresh; a failed exchange produces the
reconnect message verbatim.

- [ ] **Step 6: Implement `audit.ts`**

One insert into `mcp_call_log` via the service-role client (the audit log is ours, not the
tenant's, and must be written even when the tenant-facing call failed). Never throw — a
failed audit write must not fail the user's request; log to console and move on.

- [ ] **Step 7: Run all tests, typecheck, commit**

```bash
npm test
npm run typecheck
git add src/lib/mcp/session.ts src/lib/mcp/session.test.ts src/lib/mcp/limits.ts src/lib/mcp/limits.test.ts src/lib/mcp/audit.ts
git commit -m "feat(mcp): admin-session context, cost limits and audit logging"
git push origin main
```

---

### Task 13: The fetch layer

**Files:**
- Create: `src/lib/mcp/fetch.ts`, `src/lib/mcp/fetch.test.ts`

**Interfaces:**
- Consumes: `runReport` from `src/lib/dashboard/report-rpc`; `resolvePeriod` (Task 2); `assertDataSetAllowed` (Task 5); `clampLimit`, `wasTruncated` (Task 12); `McpContext` (Task 12).
- Produces:
  ```ts
  export interface FetchArgs {
    dataset: string; period?: string; time_of_day?: { from: string; to: string };
    filters?: Record<string, unknown>; group_by?: string[]; measures?: string[];
    fields?: string[]; sort?: string; limit?: number; page?: number;
  }
  export interface FetchResult {
    dataset: string; mode: "summary" | "detail"; rows: Record<string, unknown>[];
    row_count: number; truncated: boolean; period_resolved?: ResolvedPeriod; as_of: string;
    note?: string;
  }
  export async function fetchData(args: FetchArgs, ctx: McpContext): Promise<FetchResult>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/fetch.test.ts
import { describe, expect, it, vi } from "vitest";
import { fetchData } from "./fetch";
import type { McpContext } from "./session";

vi.mock("@/lib/dashboard/report-rpc", () => ({
  runReport: vi.fn(async () => [{ user: "Ramesh", visit_count: 47 }]),
  num: (v: unknown) => Number(v) || 0,
  str: (v: unknown) => String(v ?? ""),
}));

function ctx(over: Partial<McpContext> = {}): McpContext {
  return {
    connectionId: "c1",
    accountId: "a1",
    profileId: "p1",
    clientName: "Claude",
    supabase: {} as never,
    timezone: "Asia/Kolkata",
    tenant: { plan: "CRM_SFA", moduleSettings: {}, allowWorkforceData: false },
    ...over,
  } as McpContext;
}

describe("fetchData — report route", () => {
  it("resolves the period in account time and reports it back", async () => {
    const r = await fetchData(
      { dataset: "visits", period: "last_180_days", measures: ["visit_count"] },
      ctx()
    );
    expect(r.period_resolved?.timezone).toBe("Asia/Kolkata");
    expect(r.period_resolved?.label).toBe("Last 180 Days");
    expect(r.mode).toBe("summary");
  });

  it("rejects a field the descriptor does not allow-list", async () => {
    await expect(
      fetchData({ dataset: "visits", fields: ["secret_margin"] }, ctx())
    ).rejects.toThrow(/not available/i);
  });

  it("rejects a filter the descriptor does not declare", async () => {
    await expect(
      fetchData({ dataset: "visits", filters: { salary: 1 } }, ctx())
    ).rejects.toThrow(/not a filter/i);
  });

  it("rejects an unknown period rather than defaulting to everything", async () => {
    await expect(
      fetchData({ dataset: "visits", period: "last_fortnight" }, ctx())
    ).rejects.toThrow(/unknown period/i);
  });

  it("refuses a data set outside the tenant's plan", async () => {
    await expect(
      fetchData(
        { dataset: "visits" },
        ctx({ tenant: { plan: "CRM", moduleSettings: {}, allowWorkforceData: false } })
      )
    ).rejects.toThrow(/plan/i);
  });

  it("clamps an oversized limit and flags truncation", async () => {
    const { runReport } = await import("@/lib/dashboard/report-rpc");
    vi.mocked(runReport).mockResolvedValueOnce(
      Array.from({ length: 1000 }, () => ({ user: "x", visit_count: 1 }))
    );
    const r = await fetchData(
      { dataset: "visits", fields: ["user"], limit: 50_000 },
      ctx()
    );
    expect(r.row_count).toBe(1000);
    expect(r.truncated).toBe(true);
  });

  it("returns a summary with a note when a detail request is too broad", async () => {
    const r = await fetchData({ dataset: "orders", fields: ["customer"] }, ctx());
    expect(r.mode).toBe("summary");
    expect(r.note).toMatch(/narrow/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/mcp/fetch.test.ts`
Expected: FAIL — cannot resolve `./fetch`.

- [ ] **Step 3: Implement**

Requirements, in order:
1. `assertDataSetAllowed(args.dataset, ctx.tenant)` → descriptor.
2. Validate **every** requested `field`, `group_by`, `measure`, `sort` and `filters` key against the descriptor's allow-lists. Unknown field → `"\"x\" is not available on \"<dataset>\". Call describe_data for what is."` Unknown filter → `"\"x\" is not a filter on \"<dataset>\"."`
3. If `args.period` is set, `resolvePeriod(args.period, ctx.timezone)` and pass it to the query as `filters.date_range = { start_date, end_date }`. If a data set declares a `period` filter and none was given, apply the report's `defaultPeriod` (or `this_month`).
4. Mode: `summary` if `group_by` or `measures` present, else `detail`.
5. **Summary before detail:** a `detail` request with no `filters` and no `period` against a data set whose `route === "report"` is converted to a `summary` grouped on the descriptor's first dimension, with `note: "Too broad for a record listing — here is a summary instead. Add a period or a filter to see individual rows."`
6. Route A: `runReport(ctx.supabase, ctx.accountId, descriptor.reportModule!, dimensions, measures, filters, sort, clampLimit(args.limit))`.
7. Route B: build a Supabase query on `descriptor.table`, `.select(allowListedFields.join(","))` — **never `*`** — then `.eq("account_id", ctx.accountId)` unconditionally, then the validated filters, `.order(sort)`, `.range(offset, offset + limit - 1)`.
8. Return the result with `truncated: wasTruncated(rows.length, limit)`, `period_resolved`, and `as_of: new Date().toISOString()`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/mcp/fetch.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/mcp/fetch.ts src/lib/mcp/fetch.test.ts
git commit -m "feat(mcp): fetch layer over the report engine and described reader"
git push origin main
```

---

### Task 14: The three tools and the MCP endpoint

**Files:**
- Create: `src/lib/mcp/tools.ts`, `src/lib/mcp/tools.test.ts`, `src/app/api/mcp/route.ts`
- Modify: `package.json` (add `@modelcontextprotocol/sdk`)

**Interfaces:**
- Consumes: `visibleDataSets` (Task 5), `fetchData` (Task 13), `requireMcpContext` (Task 12), `logCall` (Task 12), `todayInZone` (Task 2).
- Produces:
  ```ts
  export const MCP_TOOLS: Array<{ name: string; description: string; inputSchema: object }>
  export async function callTool(name: string, args: unknown, ctx: McpContext): Promise<unknown>
  ```

- [ ] **Step 1: Install the SDK**

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Write the failing tool tests**

```ts
// src/lib/mcp/tools.test.ts
import { describe, expect, it, vi } from "vitest";
import { MCP_TOOLS, callTool } from "./tools";
import type { McpContext } from "./session";

vi.mock("@/lib/dashboard/report-rpc", () => ({
  runReport: vi.fn(async () => [{ visit_count: 47 }]),
  num: (v: unknown) => Number(v) || 0,
  str: (v: unknown) => String(v ?? ""),
}));

const ctx = {
  connectionId: "c1", accountId: "a1", profileId: "p1", clientName: "Claude",
  supabase: {} as never, timezone: "Asia/Kolkata",
  tenant: { plan: "CRM_SFA", moduleSettings: {}, allowWorkforceData: false },
} as McpContext;

describe("MCP_TOOLS", () => {
  it("offers exactly three tools", () => {
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual(
      ["describe_data", "fetch_data", "list_data"]
    );
  });
});

describe("list_data", () => {
  it("returns the tenant timezone and their local today, so the AI need not guess", async () => {
    const r = (await callTool("list_data", {}, ctx)) as {
      timezone: string; today: string; data_sets: { name: string }[];
    };
    expect(r.timezone).toBe("Asia/Kolkata");
    expect(r.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.data_sets.length).toBeGreaterThan(0);
  });

  it("omits data sets the tenant's plan does not include", async () => {
    const crm = { ...ctx, tenant: { plan: "CRM", moduleSettings: {}, allowWorkforceData: false } } as McpContext;
    const r = (await callTool("list_data", {}, crm)) as { data_sets: { name: string }[] };
    expect(r.data_sets.map((d) => d.name)).not.toContain("visits");
  });
});

describe("describe_data", () => {
  it("includes business notes and worked examples", async () => {
    const r = (await callTool("describe_data", { dataset: "visits" }, ctx)) as {
      notes: string; examples: string[]; periods: string[];
    };
    expect(r.notes).toMatch(/productive/i);
    expect(r.examples.length).toBeGreaterThanOrEqual(2);
    expect(r.periods).toContain("last_180_days");
  });

  it("refuses to describe a data set the tenant may not read", async () => {
    const crm = { ...ctx, tenant: { plan: "CRM", moduleSettings: {}, allowWorkforceData: false } } as McpContext;
    await expect(callTool("describe_data", { dataset: "visits" }, crm)).rejects.toThrow(/plan/i);
  });
});

describe("callTool", () => {
  it("rejects an unknown tool name", async () => {
    await expect(callTool("drop_tables", {}, ctx)).rejects.toThrow(/unknown tool/i);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/mcp/tools.test.ts`
Expected: FAIL — cannot resolve `./tools`.

- [ ] **Step 4: Implement `tools.ts`**

- `list_data`: no inputs. Returns `{ account_name, timezone, today, data_sets: [{ name, title, summary }] }` from `visibleDataSets(ctx.tenant)`.
- `describe_data`: input `{ dataset: string }`. `assertDataSetAllowed` first, then return `{ name, title, fields, filters, dimensions, measures, periods: MCP_PERIODS, notes, examples }`.
- `fetch_data`: input schema mirroring `FetchArgs`; delegates to `fetchData`.
- `callTool` dispatches on name and throws `Unknown tool "<name>"` otherwise.

Tool descriptions must tell the AI the workflow explicitly, e.g. for `fetch_data`:
*"Read OZZO business data. Call list_data first to see what exists, then describe_data for the data set you want, then this. Periods are named (today, this_month, last_180_days…) — never send raw dates, OZZO resolves them in the account's own timezone."*

- [ ] **Step 5: Implement `/api/mcp/route.ts`**

- `POST` only; 405 otherwise.
- `requireMcpContext(request)` first. On failure, return a JSON-RPC error whose `message` is the thrown message (these are written to be read by a human via the AI).
- Handle `initialize` (advertise `{ tools: {} }` capability, server name `"OZZO"`), `tools/list` (return `MCP_TOOLS`), `tools/call` (dispatch via `callTool`).
- Wrap every `tools/call` in a timer and call `logCall(...)` in a `finally`, including on error (with `errorCode`).
- Never return a stack trace to the client.

- [ ] **Step 6: Run the tests, typecheck**

Run: `npx vitest run src/lib/mcp/tools.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Verify the protocol with the MCP Inspector**

```bash
npx @modelcontextprotocol/inspector
```

Point it at `http://localhost:3000/api/mcp`, complete the OAuth flow, and confirm
`tools/list` returns three tools and `list_data` returns a menu.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/tools.ts src/lib/mcp/tools.test.ts src/app/api/mcp/route.ts package.json package-lock.json
git commit -m "feat(mcp): three read tools and the MCP endpoint"
git push origin main
```

---

### Task 15: Isolation, trust, and the first real answer

**Files:**
- Create: `src/app/api/mcp/__tests__/isolation.test.ts`, `src/app/api/mcp/__tests__/trust.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no runtime exports — these are the gates.

- [ ] **Step 1: Write the isolation tests**

Against a real database, with two seeded accounts A and B each owning customers, orders and
visits, and a connection belonging to an admin of A:

```ts
// src/app/api/mcp/__tests__/isolation.test.ts
// For every data set visible to account A, assert that not one returned row
// belongs to account B. This is the single most important test in the module:
// everything else is a feature, this is the promise.
import { describe, expect, it } from "vitest";
import { visibleDataSets } from "@/lib/mcp/gating";
import { fetchData } from "@/lib/mcp/fetch";
// ... seed helpers

describe("tenant isolation", () => {
  it.each(visibleDataSets(TENANT_A).map((s) => [s.name] as const))(
    "%s returns no rows from another account",
    async (name) => {
      const r = await fetchData({ dataset: name, fields: ["id"], limit: 1000 }, CTX_A);
      const ids = r.rows.map((row) => row.id);
      const foreign = await countRowsOwnedByB(name, ids);
      expect(foreign).toBe(0);
    }
  );

  it("refuses a connection whose admin was demoted", async () => {
    await demote(ADMIN_A);
    await expect(requireMcpContext(reqWithToken(TOKEN_A))).rejects.toThrow(/403|admin/i);
  });

  it("refuses a revoked connection", async () => {
    await revokeConnection(CONNECTION_A);
    await expect(requireMcpContext(reqWithToken(TOKEN_A))).rejects.toThrow();
  });

  it("refuses a sensitive data set by name when the switch is off", async () => {
    await expect(fetchData({ dataset: "location_trail" }, CTX_A)).rejects.toThrow(/not enabled/i);
  });
});
```

- [ ] **Step 2: Write the trust test**

```ts
// src/app/api/mcp/__tests__/trust.test.ts
// The connector and the dashboard must return identical numbers for the
// same question as the same user. If these ever drift, customers lose
// faith in both surfaces at once.
import { describe, expect, it } from "vitest";
import { runReport } from "@/lib/dashboard/report-rpc";
import { fetchData } from "@/lib/mcp/fetch";
import { resolvePeriod } from "@/lib/mcp/periods";

describe("connector matches dashboard", () => {
  it.each([
    ["orders", "this_month", ["user"], ["net_amount"]],
    ["visits", "last_180_days", ["user"], ["visit_count"]],
    ["payments", "this_week", ["user"], ["amount"]],
  ] as const)("%s / %s", async (dataset, period, group_by, measures) => {
    const p = resolvePeriod(period, "Asia/Kolkata");
    const dashboard = await runReport(
      SUPABASE_AS_ADMIN_A, ACCOUNT_A, REPORT_MODULE[dataset],
      [...group_by], [...measures],
      { date_range: { start_date: p.start_date, end_date: p.end_date } },
      undefined, 1000
    );
    const viaMcp = await fetchData(
      { dataset, period, group_by: [...group_by], measures: [...measures] }, CTX_A
    );
    expect(viaMcp.rows).toEqual(dashboard);
  });
});
```

- [ ] **Step 3: Run all tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. Any isolation failure is a release blocker, not a bug to triage.

- [ ] **Step 4: Acceptance — question 1 in a real Claude**

Deploy to production (`git push origin main`), then in Claude add a custom connector
pointing at `https://app.ozzo.co.in/api/mcp`, complete the OAuth flow as an admin, and ask:

> *"Check my OZZO — how many visits for &lt;a real customer&gt; in the last 180 days?"*

Verify the number by hand with:

```sql
select count(*) from site_visits
where account_id = '<account>' and contact_id = '<customer>'
  and (created_at at time zone 'Asia/Kolkata')::date
      between '<start>' and '<end>';
```

Expected: identical. Also confirm one `mcp_call_log` row per tool call.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mcp/__tests__
git commit -m "test(mcp): tenant isolation and dashboard-parity gates"
git push origin main
```

**Phase 1 is complete when a real Claude answers acceptance question 1 with a number
verified by hand, and `npm test` is green.**

---

# PHASE 2 — Full module coverage

Each task below adds reader descriptors to `READER_SETS` in `src/lib/mcp/catalog.ts`
following exactly the shape established in Task 4 (name, title, route `"reader"`, line,
table, allow-listed `fields`, declared `filters`, `dimensions`, `measures`, prose `notes`,
2+ `examples`). The catalog integrity test from Task 3 is the gate: it already asserts every
descriptor is complete, so it goes green as these land.

### Task 16: GPS dwell clustering

`location_daily_summary` holds day totals only (distance, ping count, first/last position).
The stop-and-dwell rows the spec promises must be computed from `location_pings`.

**Files:**
- Create: `src/lib/mcp/dwell.ts`, `src/lib/mcp/dwell.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Ping { lat: number; lng: number; recorded_at: string }
  export interface Stop { from: string; to: string; minutes: number; lat: number; lng: number; ping_count: number }
  export interface Trail { stops: Stop[]; moving_km: number }
  export function clusterPings(pings: Ping[], opts?: { radiusM?: number; minMinutes?: number }): Trail
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/dwell.test.ts
import { describe, expect, it } from "vitest";
import { clusterPings, type Ping } from "./dwell";

const at = (min: number, lat: number, lng: number): Ping => ({
  lat, lng,
  recorded_at: new Date(Date.UTC(2026, 9, 3, 5, min)).toISOString(),
});

describe("clusterPings", () => {
  it("returns no stops for an empty trail", () => {
    expect(clusterPings([])).toEqual({ stops: [], moving_km: 0 });
  });

  it("collapses pings within the radius into one stop", () => {
    const pings = [at(0, 19.1197, 72.8468), at(10, 19.1198, 72.8469), at(20, 19.1197, 72.8470)];
    const t = clusterPings(pings);
    expect(t.stops).toHaveLength(1);
    expect(t.stops[0].minutes).toBe(20);
    expect(t.stops[0].ping_count).toBe(3);
  });

  it("splits into two stops when the rep moves away and settles again", () => {
    const pings = [
      at(0, 19.1197, 72.8468), at(15, 19.1198, 72.8469),   // Andheri
      at(40, 19.0607, 72.8362), at(60, 19.0608, 72.8363),  // BKC
    ];
    expect(clusterPings(pings).stops).toHaveLength(2);
  });

  it("drops a pass-through that is shorter than minMinutes", () => {
    const pings = [
      at(0, 19.1197, 72.8468), at(30, 19.1198, 72.8469),
      at(32, 19.0607, 72.8362),                             // 2 min — driving past
      at(60, 19.2183, 72.9781), at(90, 19.2184, 72.9782),
    ];
    const t = clusterPings(pings, { minMinutes: 5 });
    expect(t.stops).toHaveLength(2);
  });

  it("reports distance travelled between stops", () => {
    const pings = [at(0, 19.1197, 72.8468), at(10, 19.1198, 72.8469), at(40, 19.0607, 72.8362), at(60, 19.0608, 72.8363)];
    expect(clusterPings(pings).moving_km).toBeGreaterThan(5);
  });

  it("turns ~4000 pings into a handful of stops", () => {
    const pings: Ping[] = [];
    for (let i = 0; i < 4000; i++) {
      const base = i < 2000 ? [19.1197, 72.8468] : [19.0607, 72.8362];
      pings.push(at(i * 0.1, base[0] + i * 1e-6, base[1] + i * 1e-6));
    }
    expect(clusterPings(pings).stops.length).toBeLessThan(10);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/lib/mcp/dwell.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Walk the pings in time order; keep an open cluster while the next ping is within `radiusM` (default 150 m, haversine) of the cluster centroid; otherwise close the cluster and start a new one. Discard closed clusters shorter than `minMinutes` (default 5) but add the distance between consecutive discarded points to `moving_km`.
- [ ] **Step 4: Run tests.** Expected PASS.
- [ ] **Step 5: Commit.**

```bash
npm run typecheck
git add src/lib/mcp/dwell.ts src/lib/mcp/dwell.test.ts
git commit -m "feat(mcp): cluster GPS pings into stop-and-dwell rows"
git push origin main
```

---

### Task 17: The three sensitive descriptors

**Files:** Modify `src/lib/mcp/catalog.ts`, `src/lib/mcp/catalog.test.ts`

Add, all with `sensitive: true` and `line: "wfa"`:

| name | table | key fields | notes must say |
|---|---|---|---|
| `location_trail` | `location_pings` (via `clusterPings`) | `user_id`, `from`, `to`, `minutes`, `lat`, `lng`, `ping_count`, `moving_km` | Returns stops and dwell time by default, not raw pings — a six-hour day is ~4,000 pings and ~12 stops. Accepts `time_of_day` (local `HH:mm`). `is_mocked` pings are excluded from stops and counted separately. Tracking only runs inside a punch-in session, so gaps mean "not punched in", never "stopped moving". |
| `attendance` | `tracking_sessions` | `user_id`, `started_at`, `ended_at`, `end_reason`, `punch_in_distance_m`, `punch_out_distance_m`, `odometer_in_reading`, `odometer_out_reading` | Punch in/out sessions. **Shift times never gate tracking** — punched in means tracked at any hour; shift times only classify the attendance afterwards. A session with no `ended_at` is still open. `punch_in_distance_m` is the distance from the assigned geo-fence location, present only when fencing is on. |
| `device_health` | `device_health_snapshots` | `user_id`, `recorded_at`, `app_version`, `os_version`, `manufacturer`, `model`, `battery_pct`, `is_charging`, `low_power_mode`, `battery_optimization_on`, `location_services_on`, `fg_location_permission`, `bg_location_permission` | Why a phone may not be reporting location. `battery_optimization_on` or a denied `bg_location_permission` is the usual cause of a rep appearing stationary. A snapshot is a point in time, not a current state. |

- [ ] **Step 1: Add the three descriptors.**
- [ ] **Step 2: Run the catalog test** — the `sensitive` assertion from Task 3 must now pass. `npx vitest run src/lib/mcp/catalog.test.ts` → PASS.
- [ ] **Step 3: Wire `location_trail` through `clusterPings` in `fetch.ts`,** and implement `time_of_day` by converting the local `HH:mm` window to UTC using the account timezone before filtering `recorded_at`. Add a test asserting an 11:00–17:00 IST window excludes a 10:30 IST ping.
- [ ] **Step 4: Run all tests, typecheck, commit.**

```bash
npm test && npm run typecheck
git add src/lib/mcp/catalog.ts src/lib/mcp/catalog.test.ts src/lib/mcp/fetch.ts src/lib/mcp/fetch.test.ts
git commit -m "feat(mcp): location trail, attendance and device health data sets"
git push origin main
```

---

### Task 18: Route, territory and leave descriptors

**Files:** Modify `src/lib/mcp/catalog.ts`, `src/lib/mcp/catalog.test.ts`

| name | line | table | notes must say |
|---|---|---|---|
| `routes` | `sfa` | `routes` | Route definitions and their assigned customers (`route_customers`, with `sequence` and `must_visit`). Route Management is SFA, not WFA. Archived route customers are excluded unless asked for. |
| `route_runs` | `sfa` | `route_executions` | One row per employee per route per day, with status and start/finish times. `user_id` here is the **auth user id**, while route plan assignments key on `profiles.id` — the two differ. Pass ids from the `employees` data set and let OZZO map them. |
| `route_stops` | `sfa` | `route_execution_stops` | **Answers "who skipped which customers" directly** — `status` plus `skip_reason`, and `site_visit_id` linking to the visit that happened. `planned_sequence` versus `actual_sequence` shows resequencing. No comparison of two data sets is needed. |
| `territories` | `sfa` | `territories` | The geography hierarchy: level 1 = Country, 2 = State, 3 = City, 4 = Area. Customers' flat city/state/country/area columns are denormalised from this by a trigger. |
| `leave` | `wfa` | `leaves` | Leave requests with type and status; `leave_days` holds the individual dates. The working week is per-account configurable — never assume Monday to Friday. Holidays live in `holidays` against a `holiday_list_id` on each employee. |

- [ ] **Step 1: Add the five descriptors.**
- [ ] **Step 2: Run the gating test** — the `routes` assertions from Task 5 must now pass. `npx vitest run src/lib/mcp/gating.test.ts` → PASS.
- [ ] **Step 3: Run all tests, typecheck, commit.**

```bash
npm test && npm run typecheck
git add src/lib/mcp/catalog.ts src/lib/mcp/catalog.test.ts src/lib/mcp/gating.test.ts
git commit -m "feat(mcp): route, territory and leave data sets"
git push origin main
```

---

### Task 19: Stock and scheme descriptors

**Files:** Modify `src/lib/mcp/catalog.ts`, `src/lib/mcp/catalog.test.ts`

| name | line | table | notes must say |
|---|---|---|---|
| `stock` | `crm` | `stock_ledger` | Closing stock is **derived** — it is the running SUM over the ledger, not a stored column. Stock Management is opt-in and off by default, so an account with it off has an empty ledger rather than zero stock. Quantities are in the product's base unit. |
| `schemes` | `crm` | `schemes` | Discount and offer schemes with their slabs (`scheme_slabs`) and the products and customers they apply to. Scheme Management is opt-in via Catalogue Settings and off by default. A scheme explains why an order's net amount is below list price. |

- [ ] **Step 1: Add both descriptors.**
- [ ] **Step 2: Run the catalog test.** Expected PASS, all assertions now green.
- [ ] **Step 3: Run all tests, typecheck, commit.**

```bash
npm test && npm run typecheck
git add src/lib/mcp/catalog.ts src/lib/mcp/catalog.test.ts
git commit -m "feat(mcp): stock and scheme data sets"
git push origin main
```

---

### Task 20: The workforce privacy switch

**Files:**
- Create: `src/app/actions/mcp-settings.ts`
- Modify: the account settings UI page that renders the other `accounts.settings` toggles (find it with `grep -rn "geo_fencing" src/app src/components`)

**Interfaces:**
- Produces: `setMcpWorkforceAccess(enabled: boolean): Promise<void>` — founder/owner-gated server action writing `accounts.settings.mcp_allow_workforce_data`.

- [ ] **Step 1: Implement the server action.** Must verify the caller is the account owner (not merely an admin), since this exposes other employees' movement data. Follow the existing pattern used by the geo-fencing toggle.
- [ ] **Step 2: Add the UI toggle,** labelled *"Allow AI tools to read employee location, attendance and device data"*, default off, with helper text: *"Off by default. When on, your field staff will be asked to re-accept the location policy on their next app open."*
- [ ] **Step 3: Verify end to end.** With the switch off, `list_data` must omit the three sensitive data sets and `fetch_data({dataset:"location_trail"})` must be refused by name. With it on, both work.
- [ ] **Step 4: Commit.**

```bash
npm test && npm run typecheck
git add src/app/actions/mcp-settings.ts src/app src/components
git commit -m "feat(mcp): owner-gated switch for AI access to workforce data"
git push origin main
```

---

### Task 21: Full acceptance

- [ ] **Step 1: Deploy.** `git push origin main`, confirm the Vercel deployment is live.
- [ ] **Step 2: Ask all four questions in a real Claude,** connected as an admin of an account on a CRM+SFA plan with the workforce switch ON:

1. *"How many visits for &lt;customer&gt; in the last 180 days?"*
2. *"Where was &lt;employee&gt; roaming between 11am and 5pm today?"*
3. *"Today's total order value, grouped by employee, customer, quantity and order time."*
4. *"Are all my employees following their route plan? If not, who skipped, and which customers did they skip?"*

- [ ] **Step 3: Verify every answer by hand** against the database with a direct SQL query, using `at time zone 'Asia/Kolkata'` for any date comparison.
- [ ] **Step 4: Confirm the audit log** has one `mcp_call_log` row per tool call, with sensible `row_count` values.
- [ ] **Step 5: Confirm gating** by repeating question 4 as an admin of a CRM-only account. Expected: Claude relays that route data needs the SFA plan — not an error.
- [ ] **Step 6: Document the module in PROJECT.md** and commit.

```bash
git add PROJECT.md
git commit -m "docs: document the MCP AI connector in PROJECT.md"
git push origin main
```

**Phase 2 is complete when all four acceptance questions return hand-verified answers.**

---

# PHASE 3 — outline only (gets its own plan after Phase 1 lands)

Not detailed here on purpose: the two largest items depend on how the OAuth flow behaves
against real clients, which Phase 1 will reveal.

| Task | Scope |
|---|---|
| "Connected AI tools" screen | Settings page listing `mcp_connections` with tool, connecting admin, last used, and a Disconnect button (spec §7.2) |
| Audit-log viewer | Admin view of their own `mcp_call_log`; super-admin view across tenants |
| Ready-made questions | `src/lib/mcp/prompts.ts` — 10 MCP prompts, each declaring the data sets it needs and listed only when **all** of them are visible to that tenant, so a CRM-only account never sees a route question (spec §7.3) |
| ChatGPT handshake | Make the connector work in ChatGPT Developer Mode. Expect iteration; Claude and Perplexity ship regardless |
| Rollout flag | Flag on for the founder's account only, then opened to all tenants |
| Mobile consent wording | `wacrm-mobile`: updated location-consent text, shown only to employees of accounts with the workforce switch on. **Commit and push; do NOT trigger an EAS build.** |

---

## Deferred decisions for the founder

1. **`last_90_days` spans 91 days.** The dashboard's `getDatesForPeriod` uses `subDays(now, 90)` through end-of-today, so "Last 90 Days" is 91 calendar days inclusive. This plan **replicates** the quirk, because the Task 15 trust test requires the connector and the dashboard to agree. Fixing it is a separate, deliberate change to both surfaces at once.
2. **Dashboard periods are resolved in the browser's timezone.** `getDatesForPeriod` is a client component using `new Date()`. For a tenant whose account timezone differs from their users' browsers, the dashboard is already wrong and the connector (correct, server-side) will disagree with it. Out of scope here; worth its own task.
3. **Tuning after one month** of `mcp_call_log`: the daily call budget, the row ceiling, and which of the 14 deferred modules to add first.
