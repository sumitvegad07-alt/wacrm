# Feature Specification: OZZO Revenue Engine — Release 1

**Status:** **SCOPE FROZEN 2026-10-02** (Revision 4). No code until the implementation plan
derived from this document is approved.
**Module:** New module, founder-only, inside `/admin/revenue/*`. Nothing tenant-facing.
**Date:** 2026-10-02
**Owner:** Sumit Vegad (founder)
**Model:** `claude-opus-5-5` — founder-confirmed 2026-10-02
**Monthly AI budget ceiling:** **$100/month**, enforced in the database before any external call
**Platform scope:** **WEB ADMIN ONLY.** No mobile surface, ever, unless D1 changes.
**Requires provisioning:** `ANTHROPIC_API_KEY` in server env (`.env.local` + Vercel). It still
does not exist — the same block that holds ASK OZZO. The Research Agent cannot run without it.

**Source document:** founder's PRD "OZZO Revenue Engine — Product Requirements & Architecture",
Revision 3, 2026-10-02. This specification supersedes it. Where the two disagree, this one wins
(see §2 — Revision 3 made five claims about the codebase that are wrong).

---

## 1. Freeze record — the five founder rulings of 2026-10-02

These were decided after Revision 3 was written, in response to the code audit in §2.

| # | Question | Ruling |
|---|---|---|
| F1 | R1 as one block, or the R1a/R1b split recommended in §14? | **One block.** All items, ~7–8 weeks. Nothing ships as "done" until the whole list is finished. Recorded against my recommendation to split; the founder read the trade-off and chose one block. |
| F2 | How does the engine handle FSM, whose prices are unapproved placeholders and whose product is unbuilt? | **Score it, never pitch or quote it.** `fit_fsm` is computed and displayed with reasons so FSM demand is measurable. `best_fit_line` can never resolve to `fsm` in R1. No draft pitches FSM, no deal or proposal defaults to an FSM plan. |
| F3 | Revenue Engine proposal stages vs. the existing Sales Proposals stages? | **One shared vocabulary.** Extend the existing proposal status list with `in_review` and `approved`; the Revenue Engine reuses it. Existing proposals keep working untouched. |
| F4 | Monthly AI budget and model? | **$100/month on `claude-opus-5-5`**, overnight Batch API. Measure the claim-verification rate for a month; step down to Sonnet only if it holds. Model is recorded per run, so nothing is locked in. |
| F5 | Which competitors to seed as battlecards (O4)? | **All 12** already written on ozzo.co.in, not the 4 named in Revision 3. See §2.4. |

**Routine calls taken without a founder question** (override at will):

- **Nav label.** The Revenue Engine menu item reads **"Prospects"**, not "Companies", because
  `/admin/companies` already means *paying tenants* in the same menu. The route stays
  `/admin/revenue/companies` as specified.
- **Country seed (O5).** Revision 3's own recommendation: India, plus UK, Ireland, France,
  Netherlands, Spain, Italy on `legitimate_interest`, and Germany + Austria on
  `prior_consent_required`. Cheap to change later — it is seed data, not structure.

---

## 2. Corrections to Revision 3 — what the code audit found

Revision 3 asserted a great deal about the existing codebase. Most of it is correct and is
restated in §3. These four areas were wrong or missing — five findings in all, three of which change the schema.

### 2.1 Verified correct

- No email-sending dependency exists anywhere in `package.json` — no Resend, SendGrid, SES or
  nodemailer. The email channel really is unbuilt. Revision 3's §9 warning stands in full.
- `@anthropic-ai/sdk ^0.122.0` is installed. `src/lib/ozzo/claude.ts` exports
  `OZZO_MODEL = 'claude-sonnet-5'` — the Revenue Engine takes its own separate client and must
  not share ASK OZZO's prompt or rate budget.
- `requireFounder()` exists at `src/lib/auth/superadmin.ts:36`.
- `quote()` exists at `src/lib/plans/pricing.ts:194`; `PlanId` and `BillingTerm` are as described.
- The Universal Import Framework is real and reusable for adapter A1: `src/lib/import/`
  (`registry.ts`, `descriptors/`, `run.ts`, `validate.ts`, `resolve-lookups.ts`).
- `vitest.config.ts` matches `src/**/*.test.ts(x)` only. `*.spec.ts` is not picked up.
- Newest existing migration is `20260929152000`. The planned `20261002*` filenames are safely
  later and will not reorder.
- `ANTHROPIC_API_KEY` is read by three files and is still not provisioned.

### 2.2 FSM prices are unapproved placeholders — ruling F2

`src/lib/plans/catalog.ts:59` carries this comment above the FSM prices:

> PLACEHOLDERS — not founder-approved (FSM spec section 10 ruling 1). Do not publish these
> prices until they are confirmed.

Revision 3 makes `fit_fsm` a first-class score, lets `best_fit_line` resolve to `fsm`, defaults
`re_deals.plan_id` from it, and computes `value_inr` via `quote()`. Together those would quote
an unapproved FSM price automatically, for a product line with nothing built behind it.

**Resolution (F2):** `fit_fsm` is computed, stored and displayed with its reason. It is excluded
from `best_fit_line` selection in R1. Enforced in one place — the Fit scoring function — and
proven by a test. When FSM is built and its prices approved, the exclusion is deleted.

### 2.3 A proposal status machine already exists — ruling F3

`src/lib/proposals/status.ts` defines `draft → sent → won | lost`, with deliberate rules about
when `sent_at` and `decided_at` are stamped (`decided_at` decides which month a won deal counts
in, so it is set on transition rather than inferred from `updated_at`).

Revision 3's `re_proposals.stage` invented a parallel seven-state machine
(`draft | in_review | approved | sent | accepted | rejected | expired`). Two vocabularies for one
concept is how the proposal board and the forecast start disagreeing.

**Resolution (F3) — one shared vocabulary.** `ProposalStatus` becomes:

```
draft | in_review | approved | sent | won | lost | expired
```

`accepted`/`rejected` from Revision 3 are dropped in favour of the existing `won`/`lost`.
`re_proposals.stage` is typed as `ProposalStatus`. Three consequences the implementation must
handle:

1. **An eighth migration is required.** `supabase/migrations/20260926170000_platform_proposals_status.sql:25`
   creates `platform_proposals_status_check` constraining status to
   `('draft','sent','won','lost')`. That constraint must be widened on the live
   `platform_proposals` table.
2. `STATUS_LABEL` and `STATUS_CLASS` are `Record<ProposalStatus, …>`, so adding members produces
   compile errors until every new state is given a label and a chip colour. That is the desired
   behaviour — TypeScript enforces completeness.
3. **The existing forecast is safe, and this is verified, not assumed.**
   `src/lib/proposals/forecast.ts:154` filters on exact equality (`status === "won"`, `"lost"`,
   `"sent"`). New states cannot be swept into those buckets. A proposal sitting in `approved` is
   correctly *not* counted as sent. A test must assert that adding the states leaves every
   existing forecast number unchanged.

### 2.4 There are 12 competitors already written, not 4 — ruling F5

`ozzo-site/src/lib/comparisons.ts` holds 12 live comparison pages: Bizom, BeatRoute, FieldAssist,
Zoho, Salesforce, Unolo, FieldSense, TrackOlap, Delta Sales App, mAssist, KOOPS, Creatio.

Its `Comparison` type maps nearly field-for-field onto `re_battlecards`:

| comparisons.ts | re_battlecards |
|---|---|
| `theirStrengths: string[]` | `their_strengths` — already mandatory and already honest |
| `ozzoWins: {title, body}[]` | `our_differentiators` |
| `verdict`, `bestForThem` | `positioning` |
| `competitorCategory` | `category` |
| `slug` | `competitor_key` |

Two notes:

- **ozzo-site is a separate repo.** The seed cannot import `comparisons.ts`; its content must be
  transcribed into the seed migration. One-time work, but 12 rich cards, not 4 — item 10 grows
  from 3 days to ~4.
- **Its honesty contract is stricter than Revision 3's and wins.** Rule 2 of that file:
  *never state a competitor's exact price* — a wrong number is a legal and trust risk. Revision 3's
  `pricing_notes` said "only what is publicly stated". This spec adopts the stricter rule:
  `pricing_notes` records positioning only (quote-based, per-user band, transparency), never a
  competitor's figure. Same reasoning as D10; the two must not disagree.

### 2.5 "Companies" is already taken

`/admin/companies` means *paying tenants* in the superadmin nav
(`src/app/(superadmin)/admin/admin-shell.tsx:33`). Resolved by the nav label in §1.

---

## 3. Settled decisions

D1–D10 are carried forward from Revision 3 unchanged. D11–D13 are new, from the §1 rulings.

| # | Decision | Consequence |
|---|---|---|
| D1 | Founder-only internal tool, inside `/admin` | No plan gating, no rights registry, no mobile work, no support burden. If ever sold, most of it is a rewrite — accepted. |
| D2 | Operator concept in the schema from day one | Every company, activity and deal carries `owner_id`. Adding telecallers later is granting access, not a migration. |
| D3 | Source Adapter boundary — 7 adapters documented, 2 built in R1 | The data-source question never blocks the rest of the engine. |
| D4 | Generate messages in R1, send them later | R1 researches, scores and writes the outreach; the founder sends by hand. Generation carries none of sending's cost. |
| D5 | Spend caps live in the database, not in code comments | A bug cannot run up a Google or Anthropic bill. |
| D6 | No LinkedIn adapter. No CAPTCHA or bot-detection bypass, ever | Some directories are simply not viable. |
| D7 | `re_*` tables are fully separate from tenant tables | Nothing here can touch `contacts`, `leads`, `deals` or any customer's data. |
| D8 | Channel Provider boundary — all sending optional and modular | The engine works forever on the `manual` provider. |
| D9 | Fit and Priority are two scores in two tables | Different questions, different recompute triggers. |
| D10 | Competitor facts are founder-authored, never AI-researched | Wrong claims about a competitor are a disparagement risk. |
| **D11** | **FSM is scored but never pitched or quoted in R1** | Demand discovery without selling unbuilt, unpriced software. One guard in Fit scoring, one test. |
| **D12** | **One proposal status vocabulary across the whole product** | The Revenue Engine extends the existing machine rather than inventing a second. |
| **D13** | **A competitor's exact price is never recorded or generated** | Carried from the marketing site's honesty contract, which is stricter than Revision 3 was. |

### Two constraints that shaped everything (unchanged)

**AI cannot generate a prospect list.** A language model asked for "FMCG distributors in Gujarat
with decision makers" produces plausible company names, titles and phone numbers that do not
exist. It has no directory inside it. The AI is the writing and reasoning layer; it is never the
collection layer.

**Cold WhatsApp is a bad first touch.** Messaging businesses that never opted in violates Meta
policy and risks the WABA number and its quality rating. WhatsApp is a follow-up channel only.

---

## 4. Frozen scope — 18 items

Revision 3 listed 17 items at ~49 days. The §2 audit adds ~2 days: the eighth migration (+0.5),
the FSM gate (+0.5), and 12 battlecards instead of 4 (+1).

| # | Item | Days |
|---|---|---|
| 1 | Seven migrations + rollback notes (§6.15) | 3 |
| 2 | **Eighth migration — widen `platform_proposals_status_check`** (new, §2.3) | 0.5 |
| 3 | Revenue Command Center cockpit + founder landing redirect + non-founder test | 4 |
| 4 | Prospect Hub: list + detail, seven tabs | 5 |
| 5 | Spreadsheet import (A1) + inbound web forms (A2) | 3 |
| 6 | Research Agent: batch + live, strict closed-key schema, evidence-or-flag | 6 |
| 7 | Fit scoring — 4 lines with reasons, **FSM excluded from `best_fit_line`** | 2.5 |
| 8 | Priority scoring — components, nightly + event-driven | 2 |
| 9 | Outreach Generator — 4 channels, approval, manual send | 3 |
| 10 | Meeting Brief Generator | 2 |
| 11 | Battlecards: schema, founder editor, **12-card seed**, approval gate | 4 |
| 12 | Migration Pitch generator | 1 |
| 13 | Country profiles: schema, editor, seed, consent gate on drafting | 2 |
| 14 | Activities, deals, suppressions | 3 |
| 15 | Proposal workflow: shared stages, board, AI prefill, handoff | 3 |
| 16 | Channel Provider boundary + `manual` provider | 1 |
| 17 | Sources / channels / spend screens (read-only in R1) | 2 |
| 18 | Tests per §10 | 4 |
| | **Total** | **~51 days ≈ 7–8 weeks** |

**Build order.** Per F1 nothing is "done" until all 18 are finished, but the work is sequenced so
the founder can watch it come alive rather than wait eight weeks on faith: migrations → Research
Agent → both scores → Prospect Hub → generators → cockpit → battlecards/countries/proposals →
config screens → tests throughout (TDD, not a phase).

### Explicitly out of scope for R1

No automated email or WhatsApp sending. No meeting booking (the brief ships, the calendar does
not). No sales coach. No website-visitor intelligence. No content studio. No mobile surface. No
MCA, Places or Apify adapters — those are R2. Nothing tenant-facing.

---

## 5. Personas and the permissions matrix

Release 1 has one human user. The matrix still defines three human roles and the AI agent as its
own principal with its own limits, because that is where the risk sits.

| Principal | Exists in | Description |
|---|---|---|
| Founder | R1 | `sumitvegad07@gmail.com`, via the existing `requireFounder()` |
| SDR | R3+ | Telecaller / inside sales; works assigned companies |
| Agency | R4+ | Outside freelancer; assigned companies only, cannot see money |
| AI Agent | R1 | Research, scoring and generation jobs, running as service role |
| Tenant user | never | Any OZZO customer. No access to anything in this document. |

### Matrix

| Capability | Founder | SDR | Agency | AI Agent | Tenant |
|---|---|---|---|---|---|
| View all companies | yes | yes | own only | read | no |
| Create / edit company | yes | yes | own only | no | no |
| Disqualify / soft-delete company | yes | yes | no | no | no |
| Reassign owner | yes | no | no | no | no |
| View contacts incl. phone / email | yes | yes | own only | read | no |
| Trigger a research run | yes | yes | no | — | no |
| View research evidence | yes | yes | own only | — | no |
| **Write research claims** | no | no | no | **yes — only principal that can** | no |
| Write Fit scores | override only | no | no | yes | no |
| Write Priority scores | no | no | no | yes | no |
| View Fit + Priority with reasons | yes | yes | own only | read | no |
| Generate outreach drafts | yes | yes | own only | yes — drafts only | no |
| Edit / approve an outreach draft | yes | yes | own only | no | no |
| Generate a meeting brief | yes | yes | own only | yes | no |
| **Author / edit / approve a battlecard** | **yes — only principal that can** | no | no | **no** | no |
| Generate a migration pitch | yes | yes | own only | yes — drafts only | no |
| View country profile | yes | yes | yes | read | no |
| Edit country profile | yes | no | no | **no** | no |
| Log an activity | yes | yes | own only | no | no |
| View deal value / pipeline total | yes | yes | **hidden** | no | no |
| Create / edit deal, move stage | yes | yes | no | no | no |
| Generate a proposal draft | yes | no | no | yes — prefill only | no |
| **Approve / send a proposal** | **yes — only principal that can** | no | no | no | no |
| Manage suppressions | yes | add only | add only | no | no |
| Configure source adapters + caps | yes | no | no | no | no |
| Configure channel providers | yes | no | no | no | no |
| Run a source harvest | yes | no | no | no | no |
| View AI / API spend | yes | no | no | no | no |
| Export to CSV | yes | no | no | no | no |
| Any access to tenant tables | yes, via existing `/admin` | no | no | no | n/a |

### The four rules this matrix encodes

1. **The AI agent can never write a business record — only evidence and drafts.** It writes to
   `re_research_runs`, `re_research_claims`, `re_fit_scores`, `re_priority_scores`,
   `re_outreach_drafts`, `re_meeting_briefs` and `re_migration_pitches`. It cannot create a
   company, edit a contact, move a deal, send anything, author a battlecard, or edit a country
   profile. Drafts are explicitly drafts; a human approves before use and `approved_at` records
   it. If the model hallucinates, the damage is confined to a row clearly labelled AI output that
   nobody has acted on.
2. **The founder cannot write a research claim.** Claims are machine-authored and evidence-bearing.
   A human who disagrees adds a Fit override or a company note. The claim history stays honest.
3. **Money is a separate permission from data.** Agency sees companies and logs calls, but
   `value_inr` and the pipeline screen are hidden — enforced in RLS through a restricted view,
   not by hiding a button.
4. **Competitor facts are founder-only, both ways (D10).** Only the founder writes a battlecard;
   the AI never can. The AI may compose a pitch from an approved battlecard; it may not decide
   what is true about a competitor.

### Enforcement

- **Route level:** `requireFounder()` on every `/admin/revenue/*` page, exactly as
  `/admin/proposals` does today.
- **Database level:** RLS on every `re_*` table, in two shapes.
  - *Owned tables* (`re_companies`, `re_contacts`, `re_activities`, `re_deals`, and the research /
    score / draft tables through their company) use `public.re_can_read(owner_id)`. In R1 that
    helper resolves to "is the founder", so the policy is already correct when SDR rows arrive.
  - *Founder-only tables* (`re_operators`, `re_suppressions`, `re_source_configs`,
    `re_source_runs`, `re_battlecards`, `re_country_profiles`, `re_channel_configs`) have no
    `owner_id` and use `public.re_is_founder()` directly. `re_suppressions` gains an insert-only
    policy for SDR and Agency in R3.
- **Service role:** the AI jobs use the service-role key but are narrowed by `GRANT` to INSERT on
  the seven research / score / draft tables only — explicitly **not** `re_battlecards` or
  `re_country_profiles`. No blanket service-role access. Read the key via
  `src/lib/supabase/service-role-key.ts`, which already aliases the production env name
  `service_role` alongside `SUPABASE_SERVICE_ROLE_KEY`.

---

## 6. Database schema

Postgres on the existing Supabase project (Mumbai, `ltigfpywdbfilsagtpyd`). Migrations follow the
repo convention `YYYYMMDDHHMMSS_snake_name.sql`. All tables RLS-enabled. Timestamps
`timestamptz`; **all date grouping converts to the account timezone (IST), never
`toISOString()`** — the DSR "0 visits" bug came from exactly that mistake.

### 6.1 re_operators

The multi-operator hook from D2. One row in R1.

`id uuid pk` · `profile_id uuid → profiles.id unique` · `role text (founder|sdr|agency)` ·
`can_see_money boolean default true` (false for agency) · `is_active boolean default true` ·
`created_at timestamptz`

### 6.2 re_companies

The unit of work. A company, not a contact: many contacts, one owner, one status, one current Fit
set, one current Priority.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | |
| `website` | text | |
| `domain` | text | normalised host, no `www.`, lowercased |
| `country_code` | text | ISO-2 → `re_country_profiles` |
| `state` / `city` | text | |
| `industry` | text | |
| `nic_code` | text | from MCA (R2) |
| `cin` | text | MCA company identifier |
| `paid_up_capital` | numeric | from MCA — the real size signal |
| `employee_band` | text | `1-10` … `1000+` |
| `source_adapter` | text not null | `import \| inbound \| mca \| places \| apify` |
| `source_ref` / `source_url` | text | |
| `first_seen_at` / `last_refreshed_at` | timestamptz | |
| `owner_id` | uuid | → `re_operators.profile_id` |
| `status` | text | `new \| researching \| qualified \| working \| demo \| proposal \| won \| lost \| disqualified` |
| `disqualify_reason` | text | |
| `fit_crm` / `fit_wfa` / `fit_sfa` / `fit_fsm` | integer | 0–100 each, denormalised from latest `re_fit_scores` |
| `best_fit_line` | text | `crm \| wfa \| sfa` — **`fsm` is not a permitted value in R1 (D11)** |
| `fit_computed_at` | timestamptz | |
| `priority_score` | integer | 0–100, denormalised from latest `re_priority_scores` |
| `priority_band` | text | `today \| this_week \| later` |
| `priority_computed_at` | timestamptz | |
| `dealer_count` / `distributor_count` | integer | better buying signals than employee count |
| `branch_count` / `depot_count` | integer | |
| `field_force_estimate` | integer | |
| `territory_states` | text[] | |
| `existing_software` | text | the incumbent to displace → drives the migration pitch |
| `tags` | text[] | |
| `notes` | text | |
| `dedup_key` | text not null unique | domain, falling back to `slug(name) + city` |
| `is_active` | boolean default true | soft delete, matching the repo's pattern |
| `created_at` / `updated_at` | timestamptz | |

**Indexes:** unique on `dedup_key`; btree on `owner_id`, `status`, `priority_band`,
`best_fit_line`, `country_code`, `city`, `domain`, `existing_software`; GIN on `tags`,
`territory_states`.

The `best_fit_line` CHECK constraint excluding `fsm` is the database half of D11. The scoring
function is the application half. Both are required; a guard in one place only is a guard that
gets bypassed.

### 6.3 re_contacts

`id uuid pk` · `company_id uuid not null → re_companies on delete cascade` ·
`name` / `designation text` · `role_type text (decision_maker|influencer|gatekeeper|unknown)` ·
`email text` · `email_status text (unverified|valid|invalid|risky) default 'unverified'` ·
`phone` / `whatsapp text` (E.164 via the existing phone-utils) ·
`linkedin_url text` (reference only; never scraped — D6) · `is_primary boolean` ·
`consent_basis text (legitimate_interest|consent|inbound)` · `opted_out_at timestamptz` ·
`is_active boolean` · `created_at` / `updated_at timestamptz`

### 6.4 re_research_runs

One immutable row per AI research pass. Never updated.

`id uuid pk` · `company_id uuid not null` · `model text not null` · `prompt_version text not null`
· `effort text (low|medium|high)` · `inputs` / `raw_output jsonb` ·
`fetched_urls jsonb` (every URL the model actually fetched) ·
`input_tokens` / `output_tokens` / `cached_tokens integer` · `cost_usd numeric(10,4)` ·
`status text (queued|running|succeeded|failed|refused)` · `error text` ·
`batch_id text` (Anthropic Batch API id) · `started_at` / `finished_at timestamptz`

### 6.5 re_research_claims

The most important table in the design. Every structured fact the AI produced, with its evidence.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `research_run_id` | uuid not null | |
| `company_id` | uuid not null | |
| `claim_key` | text not null | from the closed list in §6.6 — an unknown key **fails the run** rather than being stored |
| `claim_value` | text not null | |
| `confidence` | numeric | 0–1, model-reported |
| `evidence_url` | text | null means it is a guess |
| `evidence_quote` | text | the exact sentence the claim came from |
| `is_verified` | boolean | **generated:** `evidence_url IS NOT NULL AND evidence_quote IS NOT NULL` |
| `created_at` | timestamptz | |

**The evidence-or-flag rule.** The UI renders a claim as fact only when `is_verified` is true,
showing the quote and a link. When false it renders as "AI guess — unverified" in muted styling
and is excluded from scoring, outreach drafts, meeting briefs and migration pitches.

Without this rule the Research Agent becomes a confident liar: it writes "I see you have 125 field
reps", the prospect says "we have 11", and the meeting is over. Same discipline already applied to
ROI figures in the brochures.

### 6.6 Claim keys — closed list

A closed list, because OZZO's buyers are agri, seeds, fertiliser, pumps and manufacturing — not
SaaS. For these companies employee count is a poor signal and often actively misleading: a
40-person fertiliser business with 200 dealers and 25 field reps is a far better SFA prospect than
a 300-person software firm.

| Group | Claim keys | Why it matters |
|---|---|---|
| Distribution | `dealer_count`, `distributor_count`, `channel_model`, `distributor_named` | The core OZZO buying signal. Dealers imply field reps, which imply SFA. |
| Field presence | `field_force_estimate`, `branch_count`, `depot_count`, `warehouse_count` | Reps to manage = the product. |
| Territory | `territory_states`, `territory_districts`, `export_markets` | Multi-state operation implies territory hierarchy and route planning. |
| Service footprint | `installed_base_signal`, `service_network`, `amc_offered`, `spare_parts_network` | The FSM signal — scored for learning only in R1 (D11). |
| Workforce | `team_size`, `shift_work_signal`, `attendance_pain_signal` | The WFA signal. |
| Company | `products`, `locations`, `industry_detail`, `turnover_signal`, `existing_software` | `existing_software` flags the incumbent and triggers the migration pitch. |
| Pain | `pain_point` (repeatable) | Each one needs its own evidence quote. |
| Fit reasons | `crm_fit_reason`, `wfa_fit_reason`, `sfa_fit_reason`, `fsm_fit_reason` | One sentence per line, explaining that line's score. |

Numeric claims mirror onto `re_companies` **only when `is_verified` is true**, so the list view can
filter and sort on them without re-reading claims.

### 6.7 Scoring — two tables (D9)

Fit changes only when research changes. Priority changes every day and after every activity. Two
write frequencies, two tables.

#### re_fit_scores — product suitability. Answers: *what do I pitch?*

`id uuid pk` · `company_id uuid not null` · `research_run_id uuid` ·
`rules_version text not null` (the scoring rules version, not the LLM) ·
`fit_crm` / `fit_wfa` / `fit_sfa` / `fit_fsm integer` (0–100 each) ·
`best_fit_line text` · `reasons jsonb` (one sentence per line, from the `*_fit_reason` claims) ·
`inputs jsonb` (every input value, so a score is reproducible) ·
`is_override boolean` · `override_reason text` · `computed_at timestamptz`

**Inputs:** dealer and distributor counts and field force → SFA · installed base, service network,
AMC, spare-parts network → FSM · team size, shift and attendance signals → WFA · everything else
plus `existing_software` → CRM.

**D11 gate.** `best_fit_line` is the highest of `fit_crm`, `fit_wfa`, `fit_sfa` **only**.
`fit_fsm` is stored and displayed but never selected, even when it is the highest of the four.
When it is the highest, the Fit tab says so plainly — "FSM scores highest at 88, but FSM is not
yet sellable, so the pitch is SFA at 74" — because hiding that would throw away the demand signal
the score exists to capture. A test asserts that an FSM-dominant company still returns a non-FSM
`best_fit_line`.

#### re_priority_scores — Answers: *who do I call now?*

`id uuid pk` · `company_id uuid not null` · `rules_version text not null` · `total integer` (0–100)
· `band text` (`today` ≥ 70 | `this_week` 40–69 | `later` < 40) ·
`components jsonb` (each contribution, so the cockpit can show why this is today's top call) ·
`computed_at timestamptz`

**Components — deterministic, no LLM:**

| Component | Contribution |
|---|---|
| Follow-up due today or overdue | +30 |
| Recent inbound signal (form, reply) | +25 |
| Engagement (answered a call, replied) | +20 |
| Fit magnitude — `best_fit_line` score scaled | up to +15 |
| Never contacted and high fit | +10 |
| Decay — per day since last touch beyond 14 days | −1, floor 0 |
| Suppressed, disqualified or inactive | excluded entirely |

Because the Fit magnitude component reads `best_fit_line`, D11 means an FSM-dominant company is
prioritised on its best *sellable* line. That is correct: there is no point ranking a call you
cannot make an offer on.

### 6.8 Generation tables

#### re_outreach_drafts

Generated on demand per company. **Never sent by the engine in R1** — the founder copies it out.

`id uuid pk` · `company_id uuid not null` · `contact_id uuid` ·
`channel text not null (whatsapp|email|call_script|linkedin)` ·
`variant text (first_touch|follow_up_1|follow_up_2|breakup|migration)` ·
`pitch_line text` (from `best_fit_line`) · `battlecard_id uuid` (when `variant = 'migration'`) ·
`subject text` (email only) · `body text not null` ·
`claims_used uuid[]` (the exact verified claims this leaned on) · `research_run_id uuid` ·
`model` / `prompt_version text` · `cost_usd numeric(10,4)` ·
`approved_at` / `approved_by` · `edited_body text` (the human's edit, kept separately from the
AI's original) · `sent_manually_at timestamptz` (writes a `re_activities` row) · `created_at`

**Rules.** A draft may cite only claims where `is_verified = true`. The generator is handed the
suppression list and the contact's `opted_out_at`, and refuses to draft for a suppressed contact.
It is handed the country profile and refuses email drafts where `requires_prior_consent` is true
unless `consent_basis = 'consent'`. It refuses to pitch FSM (D11). A WhatsApp draft is free text
for manual sending — **not** a Meta-approved template (§7.6).

#### re_meeting_briefs

`id uuid pk` · `company_id uuid not null` · `deal_id uuid` · `summary text` (company in three
lines) · `pain_points jsonb` (each with its evidence) ·
`likely_objections jsonb` (objection + suggested response; incumbent objections from the
battlecard) · `demo_flow jsonb` (ordered screens, driven by `best_fit_line`) ·
`questions_to_ask jsonb` · `claims_used uuid[]` (verified only) · `battlecard_id uuid` ·
`model` / `prompt_version text` · `cost_usd numeric(10,4)` ·
`generated_for timestamptz` (the meeting it was prepared for) · `created_at`

#### re_migration_pitches

`id uuid pk` · `company_id uuid not null` ·
`battlecard_id uuid not null` — **must be `is_approved = true`** ·
`why_switch text` (from approved differentiators plus this company's verified pain points) ·
`switching_plan text` (from `migration_notes`, shaped to this company's size) ·
`objection_prep jsonb` · `claims_used uuid[]` (verified only) ·
`model` / `prompt_version` / `cost_usd` · `approved_at` / `approved_by` · `created_at`

### 6.9 Competitor intelligence

#### re_battlecards — founder-authored, never AI-written (D10)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `competitor_key` | text not null unique | `bizom \| beatroute \| fieldassist \| …` — matches the ozzo-site slug |
| `display_name` | text not null | |
| `category` | text | which OZZO line it competes with |
| `positioning` | text | how they sell themselves, one paragraph |
| `our_differentiators` | jsonb | array of `{claim, proof_source}` — `proof_source` required, pointing at an OZZO feature, screenshot or `/compare` page |
| `their_strengths` | jsonb | **mandatory and honest.** A battlecard that pretends a competitor has no strengths gets you ambushed in a demo. |
| `objection_responses` | jsonb | array of `{objection, response}` |
| `migration_notes` | text | what switching actually involves — data, retraining, contract timing |
| `pricing_notes` | text | **positioning only. Never a competitor's figure (D13).** |
| `source_urls` | jsonb | where each fact came from, including OZZO's own `/compare` pages |
| `is_approved` | boolean default false | an unapproved card cannot be used by any generator |
| `approved_by` / `approved_at` | uuid / timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

**Seed:** all 12 competitors from `ozzo-site/src/lib/comparisons.ts`, transcribed (separate repo —
cannot be imported), seeded with `is_approved = false` so the founder reviews each before use.

**Guardrail (D10):** the AI cannot insert or update this table — enforced by `GRANT`, not
convention.

#### re_country_profiles — curated reference data, not AI output

| Column | Type | Notes |
|---|---|---|
| `country_code` | text pk | ISO-2 |
| `display_name` | text not null | |
| `consent_regime` | text | `legitimate_interest \| prior_consent_required \| opt_out_only \| unknown` |
| `requires_prior_consent` | boolean | **hard gate.** True blocks email drafting unless `consent_basis = 'consent'` |
| `regulation_names` | text[] | e.g. `{GDPR, UWG}` |
| `opt_out_required` | boolean | |
| `data_retention_note` | text | |
| `legal_source_urls` | jsonb | **required** — where each legal fact came from |
| `timezone` | text | |
| `business_hours_local` | text | so you do not call at 3am their time |
| `working_days` | text[] | e.g. Sunday–Thursday in parts of the Gulf |
| `primary_languages` | text[] | |
| `currency_code` | text | |
| `public_holidays` | jsonb | |
| `outreach_guidance` | text | professional norms: preferred channel, formality, decision cycle |
| `guidance_is_unverified` | boolean default true | the UI **always** labels it (§7.5) |
| `market_context` | text | OZZO-relevant notes |
| `updated_by` / `updated_at` | uuid / timestamptz | |

**R1 seed:** India; UK, Ireland, France, Netherlands, Spain, Italy on `legitimate_interest`;
Germany and Austria on `prior_consent_required` (the German UWG requires prior consent for
commercial email even when GDPR is satisfied).

### 6.10 Proposal workflow

#### Shared status vocabulary (D12) — changes to existing code

`src/lib/proposals/status.ts` is extended, not duplicated:

```
PROPOSAL_STATUSES = draft | in_review | approved | sent | won | lost | expired
```

- `STATUS_LABEL` and `STATUS_CLASS` gain entries for the three new states (compiler-enforced).
- `statusPatch()` gains cases: `in_review` and `approved` leave `sent_at` and `decided_at` null;
  `expired` leaves `decided_at` null, because `decided_at` drives which month a **won** deal is
  counted in and an expired proposal was never decided.
- Migration (item 2) widens `platform_proposals_status_check` to the seven values.
- **Invariant, proven by test:** every number `src/lib/proposals/forecast.ts` produces is unchanged
  by this. It filters on exact equality with `won`/`lost`/`sent`, so the new states fall through —
  an `approved` proposal is correctly not counted as sent.

#### re_proposals

Workflow state only. **Rendering stays in the existing `/admin/proposals` builder** — this table
tracks lifecycle and handoff, and does not duplicate the generator.

`id uuid pk` · `company_id uuid not null` · `deal_id uuid not null` ·
`proposal_ref uuid` (the record in the existing proposal builder) ·
`stage text not null` — typed `ProposalStatus` (D12) ·
`plan_id text` (a `PlanId`, defaulting from `best_fit_line`; **never an FSM plan in R1** — D11) ·
`users_count integer` · `billing_term text (quarterly|half_yearly|yearly)` ·
`value_inr numeric` — **from `quote()`, never hand-entered** ·
`ai_prefill jsonb` (pain points, fit reasoning, migration angle) ·
`claims_used uuid[]` (verified only) · `review_notes text` ·
`sent_at` / `sent_by` · `decision_at timestamptz` · `rejection_reason text` ·
`valid_until date` · `created_at` / `updated_at`

**The workflow, enforced as a state machine:**

```
Lead  ->  Demo  ->  Draft  ->  In review  ->  Approved  ->  Sent  ->  Won / Lost
         (brief)  (AI prefill)             (founder only) (founder only)   (writes back
                                                                            to re_deals.stage)
```

**Two different things are called "stage", deliberately.** `re_deals.stage` tracks the *deal*
(`discovery → demo → proposal → negotiation → won/lost`). `re_proposals.stage` tracks the
*document* and is typed `ProposalStatus`. They move together but are not the same vocabulary, and
no code should treat them as interchangeable.

**Rules:** a proposal can only be created from a deal at stage `demo` or later · only the founder
may move `in_review → approved → sent` · `sent` requires `approved_at` · moving to `won` sets the
deal to `won` and writes a `re_activities` row · `value_inr` is recomputed by `quote()` on every
stage change, so the proposal and the pipeline can never disagree.

### 6.11 re_activities

Every touch. In R1 these are hand-logged, or written automatically when a draft is marked sent or
a proposal stage moves; from R2 the channels write here too.

`id uuid pk` · `company_id uuid not null` · `contact_id uuid` · `owner_id uuid not null` ·
`type text (call|whatsapp|email|meeting|note|status_change|proposal_event)` ·
`direction text (outbound|inbound)` · `subject` / `body text` ·
`outcome text (connected|no_answer|not_interested|interested|callback|wrong_number)` ·
`occurred_at timestamptz not null` · `external_ref text` · `created_at`

### 6.12 re_deals

`id uuid pk` · `company_id uuid not null` · `title text` ·
`plan_id text` (a `PlanId`, defaults from `best_fit_line`; **never FSM in R1**) ·
`users_count integer` · `billing_term text` ·
`value_inr numeric` — **computed by `quote()` in `src/lib/plans/pricing.ts`, never hand-entered** ·
`stage text (discovery|demo|proposal|negotiation|won|lost)` · `probability integer` ·
`expected_close date` · `lost_reason text` ·
`competitor_lost_to text → re_battlecards.competitor_key` (so losses feed the battlecards) ·
`owner_id uuid not null` · `created_at` / `updated_at`

### 6.13 re_suppressions

Global do-not-contact. Built in R1 even though nothing sends, so that when someone says no during
a manual call they are off every future list permanently.

`channel text (email|phone|whatsapp|domain|all)` · `value text` (normalised, unique with channel) ·
`reason text (opt_out|bounce|complaint|competitor|existing_customer|manual)` · `note text` ·
`created_by` · `created_at`

### 6.14 Config tables

**re_source_configs:** `adapter_key text unique` · `display_name` · `is_enabled boolean` ·
`credentials_ref text` (**env var name — never the secret itself**) · `default_params jsonb` ·
`monthly_cap_units integer` · `monthly_cap_usd numeric` · `apify_actor_id text`

**re_source_runs:** `adapter_key` · `params jsonb` · `records_found` · `records_new` ·
`records_duplicate` · `records_rejected` · `units_used` · `cost_usd` · `status` · `error` ·
`started_at` · `finished_at` · `created_by`

**re_channel_configs** — the Channel Provider boundary (D8):
`id uuid pk` · `channel text (email|whatsapp|sms)` ·
`provider_key text (manual|smartlead|instantly|meta_whatsapp)` ·
`is_enabled boolean default false` (except `manual`) · `credentials_ref text` (env var name only) ·
`config jsonb` · `daily_cap integer` · `monthly_cap_usd numeric` · `created_at` / `updated_at`

```
ChannelProvider.send(draft) -> { external_ref, status }
  manual         (R1, always available, no credentials — you send, we record)
  smartlead      (R2, optional)
  instantly      (R2, optional)
  meta_whatsapp  (R3, optional, templates only — §7.6)
```

The `manual` provider is not a stub: it marks the draft sent, writes the activity, and advances
Priority. **Nothing in R1 depends on a paid provider existing.**

**R1 seed:** only `import`, `inbound` and `manual` enabled. Caps seeded for R2: Places 900
lookups/month (under the ~1,000 free tier), Apify $25/month, MCA unlimited.

**AI budget:** a `$100/month` ceiling (F4), checked before each batch submission and each live
run. A run that would cross it fails before the first external call.

### 6.15 Migrations

| File | Contents |
|---|---|
| `20261002120000_revenue_engine_core.sql` | `re_operators`, `re_companies` (incl. the `best_fit_line` CHECK excluding `fsm`), `re_contacts`, indexes, `updated_at` triggers, `re_can_read()` / `re_is_founder()` helpers, RLS |
| `20261002120100_revenue_engine_research.sql` | `re_research_runs`, `re_research_claims` (closed claim-key check per §6.6), the `is_verified` generated column |
| `20261002120150_revenue_engine_scoring.sql` | `re_fit_scores`, `re_priority_scores`, denormalisation triggers onto `re_companies` |
| `20261002120200_revenue_engine_generation.sql` | `re_outreach_drafts`, `re_meeting_briefs`, `re_migration_pitches`, verified-claims-only constraint, narrowed service-role grants |
| `20261002120250_revenue_engine_intelligence.sql` | `re_battlecards`, `re_country_profiles` — AI explicitly denied write access; seeds **12** competitors and the R1 country list |
| `20261002120300_revenue_engine_pipeline.sql` | `re_activities`, `re_deals`, `re_proposals` + the stage state machine, `re_suppressions` |
| `20261002120400_revenue_engine_config.sql` | `re_source_configs`, `re_source_runs`, `re_channel_configs`, cap-check function, seed rows |
| `20261002120500_widen_platform_proposals_status.sql` | **New (§2.3).** Widens `platform_proposals_status_check` to the seven shared statuses. Touches a live table — rollback note mandatory. |
| `ROLLBACK-revenue-engine.md` | Matching rollback notes, as every other module in this repo has |

---

## 7. AI architecture

### 7.1 Model and cost

The repo already has an Anthropic client at `src/lib/ozzo/claude.ts` using `claude-sonnet-5`. The
Revenue Engine adds a **second, separate client** — it must not share ASK OZZO's prompt or rate
budget.

**Model: `claude-opus-5-5`** ($4/MTok input, $20/MTok output) — founder-confirmed (F4).

Estimated per company: ~30K input tokens (3–5 fetched pages) + 2K output.

| Setup | Per company | 1,000 companies/month |
|---|---|---|
| Opus 5.5, live | ~$0.16 | ~$160 |
| **Opus 5.5 via Batch API (50% off)** | **~$0.08** | **~$80** |
| Sonnet 5.5 via Batch API | ~$0.04 | ~$40 |

Research runs as an **overnight Batch job**. Research is never latency-sensitive — it is read the
next morning, and the Batch API halves the bill for free. A "Research now" button exists for
single companies and uses a live streaming call. At the $100 cap, that is roughly 1,200 companies
a month.

`re_research_runs.model` is per-row, so nothing depends on the choice. Measure the
claim-verification rate for a month; step down only if the cheaper model holds it.

### 7.2 How the Research Agent works

```
  company (name + website + MCA facts)
            |
      [1] web_search_20260209   -- find the site if we only have a name
      [2] web_fetch_20260209    -- homepage, about, products, dealers, service, contact
            |  max_content_tokens caps the spend per page
      [3] one Claude call, structured output, strict closed-key schema (§6.6)
            |
      [4] every claim must carry evidence_url + evidence_quote, or be returned null
            |
      [5] write re_research_runs (immutable) + re_research_claims
      [6] Fit scoring reads ONLY claims where is_verified = true
```

1. Anthropic's server-side `web_fetch` does the reading — no scraper to build, and
   `max_content_tokens` caps per-page cost. `web_fetch` only fetches URLs already in the
   conversation, so the website is always passed explicitly.
2. Structured output with a strict schema, validated before anything is written. A malformed
   response or an unknown claim key **fails the run**; it never writes a partial record.
3. The prompt instructs the model that a claim without a supporting quote must be returned with
   `evidence_url: null` rather than omitted or invented. Being allowed to say "I am guessing" is
   what stops it guessing silently.
4. `prompt_version` is stored on every run, so old research stays interpretable when the prompt
   changes.

### 7.3 Prompt caching — and an honest limit

Caching is a prefix match: tools → system → messages. The stable prefix is the OZZO fit rules and
claim schema (~4K tokens), behind a `cache_control` breakpoint.

**Be realistic: caching saves little on this workload.** Most tokens are each company's own fetched
pages, unique every time, so there is nothing to reuse. Caching the 4K prefix saves about $0.015
per company — real, but not the lever. **The Batch API is the lever (50%);** `max_content_tokens`
is second. Verify with `usage.cache_read_input_tokens` — if it is zero across repeated runs,
something volatile has leaked into the prefix.

### 7.4 Guardrails

| Risk | Control |
|---|---|
| Invented facts about a prospect | The evidence-or-flag rule; unverified claims excluded from scoring and every generator |
| Invented facts about a competitor | D10 — the AI cannot write `re_battlecards`, enforced by `GRANT`. Only approved cards reach a generator. |
| A competitor's price stated wrongly | D13 — `pricing_notes` records positioning only; no figure is ever stored or generated |
| Pitching unbuilt, unpriced software | D11 — `fsm` excluded from `best_fit_line` in both the CHECK constraint and the scoring function |
| Unverifiable cultural claims | §7.5 — guidance fields labelled unverified; only the legal fields are enforced |
| Runaway spend | Source and channel monthly caps; the $100 AI budget checked before each batch; `max_content_tokens` per fetch |
| AI writing business records | Service-role `GRANT` limited to the seven research / score / draft tables (§5) |
| Prompt injection from a prospect's website | Fetched page content is **data, never instruction**. The system prompt states that page text cannot change the task, and the output schema is strict, so an injected instruction has nowhere to land. |
| Model refusal | `status = 'refused'` is a first-class outcome, surfaced in the UI, not retried in a loop |
| Silent model drift | `model` + `prompt_version` + `effort` on every run; a weekly verification rate on the Spend screen |

### 7.5 Why country guidance is labelled, not enforced

The request for country profiles including "communication style and market context" splits in two,
and the split matters:

- **The legal and operational half is factual and checkable** — consent regime, whether prior
  consent is required, time zone, business hours, working days, language, currency, holidays. Each
  carries `legal_source_urls`. **The engine enforces these:** `requires_prior_consent = true` is a
  hard gate that blocks email drafting, not a tip.
- **The "communication style" half has no evidence URL.** There is no page to quote for "Germans
  prefer formal email." An AI asked to produce it generates confident generalisations about
  nationalities — which is both the invented-fact problem the evidence rule exists to prevent, and
  a stereotyping risk.

So `outreach_guidance` and `market_context` exist as requested, are founder-editable, default to
`guidance_is_unverified = true`, are **always** labelled unverified in the UI, and are **never**
inputs to a score or a gate. Guidance stays on professional norms (preferred channel, formality of
address, typical decision cycle), not cultural claims.

### 7.6 One constraint on generated WhatsApp messages

A generated WhatsApp draft is **free text for manual sending. It is not a Meta-approved template.**
Outside the 24-hour customer-service window, the Cloud API requires a pre-approved template with
variables, not free text.

Fine for R1 — the founder copies and sends. But **R3 cannot simply automate these drafts**: they
must be restructured as approved templates with variable slots and submitted for Meta review.
Recorded now so nobody assumes R1's output is R3-ready. The existing `src/lib/whatsapp/template-*`
code already handles template structure and the approval lifecycle, so this is known, bounded work.

### 7.7 The agents in Release 1

All of them share one hard rule: **they read only claims where `is_verified = true`.**

| Agent | Runs | Reads | Writes | Cost |
|---|---|---|---|---|
| Research Agent | Overnight batch, per new company | `web_search` + `web_fetch` | runs + claims | ~$0.08 / company |
| Fit Scoring | After every research run | verified claims + MCA fields | `re_fit_scores` | $0 — no LLM |
| Priority Scoring | Nightly + after every activity | activities, follow-ups, fit, inbound | `re_priority_scores` | $0 — no LLM |
| Outreach Generator | On demand | verified claims + `best_fit_line` + suppressions + country profile | `re_outreach_drafts` | ~$0.02 / set of 4 |
| Migration Pitch | On demand, when `existing_software` known | verified claims + **approved** battlecard | `re_migration_pitches` | ~$0.02 |
| Meeting Brief | On demand, before a meeting | verified claims + activity history + battlecard | `re_meeting_briefs` | ~$0.02 |
| Proposal Prefill | On demand, from a deal at `demo`+ | verified claims + fit + plan + `quote()` | `re_proposals.ai_prefill` | ~$0.01 |

Generator cost is small: they run on demand per company actually worked, and far fewer companies
are worked than researched. **Research remains the bulk of the bill.**

---

## 8. Navigation

Routes sit under `/admin/revenue/*`, in the founder-only nav group in
`src/app/(superadmin)/admin/admin-shell.tsx`. **Nav label: "Prospects"** (§1).

| Module | Path | Screen |
|---|---|---|
| Revenue Command Center | `/admin/revenue` | The cockpit — founder landing page |
| Prospect Hub | `/admin/revenue/companies` | List: filter by priority band, fit line, status, owner, country, city, dealer count, incumbent, source |
| Prospect Hub | `/admin/revenue/companies/[id]` | Company detail — seven tabs |
| Prospect Hub | `/admin/revenue/companies/import` | Spreadsheet import (Universal Import Framework) |
| Outreach Studio | `/admin/revenue/companies/[id]/outreach` | Generate and edit the 4 channel drafts |
| Outreach Studio | `/admin/revenue/companies/[id]/brief` | Meeting brief |
| Pipeline | `/admin/revenue/pipeline` | Deals by stage, value from `quote()` |
| Pipeline | `/admin/revenue/proposals` | Proposal board — draft / review / approved / sent / decided |
| Pipeline | `/admin/revenue/suppressions` | Do-not-contact list |
| Campaign Center | `/admin/revenue/battlecards` | Competitor battlecards, founder-authored |
| Research Agent | `/admin/revenue/countries` | Country profiles and consent regimes |
| Research Agent | `/admin/revenue/sources` | Adapters, caps, run history (read-only in R1) |
| Research Agent | `/admin/revenue/channels` | Channel providers (read-only in R1) |
| Research Agent | `/admin/revenue/spend` | AI + API spend, claim-verification rate |

**Company detail, seven tabs:** Facts (verified claims with quotes; guesses separated below and
muted) · Fit (four scores with reasons, FSM shown but flagged not-sellable) · Contacts · Outreach
(drafts, plus the migration pitch when an incumbent is known) · Timeline · Deal · Proposal.

### The cockpit

`/admin/revenue` is the operational screen, not a vanity dashboard. Six blocks, in this order:

1. **Today's calls** — `priority_band = 'today'`, ranked, each showing *why* it is there (from
   `re_priority_scores.components`), the best sellable fit line, and the incumbent if known.
2. **Needs a decision** — proposals in `in_review`, deals stalled past expected close, drafts
   generated but never approved.
3. **Overnight results** — research finished, new scores, newly qualified companies, anything
   refused or failed.
4. **Follow-ups due** — from `re_activities`, in account-local time.
5. **Pipeline snapshot** — value by stage from `quote()`, win/loss this month, losses by competitor.
6. **Health** — AI spend against the $100 budget, source caps remaining, claim-verification rate,
   suppression adds this week.

Every block links straight into the action.

### The landing-page change — the only R1 item reaching outside /admin

Post-login landing today is `/dashboard` for every user. Making `/admin/revenue` the landing page
is a **founder-only** redirect, gated on the same founder check, and it must not change where
anybody else lands. It gets:

- a redirect only when the signed-in email passes the founder check,
- a one-click "go to my CRM dashboard" link so the normal app is never more than one click away,
- **a test asserting that a non-founder user still lands on `/dashboard`.**

### 8.1 User journeys — the acceptance walkthrough

These are what "done" is demonstrated against (§11). Carried from the source PRD so this spec
stands alone.

| # | Journey | Success condition |
|---|---|---|
| J1 | **Morning cockpit.** Founder logs in, lands on `/admin/revenue`, Today's calls ranked with reasons. | Under 60 seconds from login to dialling. |
| J2 | **Bring in a list.** Upload a spreadsheet, map columns; the engine normalises, computes `dedup_key`, rejects duplicates and suppressed rows, and **reports a reason for every rejected row** (the existing import-failure-reasons pattern). | Accepted rows land `status = new` and queue for overnight research. |
| J3 | **Research runs overnight.** The nightly job takes every `status = new` company with a website and submits one Batch request. | Morning: `researching → qualified`, with Fit and Priority. Failures and refusals are visible, never silent. |
| J4 | **Judge a company, know what to pitch.** Facts tab shows verified claims each with its quote and source link; guesses sit below, greyed, labelled unverified. Fit tab shows four scores with reasons. | No number appears without a source. An FSM-dominant company still shows a sellable pitch line (D11). |
| J5 | **Generate the outreach.** One click → four drafts (WhatsApp, email, call script, LinkedIn) pitching `best_fit_line` and citing only verified claims, each listing the claims it used. | Founder edits (stored separately from the AI original), copies out, sends personally. Marking sent writes an activity and updates Priority. A suppressed contact cannot be drafted for; a prior-consent country blocks the email draft. |
| J6 | **Beat the incumbent.** `existing_software = FieldAssist` → "Generate migration pitch" composes from the approved FieldAssist battlecard plus this company's verified pain points. | If the battlecard is not approved, the button is disabled — the engine will not improvise about a competitor. |
| J7 | **First contact, by hand.** Founder calls using the generated script, logs an activity with an outcome. | Suppression status is shown *before* the call. Interested → `status = working`, follow-up set. |
| J8 | **Prepare for the demo.** One click generates the brief: company in three lines, pain points with evidence, likely objections (incumbent ones from the battlecard), demo flow ordered by `best_fit_line`, discovery questions. | Readable in two minutes. Verified claims only. |
| J9 | **Someone says no.** Outcome `not_interested` prompts a one-click suppression add. | That phone, email and domain are off every future list permanently, and the generator refuses to draft for them. |
| J10 | **Proposal as a tracked workflow.** From a deal at `demo`+: generate draft. `plan_id` defaults from `best_fit_line`, `value_inr` from `quote()`, AI prefills pain points and migration angle from verified claims. | Moves `draft → in_review → approved → sent`, founder-only past review. Rendering stays in the existing `/admin/proposals` builder. `won` sets the deal won; `lost` records a reason and feeds `competitor_lost_to` back to the battlecards. |
| J11 | **Selling into a new country.** A German company opens; the country panel shows prior consent required (UWG) *before anything else*. | Email drafting blocked unless `consent_basis = 'consent'`. Business hours, language and currency shown. Outreach guidance clearly labelled unverified. |
| J12 | **Weekly review.** `/admin/revenue/spend`: companies added / researched / qualified, activities, pipeline value, losses by competitor, AI spend against the $100 budget, claim-verification rate. | The verification rate is the health metric for the whole AI layer. |

**Later journeys, not in R1:** J13 enrol in a sequence (R3) · J14 handle an email reply and
auto-pause a sequence (R3) · J15 book a meeting with calendar links (R4) · J16 identify an inbound
visitor's company (R5).

---

## 9. Compliance and non-functional requirements

### Email — a serious, specific warning

Resend, SendGrid and Amazon SES all **prohibit cold outreach** in their terms. Resend's
acceptable-use policy requires recipient consent; SendGrid suspends cold-outreach accounts without
warning; AWS says to send only to recipients who explicitly requested mail. SES goes under review
at 5% bounces or 0.1% complaints.

**OZZO already uses Resend for ozzo.co.in mail, with Supabase custom SMTP — the same path that
sends password resets and auth mail for every tenant.** If cold outreach went through it and the
account were suspended, password reset breaks for all customers. That is a production outage
caused by a marketing decision.

Therefore, non-negotiably, **when sending is enabled (R2, optional):**

- A separate sending domain (e.g. `ozzocrm.in`), never `ozzo.co.in`.
- A separate provider built for outreach — Smartlead (~$39/mo) or Instantly (~$47/mo), **not**
  Resend/SendGrid/SES.
- Separate mailboxes: 2–3 per domain, each capped at 30–50 emails/day
  (`re_channel_configs.daily_cap`), with a 14–21 day warm-up before the first real send. Google's
  technical limit is 2,000/day; exceeding ~50 cold sends per mailbox damages reputation regardless.
- `re_email_identities` records which domain and mailbox each message used, so a reputation problem
  traces to one identity and is isolated.

**D8 makes all of this optional. Nothing in R1 depends on it.**

### Data protection

- **EU:** B2B cold email is lawful under GDPR legitimate interest (Art. 6(1)(f)) when the recipient
  is a business, the message is relevant to their role, opt-out is simple, and the
  legitimate-interest assessment is documented. `re_contacts.consent_basis` records the basis per
  contact; `re_country_profiles.legal_source_urls` holds the assessment per country.
- **Germany and Austria** require prior consent under the German UWG even with GDPR satisfied.
  **Enforced in code, not documented:** `requires_prior_consent = true` blocks email drafting.
- **India (DPDP Act):** suppression and opt-out plumbing exist from R1.
- **Terms of service:** using Apify does not transfer the breach. A5/A6/A7 are a commercial-risk
  decision the founder takes knowingly in R2 (O9), recorded rather than buried.
- **Competitor claims:** D10 and D13 keep every factual claim about a competitor founder-authored
  and sourced, and keep their prices out entirely. As much a legal control as an accuracy one.

### Other non-functional requirements

| Area | Requirement |
|---|---|
| Security | `requireFounder()` on every route; RLS on every table; **no secret in the database** — `credentials_ref` holds the env var name only |
| Tenant isolation | No `re_*` table references a tenant table; no tenant query touches `re_*`. **Verified by a test.** |
| Landing-page safety | A test asserts a non-founder user still lands on `/dashboard` |
| Dates | All grouping converts `timestamptz` to the account timezone (IST). **Never `toISOString()`.** |
| Retention | Prospect data kept while active; research runs 2 years; source-run logs 90 days — matching `src/lib/retention` |
| Cost ceiling | Hard monthly caps per source adapter and channel provider, plus the $100 AI budget, **enforced before the external call** |
| Honesty rules | The repo's absolute rules apply: no fabricated stubs, no generated reports asserting results that were not measured, no `any` without a justifying comment |

---

## 10. Required tests

Vitest, `src/**/*.test.ts` only (`*.spec.ts` is **not** picked up).

1. `dedup_key` computation — domain preferred, `slug(name) + city` fallback
2. Suppression check blocks a suppressed contact
3. Cap enforcement — a run that would cross a cap fails **before** the external call
4. Fit computation from verified claims
5. **D11: an FSM-dominant company returns a non-FSM `best_fit_line`**
6. **D11: no generator produces an FSM pitch, and no deal or proposal defaults to an FSM plan**
7. Priority computation — each component, and the decay floor at 0
8. The evidence-or-flag rule — unverified claims excluded from scoring and all generators
9. Claim-schema validation — an unknown claim key fails the run and writes nothing
10. Generators refuse unverified claims
11. Generators refuse suppressed contacts
12. Email drafting blocked for a `requires_prior_consent` country unless `consent_basis = 'consent'`
13. Generators refuse an unapproved battlecard
14. **D13: no battlecard field accepts or emits a competitor price figure**
15. Proposal state machine — `sent` requires `approved_at`; only founder may approve or send
16. **D12: every existing forecast number is unchanged by the three new statuses**
17. **D12: `statusPatch()` leaves `sent_at`/`decided_at` null for `in_review`, `approved`, `expired`**
18. Non-founder lands on `/dashboard` (landing-page safety)
19. Tenant isolation — no `re_*` table references a tenant table
20. Account-local date grouping — a touch logged at 23:30 IST groups into that IST day, not the
    next UTC day (the DSR "0 visits" bug, asserted rather than hoped for)

---

## 11. Acceptance criteria — Definition of Done

| Category | Criteria |
|---|---|
| **Functional** | All 18 items in §4 complete. Journeys J1–J12 (§8.1) demonstrable on screen. |
| **Code Quality** | `tsc` 0 errors repo-wide. No `any` without a justifying comment. Files focused — no single file doing the work of three. |
| **Architecture** | Source Adapter and Channel Provider boundaries respected: adding a source or provider is a config row plus a parser, never an engine change. One pricing engine (`quote()`), one proposal status vocabulary, one claim schema. |
| **Testing** | All 20 tests in §10 passing, written test-first. |
| **Security** | `requireFounder()` on every route, verified by reading each one. RLS on every `re_*` table. Service-role `GRANT` limited to the seven research/score/draft tables — verified by attempting a battlecard write as the service role and getting a permission error. No secret in any table. |
| **Performance** | Prospect Hub list paginated and indexed per §6.2 — no full-table scan on the filter set. Research runs batched, never blocking a page load. |
| **Documentation** | This spec updated with a build note. `ROLLBACK-revenue-engine.md` written. `PROJECT.md` updated if any new convention emerges. |
| **Production Readiness** | Migrations dry-run validated, then applied to Mumbai prod. Committed and pushed **directly to `main`** (never a branch — Vercel deploys `main`). Commit hash recorded here. `ANTHROPIC_API_KEY` provisioned, or the graceful-error path verified. |

---

## 12. Open items

| # | Item | Needed by | Status |
|---|---|---|---|
| O1 | `ANTHROPIC_API_KEY` in server env (`.env.local` + Vercel) | **R1 — blocking the Research Agent** | **OPEN — founder action.** Also unblocks ASK OZZO, which has been live-blocked on it since 2026-08-30. |
| O2 | Monthly AI budget ceiling | R1 | **CLOSED — $100/month (F4)** |
| O3 | Model | R1 | **CLOSED — `claude-opus-5-5` (F4)** |
| O4 | Competitors to seed | R1 | **CLOSED — all 12 from ozzo-site (F5)** |
| O5 | Countries to seed | R1 | **CLOSED — India + 8 EU (§1), overridable** |
| O6 | Sending domain to buy | R2, optional | Open. A close variant such as `ozzocrm.in` — never `ozzo.co.in`. |
| O7 | Smartlead or Instantly | R2, optional | Open. Smartlead is cheaper at low volume. |
| O8 | Apify budget | R2 | Open. $25/month cap to start. |
| O9 | Accept the ToS risk on A5/A6/A7 | R2 | Open. Needs an explicit yes or no in writing. |
| O10 | When SDRs get access | R3 | Open. The schema is ready; it is a decision, not work. |

---

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **R1 is one 7–8 week block and ships nothing until the end** | **High** | Accepted by the founder (F1) against the recommendation to split. Mitigated only by build order: migrations and the Research Agent land first, so the engine is visibly working long before it is "done". This risk is live and recorded. |
| Cold email suspends the Resend account and breaks tenant password resets | High | Separate domain + separate provider, mandatory when sending is enabled (§9); D8 makes sending optional, so the whole risk class is opt-in |
| AI invents facts about a prospect | High | Evidence-or-flag rule; unverified claims excluded from every generator; verification rate tracked weekly |
| AI invents facts about a competitor | High | D10 — founder-authored battlecards only, AI write access revoked at the `GRANT` level, unapproved cards unusable |
| A competitor's price stated wrongly | Medium | D13 — no price figure is stored or generated at all |
| Quoting an unapproved FSM price for unbuilt software | Medium | D11 — `fsm` excluded from `best_fit_line` in both the CHECK constraint and the scoring function, with two tests |
| Widening the live proposal status constraint breaks the forecast | Medium | Verified safe: `forecast.ts` filters on exact equality. Test 16 locks it. |
| Compliance accident on an EU contact | Medium | `requires_prior_consent` enforced in code, not documentation; Germany and Austria blocked by default |
| Landing-page change affects tenants | Medium | Founder-gated redirect plus an explicit test that non-founders still land on `/dashboard` |
| Scope creep back toward all 15 phases at once | Medium | This document and the §4 freeze |
| Fifth unfinished front — FSM still has nothing built | Medium | D1 keeps this founder-only: no pricing, onboarding, support or mobile burden. D11 turns the FSM claim keys into demand discovery for that line rather than a sales promise. |
| WABA number banned by cold WhatsApp | Low, if respected | WhatsApp is follow-up only |

---

## 14. Later releases — named and ordered, not specified

- **R2 — Real data sources + optional sending.** MCA adapter (A3, free), Google Places (A4) with
  caps, Apify (A5/A6/A7) per-actor; then optionally the sending domain, provider, mailboxes,
  warm-up, `re_email_identities` / `_messages` / `_events`, and email verification. ~4 weeks, plus
  2–3 weeks of warm-up waiting in parallel.
- **R3 — Sequences and campaigns.** Sequence builder over the existing automations engine; email +
  WhatsApp campaigns (WhatsApp follow-up only, templates per §7.6); reply detection auto-pausing a
  sequence; campaign analytics on the existing report engine. ~4 weeks.
- **R4 — Meeting booking and coach.** Calendar links, demo scheduling, auto-reminders; sales coach
  over verified claims and approved battlecards. ~2 weeks.
- **R5 — Website intelligence.** Analytics and lead capture — not visitor identification. ~1.5 weeks.
- **R6 — Content Studio.** Campaign, LinkedIn, blog and case-study drafting, founder review before
  anything publishes. ~2 weeks.

**Later-release tables, named now, not built:** `re_sequences`, `re_sequence_steps`,
`re_enrollments` (R3) · `re_email_identities`, `re_email_messages`, `re_email_events` (R2) ·
`re_campaigns` (R3) · `re_meetings` (R4) · `re_web_sessions` (R5) · `re_content_assets` (R6).

---

## 15. Review log

**Revision 2 — 2026-10-02, founder review.** Five changes, all accepted: AI Outreach Generator in
R1; proposal draft in R1; meeting brief moved up from R4 (booking stayed); OZZO Fit Score promoted
to four first-class scores; distribution and territory intelligence as a closed claim-key list
built for agri/pumps/manufacturing rather than headcount. R1 moved 3–4 → 5–6 weeks.

**Revision 3 — 2026-10-02, founder review; architecture approved in principle.** Six additions,
all accepted: proposal generation as a first-class workflow; competitor intelligence moved to R1;
Fit separated from Priority; Command Center as cockpit and landing page; international market
intelligence; sending infrastructure made optional and modular (D8). R1 moved 5–6 → 7–8 weeks.

**Revision 4 — 2026-10-02, code audit + scope freeze. This document.**

Audited Revision 3's claims against the codebase. Eight claims verified correct; five findings wrong or
missing (§2), three of which changed the schema. Five founder rulings taken (§1): R1 stays one
block; FSM is scored but never pitched or quoted (D11); one shared proposal status vocabulary
(D12); $100/month on Opus 5.5; all 12 battlecards rather than 4. Two routine calls: nav label
"Prospects", and the India + 8 EU country seed. One new guardrail from the marketing site's own
honesty contract: a competitor's price is never recorded or generated (D13). Scope: 17 items →
18, ~49 → ~51 days.

**Scope is frozen. Next step: the Release 1 implementation plan, for approval before any code.**
