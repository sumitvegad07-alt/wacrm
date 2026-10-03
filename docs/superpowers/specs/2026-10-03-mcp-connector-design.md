# OZZO AI Connector (MCP Server) — Design

**Date:** 2026-10-03
**Status:** Approved by founder (brainstorming complete)
**Scope:** `wacrm-web` (one mobile consent change, see §11)

---

## 1. What this is

A read-only MCP server inside `wacrm-web` that lets an account's **Admin** connect
their own AI tool — Claude, ChatGPT, Perplexity, Gemini Enterprise — to their OZZO
data. The admin asks questions in natural language; the AI fetches the data it needs
and formats the answer however the admin wants, including Excel and PDF files that the
AI generates on its own side.

OZZO's job is narrow and boring: expose clean, correct, account-scoped data through a
small set of well-described tools. All language understanding, comparison and file
generation happens in the AI tool.

### Worked example

Admin types: *"Check my OZZO — how many visits for Shah Traders in the last 180 days?"*

1. The AI calls `list_data` → gets the menu of modules this tenant may read.
2. The AI calls `fetch_data("customers", {search: "Shah Traders"})` → resolves the name to an id.
3. The AI calls `describe_data("visits")` → learns the fields, filters and business rules.
4. The AI calls `fetch_data("visits", {customer_id: …, period: "last_180_days"}, measures: ["count"])`.
5. OZZO resolves the period **in the tenant's timezone**, runs it through the existing
   report engine as that admin, caps the rows, writes an audit row, returns JSON.
6. The AI writes the sentence. "Put it in Excel" → the AI builds the Excel.

### The leverage: the AI does the thinking

Question 4 of the founder's acceptance set — *"is everyone following their route plan?"* —
has no corresponding report in OZZO and **needs none**. The AI fetches today's route plans,
fetches today's actual visits, and compares them itself. We expose data; we do not
pre-compute every possible question. This is the core reason an AI connector beats
building another report screen.

---

## 2. Decisions (settled — do not relitigate)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Read only.** No writes in v1, ever considered separately. | Covers 100% of the stated need at near-zero risk. An AI that misreads an instruction cannot corrupt customer records. |
| 2 | **Admin only, forever.** No per-user scoping, now or later. | Founder ruling. Removes the need for a `SECURITY DEFINER` scope-replaying function, which would have been a new hole through the hardened data-scope work. |
| 3 | **Nothing to configure.** Paste one URL, log in, click Allow. | Founder requirement: "ready to ask", not "assemble it yourself". |
| 4 | **OAuth 2.1 + Dynamic Client Registration** is the only auth for the MCP connector. | Forced: ChatGPT mandates OAuth 2.1 + DCR and **does not accept bearer tokens**. It also happens to deliver decision 3. See §2.1 — the API-key fallback discussed during brainstorming is dropped. |
| 5 | **Three tools, not thirty.** | AI tools are built to explore a catalog. Thirty named tools is more code, more maintenance, and measurably worse AI accuracy. |
| 6 | **21 modules in v1** (+ DSR free). | Medium coverage (18) plus founder's additions: Stock, Schemes, Device Health. |
| 7 | **Free on every plan.** | Founder ruling. Differentiation land-grab. Makes cost control load-bearing (§8). |
| 8 | **Runs as the connecting admin's own session**, not a service-role client. | The only way `execute_report` works (it is `SECURITY INVOKER` by design), and it makes tenant isolation a database guarantee instead of a coding convention. |
| 9 | **Lives in `wacrm-web` at `/api/mcp`.** | Reuses auth, the report engine and plan gating directly. One deploy, one log stream. Moving it out later is a lift-and-shift of one folder. |
| 10 | **Named periods only — the AI never sends raw dates.** | Prevents a repeat of the DSR "0 visits" timezone bug. Date correctness is never the AI's responsibility. |

### 2.1 Change made during write-up: the API-key fallback is dropped

During brainstorming we agreed to keep API-key authentication as a quiet fallback
alongside OAuth, on the grounds that `requireApiKey()` already exists. Writing §6.1
exposed a contradiction that makes this unworkable.

An API key resolves to a **service-role client with no logged-in user**. `execute_report`
is `SECURITY INVOKER` and must stay that way, so it cannot be called without a user
session. An API-key caller could therefore reach only the 11 Route B modules and none of
the 11 report-engine ones — a second, weaker door serving half the data, with its own
separate isolation guarantees to maintain.

Resolution: **the MCP connector is OAuth-only.** Claude, ChatGPT and Perplexity all
support OAuth, so nothing is lost. The existing `/api/v1` API-key surface is untouched and
unaffected. Local development authenticates through the real OAuth flow against a dev
account, which also means we test the path customers actually use.

---

## 3. AI tool compatibility

| Tool | Supported | Requirement |
|---|---|---|
| Claude | Yes | Paid plan |
| ChatGPT | Yes | Paid plan + Developer Mode; OAuth 2.1 + DCR mandatory, bearer tokens rejected |
| Perplexity | Yes | Pro / Max / Enterprise (custom connectors added March 2026) |
| Gemini | Partial | Gemini Enterprise and Gemini CLI only; not the consumer app |

One server serves all of them. No per-tool code.

---

## 4. Architecture

### 4.1 Endpoints

| Path | Job |
|---|---|
| `POST /api/mcp` | The MCP endpoint (Streamable HTTP, JSON-RPC: `initialize`, `tools/list`, `tools/call`, `prompts/list`, `prompts/get`) |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 — names the authorization server |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 — advertises the OAuth endpoints |
| `POST /api/mcp/oauth/register` | RFC 7591 Dynamic Client Registration — the AI tool self-registers. This is what removes manual setup. |
| `GET /api/mcp/oauth/authorize` | OZZO login + the Allow screen (§7.1) |
| `POST /api/mcp/oauth/token` | Issues and refreshes access tokens; PKCE required |

### 4.2 Library

`src/lib/mcp/`

| File | Job |
|---|---|
| `catalog.ts` | The 21 module descriptors: base table, allow-listed fields, allowed filters, group-by dimensions, measures, required plan line, required module toggle, business notes, worked examples. **Single source of truth** — tools, prompts and gating all derive from it. |
| `tools.ts` | The three tool definitions and their JSON schemas |
| `prompts.ts` | The ~10 ready-made questions, plan-filtered via `catalog.ts` |
| `periods.ts` | Named-period → account-local date range resolution |
| `fetch.ts` | Route A (report engine) and Route B (described reader) |
| `session.ts` | Stored admin session: load, refresh, serialise refreshes, invalidate |
| `audit.ts` | Writes `mcp_call_log` |
| `limits.ts` | Row cap, truncation flag, daily call budget |

### 4.3 Database (one migration)

| Table | Purpose |
|---|---|
| `mcp_oauth_clients` | DCR registrations: client_id, client_name, redirect_uris |
| `mcp_oauth_codes` | Short-lived single-use authorization codes + PKCE challenge |
| `mcp_connections` | One row per connected AI tool: account_id, profile_id, client_id, hashed access/refresh tokens, **encrypted Supabase refresh token**, last_used_at, expires_at, revoked_at |
| `mcp_call_log` | Audit: connection_id, account_id, profile_id, tool, module, row_count, duration_ms, truncated, created_at |

Token hashing reuses `src/lib/api-keys/keys.ts` (SHA-256; keys are full-entropy, so a
slow KDF buys nothing). The privacy switch lives in the existing `accounts.settings`
JSONB as `mcp_allow_workforce_data`, mirroring how `geo_fencing` is stored.

---

## 5. The three tools

### 5.1 `list_data`

No inputs. Returns:

- account name
- **timezone** and **today's date in that timezone** (so the AI can phrase "as of 3 Oct 2026" correctly without computing filters)
- the module menu, after plan-line, module-toggle and privacy-switch filtering

### 5.2 `describe_data(name)`

Returns for one module: fields, filters, group-by dimensions, measures, allowed periods,
**business notes in prose**, and **two or three worked example calls**.

The notes and examples are where answer quality lives. Without notes, an AI invents its
own definition of "productive visit" and confidently reports a wrong number. Without
examples, it fumbles two calls before succeeding. Both are plain text in `catalog.ts`.

### 5.3 `fetch_data(...)`

Inputs: `dataset`, `period` (named), `time_of_day` (optional, local), `filters`,
`group_by`, `measures`, `fields`, `sort`, `limit`, `page`.

Two modes:

- **Summary** — `group_by` + `measures` → aggregated numbers
- **Detail** — `fields` → rows

Every response includes:

- `period_resolved` — the actual dates used, in account time, so the AI can state them and the admin can verify
- `truncated` — an explicit flag when more data existed than was returned

`truncated` matters more than it looks: a silent cut-off is how an AI confidently reports
₹4 lakh of sales when the real figure is ₹12 lakh. The AI must be able to say "there was more".

**Summary before detail.** A broad detail request against a large module returns the
summary plus a "too broad, narrow it down" note rather than a record dump.

### 5.4 GPS special case

A naive answer to *"where was Y roaming 11am–5pm"* is ~4,000 pings. The default response
is instead a **stop-and-dwell summary** (~12 rows): where they stopped, for how long, and
distance travelled between stops. Builds on the existing `location_daily_summary` table.
Raw pings remain available only on explicit request.

---

## 6. Data access

### 6.1 Runs as the connecting admin

At the Allow screen the admin authenticates with their real OZZO credentials, which yields
a genuine Supabase session. Its refresh token is stored encrypted and **every AI query runs
as that admin.**

This solves four problems at once:

1. `execute_report` works untouched — no migrations, no `SECURITY DEFINER` function, no hole in the data-scope hardening.
2. **Tenant isolation is enforced by RLS at the database**, not by our carefulness. A bug in this module cannot leak account A's data to account B.
3. **Numbers match the dashboard exactly** — same function, same user, same rules. Divergence here would destroy trust in both surfaces.
4. **Access dies correctly** — admin leaves or is demoted, the connection stops.

Known wrinkles, handled:

- Supabase refresh tokens rotate on use. The rotated token must be persisted every time. Concurrent calls must not race: refresh is serialised per connection and the access token cached in memory until near expiry.
- Password change invalidates the session. The MCP error must read *"Reconnect OZZO in your AI tool"*, not a stack trace.
- `account_role` is re-checked on every call, so demotion takes effect immediately rather than at next refresh.

### 6.2 Two routes, one catalog

| Route | Modules | Mechanism |
|---|---|---|
| **A — report engine** | 11 with existing reports: orders, sales, quotations, payments, ageing, leads, deals, visits, expenses, tasks, **DSR** | Calls `execute_report`, exactly as the dashboard does |
| **B — described reader** | 11 new: customers, products, employees, GPS, attendance, leave, routes, territories, stock, schemes, device health | Query built strictly from the `catalog.ts` descriptor |

DSR comes free — it is a report, not a module, so wrapping it costs nothing, and it is the
cross-module day-in-the-life view admins ask for most.

### 6.3 The rule that keeps Route B safe

The AI never writes a query; it picks from a list.

- **Fields are allow-listed individually.** No `select *` anywhere. A column not named in `catalog.ts` cannot be returned, even by accident — so the next sensitive column someone adds is safe by default.
- **The account filter is always applied** on top of RLS. Two locks on one door.
- **A test enforces both** across all 21 descriptors, failing the build otherwise, so the guarantee cannot rot.

Verified 2026-10-03 against production (Mumbai `ltigfpywdbfilsagtpyd`): all 21 modules
carry `account_id`, including `profiles`. The historical `profiles.plain_password` column
has already been dropped.

---

## 7. Admin experience

### 7.1 The Allow screen

The single most important screen — the only moment a real choice is made. Plain words, no
scope checkboxes:

> **Claude wants to read your OZZO data.**
> It will be able to read: customers, orders, quotations, payments, outstanding, leads,
> deals, visits, tasks, expenses, products, stock, schemes, employees, routes and territories.
> **This data will leave OZZO and be sent to Anthropic.**
> Connecting as: sumit@company.com (Admin)
> *Employee location, attendance and device data is not included. Your account owner can
> switch that on in Settings.*
> **[Allow] [Cancel]**

The module list is generated from the tenant's actual entitlements, not hardcoded.

### 7.2 "Connected AI tools" screen

Setup is automatic; **seeing and cutting off** a connection is not, and it is the recovery
path if a token leaks.

| AI tool | Connected by | Last used | |
|---|---|---|---|
| Claude | Sumit (Admin) | 10 minutes ago | Disconnect |

Disconnect is immediate. Access tokens live 1 hour and renew silently; a connection
unused for **90 days** expires by itself.

### 7.3 Ready-made questions

~10 MCP prompts, appearing as a clickable list inside the AI tool so the admin need not
think of a question at all. Examples: *Today's business summary*, *Who isn't following
their route plan?*, *Top 10 customers who owe me money*, *Which reps haven't punched in
today?*, *This month's sales vs last month*.

**Plan-filtered from `catalog.ts`** — a CRM-only tenant is never shown a route question.
A prompt is listed only if every module it depends on is available to that tenant, so
prompts and tools can never drift apart.

---

## 8. Safety and limits

### 8.1 Audit log

Every call writes one row: connection, admin, AI tool, module, row count, duration,
truncation, timestamp. Admins see their own account's log; super-admin sees all tenants'.

Two reasons it is non-negotiable. A leaked token is the primary risk of this feature and
this is the only way it would ever be noticed. Second, it answers "which module do we
expose next?" with real demand data instead of guesses.

### 8.2 Limits

Load-bearing because the feature is free on every plan:

- **1,000 rows** maximum per call, with paging. This is a server-side ceiling: a larger `limit` from the AI is silently clamped to it and `truncated` is set, never honoured.
- **Summary before detail** for broad requests
- **Per-account daily call budget** — generous enough to be invisible, tight enough that a runaway AI loop cannot run up a Vercel/Supabase bill overnight

Opening values deliberately loose; tuned from the audit log after one month rather than
guessed now.

### 8.3 The sensitive three

GPS, attendance and device health sit behind one Settings switch,
**"Allow AI tools to read employee location, attendance and device data"**, default **OFF**.
The other 18 modules are unaffected.

Hiding a module from the menu is **not** security — with the switch off, these modules are
also **refused when called by name**.

When a tenant enables it, **only that tenant's** field employees receive the updated
location-consent wording on next app open. `location_consents` is already keyed
`(account_id, user_id, policy_version)`, so this needs no new table and no global
re-consent of every tenant's staff.

### 8.4 Gating is automatic

Plan lines and module toggles need no new rules: a CRM-only tenant's menu simply has no
routes or GPS on it. When something is genuinely unavailable the AI receives a relayable
sentence — *"Route data needs the SFA plan"* — so the admin hears a useful answer, and a
quiet upgrade prompt, from their own AI.

---

## 9. Module coverage

**In v1: the 21 chosen modules, plus DSR free — 22 entries on the menu.**

Route A (report engine) — 10 chosen modules: orders, sales, quotations, payments,
ageing/outstanding, leads, deals, visits, expenses, tasks. **Plus DSR**, which is a
cross-module report rather than a module, and costs nothing to wrap. Route A total: 11 entries.

Route B (described reader) — 11 chosen modules: customers/contacts, products (+categories, units),
employees/team roster, GPS location trail, attendance/punch, leave & holidays, route plans
& execution, territories, stock, schemes, device health & last-seen.

**Out of v1 — added on demand, driven by the audit log:** price lists, dispatches, tax
slabs, WhatsApp conversations & messages, broadcasts, pipelines & stages, lead masters,
FSM customer assets, geo-fences, expense types & rate tiers, payment types & order
statuses, custom field definitions, announcements, automations & logs.

**Permanently skipped:** document templates, import jobs, notification queues, onboarding
progress. No admin will ask an AI about these.

---

## 10. Testing

### Layer 1 — pure logic, no database

- **Named-period resolution** — the heaviest-tested unit in the module. IST tenant asking "today" at 00:30; "this month" across a boundary; "last 180 days"; the 11am–5pm local window. This is exactly where the DSR "0 visits" bug lived.
- **Catalog integrity** — walks all 21 descriptors, fails the build if any lacks an account filter, a field allow-list, a plan line, a module toggle, business notes or worked examples. Stops module 22 being added sloppily later.
- Bad input rejection (unknown module, unknown field, invented filter, bad period).
- Row cap and `truncated` flag.
- OAuth mechanics: PKCE, single-use codes, token hashing, expiry.

### Layer 2 — real database, for all 21 modules

- Account A's connection returns **zero** rows belonging to account B
- Non-admin connection refused
- Demoted admin loses access immediately
- Disconnected connection refused
- Privacy switch OFF → sensitive three absent from the menu **and refused when named**
- CRM-only tenant cannot fetch route data

### Layer 3 — the trust test

Same report, same user, through the dashboard and through the connector → identical
output. Guards the single most important promise the feature makes.

### Acceptance (founder sign-off)

Verified by hand, in both a real Claude and a real ChatGPT:

1. How many visits for customer X in the last 180 days?
2. Where was employee Y roaming between 11am and 5pm today?
3. Today's total order value, grouped by employee, customer, quantity and order time
4. Is everyone following their route plan? Who skipped, and which customers?

All four correct in both tools = v1 done. Any one wrong = not done.

### Known schedule risk

ChatGPT's connector rules are strict and thinly documented, and it rejects slightly
off-spec servers with unhelpful errors. Mitigation: verify against **Claude first** (readable
errors) and the MCP Inspector, then make ChatGPT work. If ChatGPT proves stubborn, Claude +
Perplexity ship on time and ChatGPT follows — one tool does not hold the release hostage.

---

## 11. Rollout

1. Build and push to `main` behind a flag **on for the founder's account only**; test with a real Claude.
2. Verify the four acceptance questions by hand against the database.
3. Resolve the ChatGPT handshake.
4. Open the flag to all tenants.
5. Marketing: site page, brochure line. *"Ask your own AI about your business"* — no
   competitor in the India FSM/SFA band (Fieldy, Zoho FSM) offers this.

**Mobile dependency.** The updated location-consent wording is a `wacrm-mobile` change.
Per standing founder rule, it will be committed and pushed but **no EAS build will be
triggered** — those are batched by the founder. The web connector therefore ships first
with the location switch forced off; location unlocks whenever the next APK ships. The
other 18 modules are not blocked.

**Later, optional:** submit to Anthropic's connector directory, which would remove even
the paste-a-URL step.

---

## 12. Open items

None blocking. Values to tune after one month of audit-log data: the daily call budget,
the row cap, and which of the 14 deferred modules to add first.
