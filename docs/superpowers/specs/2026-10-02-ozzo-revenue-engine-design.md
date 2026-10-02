# OZZO Revenue Engine — Product Requirements & Architecture

**Status:** Draft for founder approval — no code to be written until approved
**Date:** 2026-10-02
**Owner:** Sumit Vegad (founder)
**Contents:** PRD · database schema · permissions matrix · navigation · user journeys · AI architecture · implementation roadmap

---

## 0. Read this first — what this is, and what it is not

The original brief described a 15-phase "AI-Powered Revenue Operating System". After auditing the codebase, the honest framing is different, and it is better news:

**A large part of it is already built and running inside OZZO CRM.** The Revenue Engine is not a new product. It is *OZZO pointed at itself*, plus two genuinely new things — an AI research layer and an email channel.

### Already built and live in `wacrm-web`

| Brief phase | What already exists |
|---|---|
| 1. Lead Intelligence Hub | `leads`, `contacts`, activities, custom fields, attachments, import |
| 5. WhatsApp Campaigns | `broadcasts` + Meta Cloud API templates (`src/lib/whatsapp/`) + `inbox` |
| 6. Sales Sequences | the automations engine — step trees, condition eval, event worker (`src/lib/automations/`) |
| 10. Pipeline | `deals` + `pipelines` with stages, plus `/admin/forecast` |
| 11. Campaign Analytics | broadcast status + the 10-report engine (`src/lib/reports/`) |
| 2 / 9 / 13. AI | the Claude client and RAG behind ASK OZZO (`src/lib/ozzo/`) |
| 14. Competitor Intelligence | the 12 `/compare` pages on ozzo.co.in (content, not a module) |

### Genuinely not built

Email channel (there is **no** Resend, SendGrid, SES or nodemailer dependency in `package.json` — email today is only Supabase auth SMTP), AI Research Agent, Lead Scoring, Prospect Discovery, Meeting Booking, Demo Prep, Sales Coach, Website Intelligence, Content Studio.

### Why this does not spec all 15 phases as one build

Fifteen phases as written is roughly 8–12 months. A single approved spec that large does not survive contact with reality — it gets renegotiated weekly until the approval means nothing. So:

- **The architecture below covers the whole engine**, so nothing gets painted into a corner.
- **Only Release 1 is specified to build-ready depth.** Later releases are named, ordered and sized — the same way `OZZO_SFA_FUTURE_MODULES.xlsx` works today.

---

## 1. Settled decisions

Decided in the brainstorming session on 2026-10-02. If one of these is wrong, change it here first — the rest of the document depends on them.

| # | Decision | Consequence |
|---|---|---|
| D1 | **Founder-only internal tool**, inside `/admin` | No plan gating, no rights registry, no mobile work, no support burden. If it is ever sold, most of it is a rewrite — accepted. |
| D2 | **Operator concept in the schema from day one** | Every company, activity and deal carries `owner_id`. Adding 2–3 telecallers later is granting access, not a migration. |
| D3 | **Source Adapter boundary** — 7 adapters documented, 1 built in R1 | The data-source question never blocks the rest of the engine. |
| D4 | **Database + AI brain first; generate messages in R1, send them later** | R1 researches, scores **and writes the outreach** — WhatsApp, email, call script, LinkedIn — which you send by hand. No automated sending and no deliverability infrastructure in R1. *Generation* carries none of sending's cost: no domain, no provider, no warm-up, no Meta policy. |
| D5 | **Spend caps live in the database**, not in code comments | A bug cannot run up a Google or Anthropic bill. |
| D6 | **No LinkedIn adapter. No CAPTCHA or bot-detection bypass, ever.** | Some directories are simply not viable. Written down now rather than discovered later. |
| D7 | **`re_*` tables are fully separate from tenant tables** | Nothing here can touch `contacts`, `leads`, `deals` or any customer's data. This is the main payoff of D1. |

### Two constraints that shaped everything

**AI cannot generate a prospect list.** A language model asked for "FMCG distributors in Gujarat with decision makers" produces plausible company names, titles and phone numbers that do not exist. It has no directory inside it. AiSDR's own site claims 700M contacts, never states a source, and gives 300M+ in one place and 700M+ in another — which means the number is marketing, not a spec. What sits behind a database like that is a data-operations business: licensing, contributory networks, bulk purchase, and a team that cleans it. **The AI is the writing and reasoning layer. It is never the collection layer.**

**Cold WhatsApp is a bad first touch.** Messaging businesses that never opted in violates Meta policy and risks the WABA number and its quality rating. WhatsApp is excellent for follow-up *after* a conversation starts, so the engine treats it as a follow-up channel only.

---

## 2. Goals and non-goals

### Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | One place holding every OZZO prospect, no duplicates | Duplicate rate under 2% on `re_companies.dedup_key` |
| G2 | Know which prospects deserve time, before spending it | Every company has a score with visible reasons |
| G3 | Never pitch on an invented fact | 100% of displayed claims carry an evidence URL, or are visibly labelled a guess |
| G4 | Research per company down from ~30 min to under 2 min | Founder's own timing, recorded in the activity log |
| G5 | One morning screen that says who to contact today | Revenue Command Center, R1 |
| G6 | Never contact someone who said no | `re_suppressions` checked on every outreach screen |
| G7 | Never be stuck on what to say, or which product to pitch | Every qualified company has drafted outreach plus four product-fit scores |
| G8 | Walk into every demo prepared | A meeting brief generated from verified claims — in R1 |

### Non-goals for Release 1

No automated email or WhatsApp **sending** — messages are generated in R1 and sent by hand · no meeting **booking** (calendar links and reminders are R4; the meeting *brief* is in R1) · no sales coach · no website-visitor intelligence · no content studio · no mobile surface (ever, unless D1 changes) · nothing tenant-facing — no customer sees any of this.

---

## 3. Personas and the permissions matrix

Release 1 has one user. The matrix still defines three human roles and — importantly — **the AI agent as its own principal with its own limits**, because that is where the real risk sits.

### Principals

| Principal | Exists in | Description |
|---|---|---|
| **Founder** | R1 | `sumitvegad07@gmail.com`, via the existing `requireFounder()` in `src/lib/auth/superadmin.ts` |
| **SDR** | R3+ | A telecaller or inside-sales hire; works assigned companies |
| **Agency** | R4+ | Outside freelancer; works assigned companies only, cannot see money |
| **AI Agent** | R1 | The research and scoring job, running as a service role |
| **Tenant user** | never | Any OZZO customer. No access to anything in this document. |

### Permissions matrix

| Capability | Founder | SDR | Agency | AI Agent | Tenant user |
|---|:---:|:---:|:---:|:---:|:---:|
| View all companies | yes | yes | own only | read | no |
| Create / edit company | yes | yes | own only | **no** | no |
| Disqualify / soft-delete company | yes | yes | no | no | no |
| Reassign owner | yes | no | no | no | no |
| View contacts incl. phone / email | yes | yes | own only | read | no |
| Trigger a research run | yes | yes | no | — | no |
| View research evidence | yes | yes | own only | — | no |
| **Write research claims** | **no** | no | no | **yes — only principal that can** | no |
| **Write scores** | override only | no | no | yes | no |
| View score + reasons (incl. the four fit scores) | yes | yes | own only | read | no |
| Generate outreach drafts | yes | yes | own only | yes — writes drafts | no |
| Edit / approve an outreach draft | yes | yes | own only | **no** | no |
| Generate a meeting brief | yes | yes | own only | yes — writes briefs | no |
| Log an activity | yes | yes | own only | **no** | no |
| View deal value / pipeline total | yes | yes | **hidden** | no | no |
| Create / edit deal | yes | yes | no | no | no |
| Generate a proposal draft | yes | no | no | yes — prefill only | no |
| Manage suppressions | yes | add only | add only | no | no |
| Configure source adapters + caps | yes | no | no | no | no |
| Run a source harvest | yes | no | no | no | no |
| View AI / API spend | yes | no | no | no | no |
| Export to CSV | yes | no | no | no | no |
| Any access to tenant tables | yes, via existing `/admin` | no | no | no | n/a |

### The three rules this matrix encodes

1. **The AI agent can never write a business record — only evidence and drafts.** It writes to `re_research_runs`, `re_research_claims`, `re_scores`, `re_outreach_drafts` and `re_meeting_briefs`. It cannot create a company, edit a contact, move a deal, or send anything. Drafts and briefs are explicitly *drafts*: a human reads and approves before use, and `approved_at` records that. If the model hallucinates, the damage is confined to a row clearly labelled AI output that nobody has yet acted on.
2. **The founder cannot write a research claim.** Claims are machine-authored and evidence-bearing. A human who disagrees adds a score *override* or a company note — the claim history stays honest.
3. **Money is a separate permission from data.** The Agency role sees companies and logs calls, but `value_inr` and the pipeline screen are hidden — enforced in RLS through a restricted view, not by hiding a button.

### Enforcement

- **Route level:** `requireFounder()` on every `/admin/revenue/*` page, exactly as `/admin/proposals` does today.
- **Database level:** RLS on every `re_*` table, via two policy shapes:
  - **Owned tables** (`re_companies`, `re_contacts`, `re_activities`, `re_deals`, and the research/score tables through their company) use `public.re_can_read(owner_id)`. In R1 that helper resolves to "is the founder", so the policy is already correct when SDR rows arrive in R3.
  - **Founder-only tables** (`re_operators`, `re_suppressions`, `re_source_configs`, `re_source_runs`) have no `owner_id` and use `public.re_is_founder()` directly. `re_suppressions` gains an insert-only policy for SDR and Agency in R3, matching the matrix above.
- **Service role:** the AI job uses the service-role key but is narrowed by `GRANT` to `INSERT` on the three research/score tables only — no blanket service-role access.

---

## 4. Data source adapters

Every adapter implements one interface and writes through one funnel, so a new source is a config entry plus a parser — never a change to the engine.

```
SourceAdapter.search(params) -> RawRecord[]
                                    |
                      normalise -> dedupe (dedup_key) -> suppression check
                                    |
                          re_companies + re_contacts + re_source_runs
```

Every record keeps `source_adapter`, `source_ref`, `source_url` and `last_refreshed_at`. You can always answer "where did this come from and how old is it".

### The seven adapters, with honest assessments

| # | Adapter | Gives you | Real cost | Risk / verdict |
|---|---|---|---|---|
| A1 | **Spreadsheet import** | Whatever you have | Free | None. **Built in R1.** Reuses the Universal Import Framework. |
| A2 | **Inbound web forms** | ozzo.co.in exit-intent popup + contact forms | Free | None. **Built in R1.** Highest-quality leads, lowest volume. |
| A3 | **MCA via data.gov.in** | CIN, legal name, ROC, **paid-up capital**, status, NIC industry code, registered address, directors | **Free** (official Open Government Data API) | Lowest risk of all. Public-record data, official API, no scraping. **Best ICP-scoring source you can get** — paid-up capital is a real size signal instead of a guess. No emails. |
| A4 | **Google Places API** | Business name, address, **phone**, website, category, by city + category | ~1,000 companies/month free, then up to $40/1,000 | Legal paid API. **This is where contactable data actually comes from.** |
| A5 | **IndiaMART + TradeIndia** | Company name, city, product categories, sometimes GST | Via Apify, ~$3.50–$45 per 1,000 records | **Emails and mobile numbers are gated behind their buyer login and are not publicly scrapable.** You get names and cities, not contactable leads. Rate-limited (HTTP 429 from cloud IPs). Terms prohibit scraping. Useful for *discovering names by product category*, then enriching via A4. |
| A6 | **JustDial** | Local business listings | Via Apify | Actively blocks. Terms breach. Lowest value of the set. **Recommend last, or not at all.** |
| A7 | **Europages + Kompass** | EU/global suppliers — name, phone, email, VAT, employees, country | Via Apify, ~$3.50–$45 per 1,000 | Needed for the international-sales goal. **GDPR applies the moment you email them** (see §9). Kompass has no public bulk API. |

### Do not build the scrapers — call maintained ones

**Finding:** Apify already hosts maintained, pay-per-result actors for IndiaMART, TradeIndia, JustDial, Europages, Kompass and the MCA registry, at roughly **$3.50–$45 per 1,000 results**.

**Therefore A5, A6 and A7 are a single adapter** — `apify` — with a per-actor config row. Apify maintains the parsers, handles proxies and blocking, and we call an HTTP API. That gives you every directory you asked for, at cents per lead, with **zero scraper maintenance on our side and no CAPTCHA work** (which D6 forbids anyway).

Honest caveats, recorded so they are not a surprise later:

- Apify actors are third-party. Quality varies between actors and they can break; the adapter must handle a bad run without corrupting the database.
- **Legal responsibility for using the data stays with OZZO** — Apify running the scraper does not transfer the terms breach or the GDPR duty.
- It does not defeat login gating. IndiaMART emails and mobiles remain unavailable (A5 above).

### The recommended source strategy

The combination that is free or near-free, legal, and actually produces contactable prospects:

1. **A3 (MCA, free)** gives the *universe* of real Indian companies plus a true size signal.
2. **A4 (Places, ~free at your volume)** gives the *phone number and website*.
3. **The AI Research Agent** reads the website and works out the sales-model fit.
4. **Scoring** combines all three.

A5/A6/A7 then become optional top-ups for categories MCA and Places cover poorly, and for the EU.

### Spend caps (D5)

`re_source_configs` holds `monthly_cap_units` and `monthly_cap_usd` per adapter; `re_source_runs` accumulates usage per calendar month. A run that would cross either cap **fails before making the first external call**, and the Sources screen shows the remaining allowance. Default caps for R2: Places 900 lookups/month (under the ~1,000 free tier), Apify $25/month, MCA unlimited (free).

---

## 5. Database schema

Postgres on the existing Supabase project (Mumbai, `ltigfpywdbfilsagtpyd`). Migration naming follows the repo convention `YYYYMMDDHHMMSS_snake_name.sql`. All tables RLS-enabled. Timestamps `timestamptz`; **all date grouping and reporting converts to the account timezone (IST), never `toISOString()`** — the DSR "0 visits" bug came from exactly that mistake.

### 5.1 Release 1 tables

#### `re_operators`
The multi-operator hook from D2. One row in R1.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `profile_id` | uuid | → `profiles.id`, unique |
| `role` | text | `founder` \| `sdr` \| `agency` |
| `can_see_money` | boolean | default `true`; `false` for agency |
| `is_active` | boolean | default `true` |
| `created_at` | timestamptz | |

#### `re_companies`
The unit of work. **A company, not a contact** — a company has many contacts, one owner, one status, one current score.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | |
| `website` | text | |
| `domain` | text | normalised host, no `www.`, lowercased |
| `country` / `state` / `city` | text | |
| `industry` | text | |
| `nic_code` | text | from MCA |
| `cin` | text | MCA company identifier |
| `paid_up_capital` | numeric | from MCA — the real size signal |
| `employee_band` | text | `1-10` … `1000+` |
| `source_adapter` | text not null | `import` \| `inbound` \| `mca` \| `places` \| `apify` |
| `source_ref` | text | the id in the source system |
| `source_url` | text | |
| `first_seen_at` / `last_refreshed_at` | timestamptz | |
| `owner_id` | uuid | → `re_operators.profile_id` |
| `status` | text | `new` \| `researching` \| `qualified` \| `working` \| `demo` \| `won` \| `lost` \| `disqualified` |
| `disqualify_reason` | text | |
| `icp_score` | integer | 0–100, denormalised from latest `re_scores` |
| `icp_band` | text | `hot` \| `warm` \| `cold` |
| `score_computed_at` | timestamptz | |
| `fit_crm` / `fit_wfa` / `fit_sfa` / `fit_fsm` | integer | **0–100 each.** Four first-class scores, not booleans — they tell you *what to pitch* |
| `best_fit_line` | text | `crm` \| `wfa` \| `sfa` \| `fsm`, the highest of the four; the single most actionable field on the record |
| `dealer_count` / `distributor_count` | integer | from research — **better buying signals than employee count** (§5.1a) |
| `branch_count` / `depot_count` | integer | from research |
| `field_force_estimate` | integer | from research |
| `territory_states` | text[] | states/regions the company visibly operates in |
| `tags` | text[] | |
| `notes` | text | |
| `dedup_key` | text not null | **unique** — `domain`, falling back to `slug(name)` + `city` |
| `is_active` | boolean | default `true`; soft delete, matching the repo's pattern |
| `created_at` / `updated_at` | timestamptz | |

Indexes: unique on `dedup_key`; btree on `owner_id`, `status`, `icp_band`, `city`, `domain`; GIN on `tags`.

#### `re_contacts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | → `re_companies` on delete cascade |
| `name` | text | |
| `designation` | text | |
| `role_type` | text | `decision_maker` \| `influencer` \| `gatekeeper` \| `unknown` |
| `email` | text | |
| `email_status` | text | `unverified` \| `valid` \| `invalid` \| `risky` — default `unverified` |
| `phone` / `whatsapp` | text | E.164 via the existing `phone-utils` |
| `linkedin_url` | text | reference only; **never scraped** (D6) |
| `is_primary` | boolean | |
| `consent_basis` | text | `legitimate_interest` \| `consent` \| `inbound` — see §9 |
| `opted_out_at` | timestamptz | |
| `is_active` | boolean | |
| `created_at` / `updated_at` | timestamptz | |

#### `re_research_runs`
One immutable row per AI research pass. Never updated.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `model` | text not null | e.g. `claude-opus-5-5` |
| `prompt_version` | text not null | so old runs stay interpretable |
| `effort` | text | `low` \| `medium` \| `high` |
| `inputs` | jsonb | what we gave it |
| `raw_output` | jsonb | what came back |
| `fetched_urls` | jsonb | every URL the model actually fetched |
| `input_tokens` / `output_tokens` / `cached_tokens` | integer | |
| `cost_usd` | numeric(10,4) | |
| `status` | text | `queued` \| `running` \| `succeeded` \| `failed` \| `refused` |
| `error` | text | |
| `batch_id` | text | Anthropic Batch API id, when batched |
| `started_at` / `finished_at` | timestamptz | |

#### `re_research_claims`
**The most important table in the design.** Every structured fact the AI produced, with its evidence.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `research_run_id` | uuid not null | |
| `company_id` | uuid not null | |
| `claim_key` | text not null | from the closed list in §5.1a — an unknown key fails the run rather than being stored |
| `claim_value` | text not null | |
| `confidence` | numeric | 0–1, model-reported |
| `evidence_url` | text | **null means it is a guess** |
| `evidence_quote` | text | the exact sentence the claim came from |
| `is_verified` | boolean | generated: `evidence_url IS NOT NULL AND evidence_quote IS NOT NULL` |
| `created_at` | timestamptz | |

> **The evidence-or-flag rule.** The UI renders a claim as a fact only when `is_verified` is true, showing the quote and a link. When it is false the claim renders as **"AI guess — unverified"** in muted styling and is excluded from scoring, from outreach drafts and from meeting briefs. Without this rule the Research Agent becomes a confident liar: it writes "I see you have 125 field reps", the prospect says "we have 11", and the meeting is over. It is the same discipline already applied to ROI figures in the brochures.

### 5.1a Claim keys — distributor and territory intelligence

A closed list, because OZZO's buyers are agri, seeds, fertiliser, pumps and manufacturing — **not SaaS**. For these companies, employee count is a poor signal and often actively misleading: a 40-person fertiliser business with 200 dealers and 25 field reps is a far better SFA prospect than a 300-person software firm. The claim keys are therefore built around **distribution and field presence**, not headcount.

| Group | Claim keys | Why it matters |
|---|---|---|
| **Distribution** | `dealer_count`, `distributor_count`, `channel_model` (direct / dealer / distributor / hybrid), `distributor_named` | The core OZZO buying signal. Dealers imply field reps, which imply SFA. |
| **Field presence** | `field_force_estimate`, `branch_count`, `depot_count`, `warehouse_count` | Reps to manage = the product. |
| **Territory** | `territory_states`, `territory_districts`, `export_markets` | Multi-state operation implies territory hierarchy and route planning. |
| **Service footprint** | `installed_base_signal`, `service_network`, `amc_offered`, `spare_parts_network` | **The FSM signal.** A pump or machinery maker with an installed base needs FSM — something employee count would never reveal. |
| **Workforce** | `team_size`, `shift_work_signal`, `attendance_pain_signal` | The WFA signal. |
| **Company** | `products`, `locations`, `industry_detail`, `turnover_signal`, `existing_software` | Context; `existing_software` flags an incumbent to displace. |
| **Pain** | `pain_point` (repeatable) | Each one needs its own evidence quote. |
| **Fit** | `crm_fit_reason`, `wfa_fit_reason`, `sfa_fit_reason`, `fsm_fit_reason` | One sentence per line, explaining that line's score |

Numeric claims are mirrored onto `re_companies` (`dealer_count`, `field_force_estimate`, …) **only when `is_verified` is true**, so the list view can filter and sort on them without re-reading claims.

#### `re_scores`
Scoring history, so you can see a company heating up rather than only its score today.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `model_version` | text not null | the scoring rules version, not the LLM |
| `firmographic` | integer | 0–50 |
| `behavioural` | integer | 0–30 |
| `engagement` | integer | 0–20 |
| `total` | integer | 0–100 — the **ICP score**: is this worth my time at all? |
| `band` | text | `hot` ≥ 70 \| `warm` 40–69 \| `cold` < 40 |
| `fit_crm` / `fit_wfa` / `fit_sfa` / `fit_fsm` | integer | 0–100 each — the **fit scores**: what do I pitch? Computed in the same pass, so history stays in one row |
| `best_fit_line` | text | the highest of the four |
| `inputs` | jsonb | every input value, so a score is reproducible |
| `is_override` | boolean | true when the founder set it by hand |
| `override_reason` | text | |
| `computed_at` | timestamptz | |

#### `re_outreach_drafts`
What to say. Generated on demand per company, **never sent by the engine in R1** — you copy it out and send it yourself.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `contact_id` | uuid | who it is addressed to |
| `channel` | text not null | `whatsapp` \| `email` \| `call_script` \| `linkedin` |
| `variant` | text | `first_touch` \| `follow_up_1` \| `follow_up_2` \| `breakup` |
| `pitch_line` | text | which product line this draft pitches — from `best_fit_line` |
| `subject` | text | email only |
| `body` | text not null | |
| `claims_used` | uuid[] | **the exact verified claims this draft leaned on** — so you can check every sentence back to its source |
| `research_run_id` | uuid | which research this came from |
| `model` / `prompt_version` | text | |
| `cost_usd` | numeric(10,4) | |
| `approved_at` | timestamptz | null until a human approves it |
| `approved_by` | uuid | |
| `edited_body` | text | the human's edit, kept separately from the AI's original |
| `sent_manually_at` | timestamptz | set when you mark it sent; writes a `re_activities` row |
| `created_at` | timestamptz | |

Rules: a draft may cite **only** claims where `is_verified = true`. The generator is also handed the suppression list and the contact's `opted_out_at`, and refuses to draft for a suppressed contact. **A WhatsApp draft is free text for manual sending — it is not a Meta-approved template** (see §6.6).

#### `re_meeting_briefs`
Moved into R1 from the original phase 8, because it reads only data R1 already holds.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `deal_id` | uuid | |
| `summary` | text | company in three lines |
| `pain_points` | jsonb | each with its evidence |
| `likely_objections` | jsonb | objection + suggested response |
| `demo_flow` | jsonb | ordered screens to show, driven by `best_fit_line` |
| `questions_to_ask` | jsonb | discovery questions |
| `claims_used` | uuid[] | verified claims only |
| `model` / `prompt_version` | text | |
| `cost_usd` | numeric(10,4) | |
| `generated_for` | timestamptz | the meeting it was prepared for |
| `created_at` | timestamptz | |

#### `re_activities`
Every touch. In R1 these are hand-logged, or written automatically when you mark a draft as sent; from R2 the channels write here too.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `contact_id` | uuid | |
| `owner_id` | uuid not null | who did it |
| `type` | text | `call` \| `whatsapp` \| `email` \| `meeting` \| `note` \| `status_change` |
| `direction` | text | `outbound` \| `inbound` |
| `subject` / `body` | text | |
| `outcome` | text | `connected` \| `no_answer` \| `not_interested` \| `interested` \| `callback` \| `wrong_number` |
| `occurred_at` | timestamptz not null | |
| `external_ref` | text | e.g. WhatsApp message id |
| `created_at` | timestamptz | |

#### `re_deals`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `title` | text | |
| `plan_id` | text | **a `PlanId` from `src/lib/plans/catalog.ts`** |
| `users_count` | integer | |
| `billing_term` | text | `quarterly` \| `half_yearly` \| `yearly` |
| `value_inr` | numeric | **computed by `quote()` in `src/lib/plans/pricing.ts`, never hand-entered** |
| `stage` | text | `discovery` \| `demo` \| `proposal` \| `negotiation` \| `won` \| `lost` |
| `probability` | integer | |
| `expected_close` | date | |
| `lost_reason` | text | |
| `owner_id` | uuid not null | |
| `proposal_id` | uuid | → the existing `/admin/proposals` record |
| `created_at` / `updated_at` | timestamptz | |

#### `re_suppressions`
Global do-not-contact. **In R1 even though nothing sends** — so that when someone says no during a manual call, they are off every future list permanently.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `channel` | text | `email` \| `phone` \| `whatsapp` \| `domain` \| `all` |
| `value` | text not null | normalised; unique with `channel` |
| `reason` | text | `opt_out` \| `bounce` \| `complaint` \| `competitor` \| `existing_customer` \| `manual` |
| `note` | text | |
| `created_by` | uuid | |
| `created_at` | timestamptz | |

#### `re_source_configs` and `re_source_runs`
The adapter registry and the spend cap from D5.

`re_source_configs`: `adapter_key` (unique), `display_name`, `is_enabled`, `credentials_ref` (env var name — **never the secret itself**), `default_params` jsonb, `monthly_cap_units`, `monthly_cap_usd`, `apify_actor_id`.

`re_source_runs`: `adapter_key`, `params` jsonb, `records_found`, `records_new`, `records_duplicate`, `records_rejected`, `units_used`, `cost_usd`, `status`, `error`, `started_at`, `finished_at`, `created_by`.

### 5.2 Later-release tables (named now, not built)

`re_sequences`, `re_sequence_steps`, `re_enrollments` (R3) · `re_email_identities`, `re_email_messages`, `re_email_events` (R2) · `re_campaigns` (R3) · `re_meetings` (R4) · `re_battlecards` (R5) · `re_web_sessions` (R5) · `re_content_assets` (R6).

### 5.3 Migrations for Release 1

| File | Contents |
|---|---|
| `20261002120000_revenue_engine_core.sql` | `re_operators`, `re_companies`, `re_contacts`, indexes, `updated_at` triggers, the `re_can_read()` helper, RLS policies |
| `20261002120100_revenue_engine_research.sql` | `re_research_runs`, `re_research_claims` (closed claim-key check per §5.1a), `re_scores` incl. the four fit scores, the `is_verified` generated column, narrowed service-role grants |
| `20261002120150_revenue_engine_generation.sql` | `re_outreach_drafts`, `re_meeting_briefs`, the verified-claims-only constraint, service-role grants |
| `20261002120200_revenue_engine_activity.sql` | `re_activities`, `re_deals`, `re_suppressions` |
| `20261002120300_revenue_engine_sources.sql` | `re_source_configs`, `re_source_runs`, the cap-check function, seed rows for the 7 adapters (only `import` and `inbound` enabled) |
| `ROLLBACK-revenue-engine.md` | Matching rollback notes, as every other module in this repo has |

---

## 6. AI architecture

### 6.1 Model and cost

The repo already has an Anthropic client at `src/lib/ozzo/claude.ts` using `claude-sonnet-5`, and `@anthropic-ai/sdk ^0.122.0` is installed. The Revenue Engine adds a second, separate client for research — it must not share ASK OZZO's prompt or rate budget.

**Recommended model: `claude-opus-5-5`** ($4 per million input tokens, $20 per million output). Current pricing for reference:

| Model | Input $/MTok | Output $/MTok |
|---|---|---|
| `claude-opus-5-5` | 4.00 | 20.00 |
| `claude-sonnet-5-5` | 2.00 | 10.00 |
| `claude-haiku-4-5` | 1.00 | 5.00 |

**Estimated cost per company researched** — roughly 30K input tokens (3–5 fetched pages) and 2K output:

| Setup | Per company | 1,000 companies/month |
|---|---|---|
| Opus 5.5, live | ~$0.16 | ~$160 |
| **Opus 5.5 via Batch API (50% off)** | **~$0.08** | **~$80** |
| Sonnet 5.5 via Batch API | ~$0.04 | ~$40 |

**Architecture decision: research runs as an overnight Batch job.** Research is never latency-sensitive — you read it the next morning. The Batch API halves the bill for free. A manual "Research now" button exists for single companies and uses a live streaming call.

Model choice is yours; the design does not depend on it, since `re_research_runs.model` is per-row. I recommend starting on Opus 5.5 for quality, measuring the claim-verification rate for a month, and stepping down only if the cheaper model holds that rate.

### 6.2 How the Research Agent actually works

```
  company (name + website + MCA facts)
            |
      [1] web_search_20260209   -- find the site if we only have a name
      [2] web_fetch_20260209    -- fetch homepage, about, products, contact
            |  max_content_tokens caps the spend per page
      [3] one Claude call, structured output, strict schema
            |
      [4] every claim must carry evidence_url + evidence_quote
            |
      [5] write re_research_runs (immutable) + re_research_claims
      [6] scoring reads ONLY claims where is_verified = true
```

Key points:

- **Anthropic's server-side `web_fetch` tool does the reading.** No scraper to build or maintain for website research, and `max_content_tokens` caps per-page cost. Note `web_fetch` only fetches URLs already in the conversation, so we always pass the website explicitly.
- **Structured output with a strict schema.** The response is validated against the claim schema before anything is written. A malformed response fails the run; it never writes a partial record.
- **The prompt instructs the model that a claim without a supporting quote must be returned with `evidence_url: null`,** rather than omitted or invented. Being allowed to say "I am guessing" is what stops it guessing silently.
- **`prompt_version` is stored on every run.** When the prompt changes, old research stays interpretable instead of becoming a mystery.

### 6.3 Prompt caching — and an honest limit

Caching is a prefix match: `tools` → `system` → `messages`. The stable prefix here is the OZZO ICP definition and the product-fit rules (~4K tokens), which goes behind a `cache_control` breakpoint.

**Be realistic: caching saves little on this workload.** The bulk of the tokens is each company's own fetched pages, which are unique every time, so there is nothing to reuse. Caching the 4K system prefix saves about $0.015 per company — real, but not the lever. **The Batch API is the lever** (50%), and `max_content_tokens` is second.

Where caching genuinely pays: the multi-step runs (fetch → analyse → score within one company), where the fetched pages are reused across turns. Verify with `usage.cache_read_input_tokens` — if it is zero across repeated runs, something volatile has leaked into the prefix.

### 6.4 Guardrails

| Risk | Control |
|---|---|
| Invented facts | The evidence-or-flag rule (§5.1); unverified claims excluded from scoring |
| Runaway spend | `re_source_configs` monthly caps; a per-month AI budget checked before each batch; `max_content_tokens` per fetch |
| AI writing business records | Service-role `GRANT` limited to INSERT on three tables (§3) |
| Prompt injection from a prospect's website | Fetched page content is **data, never instruction**. The system prompt states that page text cannot change the task, and the output schema is strict, so an injected instruction has nowhere to land. |
| Model refusal | `re_research_runs.status = 'refused'` is a first-class outcome, surfaced in the UI, not retried in a loop |
| Silent model drift | `model` + `prompt_version` + `effort` on every run; a weekly verification-rate figure on the Spend screen |

### 6.5 The four agents in Release 1

All four share one hard rule: **they read only claims where `is_verified = true`.** This is what makes the evidence rule protect the outreach, not just the research screen.

| Agent | Runs | Reads | Writes | Cost |
|---|---|---|---|---|
| **Research Agent** | Overnight batch, per new company | `web_search` + `web_fetch` | runs + claims | ~$0.08 / company (batched) |
| **Scoring Engine** | After every research run | verified claims + MCA fields + activity counts | `re_scores` | **$0 — no LLM** |
| **Outreach Generator** | On demand, per company you choose to work | verified claims + `best_fit_line` + suppressions | `re_outreach_drafts` | ~$0.02 per set of 4 channels |
| **Meeting Brief Generator** | On demand, before a meeting | verified claims + activity history | `re_meeting_briefs` | ~$0.02 per brief |

**Cost impact of the three additions is small**, because generation is on demand per company you actually work, and you will work far fewer companies than you research. Research remains the bulk of the bill.

#### Scoring: two different questions, two different scores

The Scoring Engine is **deterministic code, not an LLM** — a score must be reproducible and explainable. An LLM score that changes between runs is useless for deciding who to call. The LLM supplies *verified claims* as inputs; it never assigns a number.

| Score | Question it answers | Inputs |
|---|---|---|
| **ICP score** (0–100) | Is this worth my time at all? | MCA paid-up capital, NIC code, city/state, dealer and distributor counts, field force, activity and engagement counts |
| **Fit scores** (4 × 0–100) | **What do I pitch?** | Per §5.1a: dealer/distributor counts and field force → **SFA**; installed base, service network, AMC → **FSM**; team size, shift and attendance signals → **WFA**; everything else plus `existing_software` → **CRM** |

Each fit score carries its `*_fit_reason` claim, so the screen shows *why* it says SFA 92 / CRM 35 / FSM 80. `best_fit_line` drives the demo flow in the meeting brief and the pitch line in every outreach draft — one decision propagating to everything downstream.

### 6.6 One constraint on generated WhatsApp messages

A generated WhatsApp draft is **free text for you to send by hand**. It is *not* a Meta-approved template. Outside the 24-hour customer-service window, the Cloud API requires a pre-approved template with variables, not free text.

That is fine for R1 — you copy and send. But **R3 cannot simply automate these drafts**: the messages will have to be restructured as approved templates with variable slots, then submitted for Meta review. Recording it now so nobody assumes R1's output is R3-ready. The existing `src/lib/whatsapp/template-*` code already handles template structure and the approval lifecycle, so this is a known, bounded piece of work — not a surprise.

### 6.7 Later AI features, with their honest shape

- **Sales Coach (R4)** is a prompt over verified claims plus the battlecards. No new data access.
- **Meeting *booking* (R4)** — calendar links, reminders, scheduling — is the part that needs new infrastructure. Only the *brief* moved to R1.
- **Content Studio (R6)** writes marketing copy. Nothing it produces publishes without founder review — the existing brochure discipline.

---

## 7. Navigation structure

Entries join the **founder-only** group in `src/app/(superadmin)/admin/admin-shell.tsx` (the group that already holds Price Calculator, Data Retention, Sales Proposals and Business Forecast), under a `Revenue Engine` heading.

Module names follow the founder's review: **Prospect Hub · Research Agent · Outreach Studio · Pipeline · Campaign Center · Revenue Command Center.** Routes stay under `/admin/revenue/*`.

| Module | Path | Screen | Release |
|---|---|---|---|
| Revenue Command Center | `/admin/revenue` | Today's priorities | R1 |
| Prospect Hub | `/admin/revenue/companies` | List: filter by band, **fit line**, status, owner, city, dealer count, source | R1 |
| Prospect Hub | `/admin/revenue/companies/[id]` | Company detail — the workhorse, six tabs | R1 |
| Prospect Hub | `/admin/revenue/companies/import` | Spreadsheet import (Universal Import Framework) | R1 |
| Outreach Studio | `/admin/revenue/companies/[id]/outreach` | Generate and edit the 4 channel drafts | R1 |
| Outreach Studio | `/admin/revenue/companies/[id]/brief` | Meeting brief | R1 |
| Pipeline | `/admin/revenue/pipeline` | Deals by stage, value from the pricing engine | R1 |
| Pipeline | `/admin/revenue/suppressions` | Do-not-contact list | R1 |
| Research Agent | `/admin/revenue/sources` | Adapters, caps, run history | R1 read-only → R2 runnable |
| Research Agent | `/admin/revenue/spend` | AI + API spend, claim-verification rate | R1 |
| Campaign Center | `/admin/revenue/sequences` | Sequence builder | R3 |
| Campaign Center | `/admin/revenue/campaigns` | Email + WhatsApp campaigns and analytics | R3 |
| Campaign Center | `/admin/revenue/battlecards` | Competitor intelligence | R5 |

**Company detail, six tabs:** **Facts** (verified claims with quotes; guesses clearly separated below) · **Fit** (the four scores with their reasons, and what to pitch) · **Contacts** · **Outreach** (the drafts) · **Timeline** (activities) · **Deal**.

---

## 8. User journeys

### J1 — Morning triage (daily, R1)
Open `/admin/revenue`. The Command Center shows: hot companies not contacted in 7 days; companies whose research finished overnight; follow-ups due today; any failed source run or refused research. Founder clicks the top company and starts calling. **Success: under 60 seconds from login to knowing who to call.**

### J2 — Bring in a list (R1)
Founder has a spreadsheet of 200 companies. Upload at `/admin/revenue/companies/import` → map columns → the engine normalises, computes `dedup_key`, rejects duplicates and anything on the suppression list, and reports **reasons** for every rejected row (the import-failure-reasons pattern already in the app). Accepted rows land as `status = new` and queue for overnight research.

### J3 — Research runs overnight (R1)
The nightly job takes every `status = new` company with a website, submits one Batch request, and writes runs and claims on completion. Morning: `status = researching → qualified`, with a score. **Failures are visible, never silent.**

### J4 — Judge a company, and know what to pitch (R1)
Open the company. The Facts tab shows verified claims each with its quote and source link — "200 dealers across 6 states" next to the sentence it came from. Guesses sit below, greyed, labelled unverified. The Fit tab shows **SFA 92 · FSM 80 · CRM 35 · WFA 20**, each with its one-line reason. Founder either starts working it, or disqualifies with a reason. **No number appears without a source.**

### J5 — Generate the outreach (R1) *(added in the founder review)*
One click on the Outreach tab produces four drafts — WhatsApp, email, cold-call script, LinkedIn message — all pitching `best_fit_line` and citing only verified claims. Each draft lists the claims it used, so every sentence traces back to a source. Founder edits what they want (the edit is stored separately from the AI's original), copies it out, and sends it personally. Marking it sent writes a `re_activities` row. **A suppressed contact cannot be drafted for at all.**

### J6 — First contact, by hand (R1)
Founder calls the decision maker using the generated script, logs an activity with an outcome. If interested, status → `working` and a follow-up task. **The suppression list is checked and shown on this screen before the call.**

### J6b — Prepare for the demo (R1) *(moved up from R4 in the founder review)*
Before a scheduled demo, one click generates the brief: company in three lines, pain points with evidence, likely objections with suggested responses, a demo flow ordered by `best_fit_line`, and discovery questions. Founder reads it in two minutes on the way to the call. **Verified claims only — so nothing in the brief can be an invention.**

### J7 — Someone says no (R1)
Outcome `not_interested` prompts a one-click suppression add. That phone, email and domain are off every future list permanently, including every later channel — and the Outreach Generator will refuse to draft for them.

### J8 — Deal and proposal draft (R1) *(extended in the founder review)*
Create a deal: `plan_id` **defaults to `best_fit_line`**, so the research decides what you quote. Pick the user count; `value_inr` comes from `quote()` in the existing pricing engine, so the pipeline number and the proposal number cannot disagree. Then **"Generate proposal draft"** hands off to `/admin/proposals` with the plan, term, user count, company details and the verified pain points already filled in — you review and send. The existing builder does the rendering; the Revenue Engine only supplies the inputs.

### J9 — Weekly review (R1)
`/admin/revenue/spend`: companies added, researched, qualified; activities logged; pipeline value; AI spend against budget; **claim-verification rate** — the health metric for the whole AI layer.

### Later journeys
J10 enrol in a sequence (R3) · J11 handle an email reply and auto-pause the sequence (R3) · J12 book a meeting with calendar links and reminders (R4) · J13 identify an inbound visitor's company (R5).

---

## 9. Compliance and non-functional requirements

### Email — a serious, specific warning

**Research finding: Resend, SendGrid and Amazon SES all prohibit cold outreach in their terms.** Resend's acceptable-use policy requires consent from recipients; SendGrid suspends cold-outreach accounts without warning; AWS documentation says to send only to recipients who explicitly requested mail. Thresholds are tight: SES goes under review at 5% bounces or 0.1% complaints.

**OZZO already uses Resend for `ozzo.co.in` mail, with Supabase custom SMTP.** That is the same path that sends **password resets and auth mail for every tenant**. If cold outreach were sent through it and the account were suspended, password reset breaks for all customers. That is a production outage caused by a marketing decision.

**Therefore, non-negotiably, from Release 2:**

1. **A separate sending domain** (e.g. `ozzocrm.in`), never `ozzo.co.in`.
2. **A separate provider built for outreach** — Smartlead (from ~$39/month) or Instantly (from ~$47/month), not Resend/SendGrid/SES.
3. **Separate mailboxes:** 2–3 per domain, each capped at **30–50 emails/day**, with a 14–21 day warm-up before the first real send. Google's technical limit is 2,000/day; exceeding ~50 cold sends per mailbox damages reputation regardless.
4. `re_email_identities` records which domain and mailbox each message went through, so a reputation problem can be traced to one identity and isolated.

### Data protection

- **EU (A7, Europages/Kompass):** B2B cold email is lawful under GDPR **legitimate interest** (Art. 6(1)(f)) when the recipient is a business, the message is relevant to their role, opt-out is simple, and **the legitimate-interest assessment is documented**. `re_contacts.consent_basis` records the basis per contact, and the engine stores the assessment per source adapter.
- **Germany and Austria require prior consent** under the German UWG, even with GDPR satisfied. The engine must **block EU-sourced German and Austrian contacts from any email sequence by default** — a country-level gate on enrolment, not a note in a document.
- **India (DPDP Act):** the suppression list and opt-out plumbing exist from R1 and cover this.
- **Terms of service:** using Apify does not transfer the breach. A5/A6/A7 are a commercial-risk decision the founder is taking knowingly; it is recorded here rather than buried.

### Other non-functional requirements

| Area | Requirement |
|---|---|
| Security | `requireFounder()` on every route; RLS on every table; no secret in the database — `credentials_ref` holds the env var name only |
| Tenant isolation | No `re_*` table references a tenant table; no tenant query touches `re_*`. Verified by a test. |
| Dates | All grouping converts `timestamptz` to the account timezone (IST). Never `toISOString()`. |
| Retention | Prospect data kept while active; research runs 2 years; source-run logs 90 days — matching the existing retention policy shape in `src/lib/retention` |
| Cost ceiling | Hard monthly caps per adapter plus an AI budget, enforced before the external call |
| Tests | Vitest, `src/**/*.test.ts` only (`*.spec.ts` is not picked up). Required: dedup key, suppression check, cap enforcement, score computation, the evidence-or-flag rule, claim-schema validation |
| Honesty rules | The repo's absolute rules apply: no fabricated stubs, no generated reports asserting results that were not measured, no `any` without a justifying comment |

---

## 10. Implementation roadmap

Each release is independently useful and independently abandonable. Sizes are engineering estimates, not commitments.

### Release 1 — Prospect database + AI brain *(the only release specified to build depth)*

**Goal:** research and score real companies, know what to pitch each one, have the message already written, and work them by hand.

1. Five migrations (§5.3) with rollback notes
2. Revenue Command Center at `/admin/revenue`
3. Prospect Hub: list + detail with the six tabs
4. Spreadsheet import adapter (A1) and inbound-form adapter (A2)
5. Research Agent: batch job, live single-company button, strict schema, evidence-or-flag, **the full distributor and territory claim set (§5.1a)**
6. Deterministic scoring engine: **ICP score + the four fit scores with reasons**
7. **Outreach Generator — 4 channels, verified claims only, human approval, manual send** *(added in review)*
8. **Meeting Brief Generator** *(moved up from R4 in review)*
9. Activities, deals (wired to `quote()`, plan defaulting to `best_fit_line`), suppressions
10. **Proposal draft handoff into the existing `/admin/proposals` builder** *(added in review)*
11. Sources screen, read-only — the 7 seeded adapters and their caps; only `import` and `inbound` enabled
12. Spend + verification-rate screen
13. Tests per §9, plus: the generators must refuse unverified claims, and must refuse suppressed contacts

**Blocker on you:** `ANTHROPIC_API_KEY` must be set in the web project's environment. ASK OZZO is still blocked on it, and nothing AI-powered in R1 can run until it is set. Everything else in R1 is on me.

**Estimate: 5–6 weeks** — revised up from 3–4 weeks by the founder review. The five additions cost roughly 10 working days: outreach generator 3, fit scores 2, meeting brief 2, proposal handoff 2, distributor claim set 1. Stated plainly rather than absorbed silently; cutting any of them back is the founder's call.

### Release 2 — Real data sources + email foundations
MCA adapter (A3, free), Google Places adapter (A4) with caps, Apify adapter (A5/A6/A7) with per-actor config; sending domain, provider, mailboxes and warm-up; `re_email_identities` / `_messages` / `_events`; email verification to protect bounce rate. **Covers brief phases 4 and part of 5. ~4 weeks plus 2–3 weeks of warm-up waiting, which runs in parallel.**

### Release 3 — Sequences and campaigns
Sequence builder over the existing automations engine; email + WhatsApp campaigns (WhatsApp follow-up only, per §1); reply detection that auto-pauses a sequence; the EU/Germany enrolment gate; campaign analytics on the existing report engine. **Covers phases 5, 6, 11. ~4 weeks.**

### Release 4 — Meeting booking and coach
Calendar links, demo scheduling and auto-reminders; sales coach over verified claims and battlecards. **The demo-prep brief is no longer here — it shipped in R1.** **Covers phases 7 and 9. ~2 weeks.**

### Release 5 — Intelligence
Competitor battlecards (seeded from the 12 existing `/compare` pages); website intelligence as **analytics and lead capture, not visitor identification** — the brief's own caution, kept. **Covers phases 12, 14. ~2 weeks.**

### Release 6 — Content Studio
Campaign, LinkedIn, blog and case-study drafting, with founder review before anything publishes. **Covers phase 13. ~2 weeks.**

### Mapping back to your priority order

| Your priority | Release |
|---|---|
| 1. Lead Intelligence Hub | R1 |
| 2. AI Research Agent | R1 |
| 3. Lead Scoring | R1 |
| 4. Pipeline | R1 |
| 5. Email Campaigns | **message generation R1** · sending R2 → R3 |
| 6. WhatsApp Campaigns | **message generation R1** · sending R3 |
| 7. Sales Sequences | R3 |
| 8. Demo Preparation | **brief R1** (moved up in review) · booking R4 |
| 9. Revenue Dashboard | **R1** (moved up — it is the daily screen) |
| 10. Sales Coach | R4 |
| 11. Website Intelligence | R5 |
| 12. Competitor Intelligence | R5 |
| 13. Content Studio | R6 |

---

## 11. Open decisions for the founder

These do not block Release 1. They need answers before the release named.

| # | Question | Needed by | My recommendation |
|---|---|---|---|
| O1 | Set `ANTHROPIC_API_KEY` in the web environment | **R1** | Do it now; it also unblocks ASK OZZO |
| O2 | Monthly AI budget ceiling | R1 | $100/month — about 1,200 companies researched on Opus 5.5 via Batch |
| O3 | Model: Opus 5.5 or Sonnet 5.5 | R1 | Start on Opus 5.5, measure the verification rate for a month, step down only if it holds |
| O4 | Which sending domain to buy | R2 | A close variant such as `ozzocrm.in` — never `ozzo.co.in` |
| O5 | Smartlead or Instantly | R2 | Either; Smartlead is cheaper at low volume |
| O6 | Apify budget | R2 | $25/month cap to start, which is thousands of records |
| O7 | Accept the terms-of-service risk on A5/A6/A7 | R2 | Explicitly yes or no, in writing, once you have read §4 and §9 |
| O8 | When do SDRs get access | R3 | The schema is ready; it is a decision, not work |

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Cold email suspends the Resend account and breaks tenant password resets** | **High** | Separate domain + separate provider, mandatory from R2 (§9) |
| AI invents facts and you pitch on them | High | Evidence-or-flag rule; unverified claims excluded from scoring; verification rate tracked weekly |
| IndiaMART/TradeIndia yield names but no contacts | Medium | Already known (§4) — MCA + Places are the contactable path; A5 is a top-up, not the plan |
| Directory scraping breaks or gets blocked | Medium | Apify maintains the parsers; a failed run is visible and never corrupts data |
| Google Places bill runs away | Medium | Database cap below the free tier; a run that would cross it fails before the first call |
| GDPR exposure on EU contacts | Medium | Legitimate-interest basis recorded per contact; Germany/Austria blocked from sequences by default |
| Scope creep back toward all 15 phases at once | Medium | This document; later phases stay a named backlog |
| Fifth unfinished front — FSM still has nothing built | Medium | D1 keeps this founder-only: no pricing, onboarding, support or mobile burden |
| WABA number banned by cold WhatsApp | Low, if respected | WhatsApp is follow-up only |

---

## 13. Review log

### Revision 2 — 2026-10-02, founder review

Approved: separate `re_*` tables · the evidence-or-flag rule · the AI-cannot-write-records rule · the email/domain warning · Research Agent · scoring · email foundation · campaign engine · revenue dashboard.

Five changes requested, **all five accepted**:

| # | Change | Where it landed | Assessment |
|---|---|---|---|
| 1 | **AI Outreach Generator in R1** (generate only, no sending) | §5.1 `re_outreach_drafts`, §6.5, J5, R1 item 7 | **Correct, and my omission.** D4 conflated *generation* with *sending*. Generation has no domain, provider, warm-up or Meta policy cost. Research without a message is a research project, not a revenue engine. |
| 2 | **Proposal draft generator in R1** | §8 J8, R1 item 10 | **Correct and nearly free.** `re_deals.proposal_id` was already in the schema and `/admin/proposals` already holds all 5 plans as content packs. A prefill and a handoff, not a module. |
| 3 | **Meeting brief in R1, not R4** | §5.1 `re_meeting_briefs`, J6b, R1 item 8 | **Correct, with a split.** The brief reads only data R1 already holds. Meeting *booking* needs new infrastructure and stays in R4. |
| 4 | **OZZO Fit Score as first class, per line** | §5.1 four integer columns + `best_fit_line`, §6.5 | **Better than what I had.** A boolean "SFA fit: true" does not tell you what to pitch; `SFA 92 / CRM 35 / FSM 80` does. `best_fit_line` now drives the demo flow, the outreach pitch line and the deal's default plan. |
| 5 | **Distributor & territory intelligence in the Research Agent** | §5.1a, the closed claim-key list | **The strongest point in the review.** Employee count is misleading for agri, seeds, fertiliser, pumps and manufacturing. Dealer network, field force, branch and depot counts are the real signals — and the service-footprint keys surface FSM prospects that headcount would never reveal. |

Module names adopted: **Prospect Hub · Research Agent · Outreach Studio · Pipeline · Campaign Center · Revenue Command Center** (§7).

Two things added that the review implied but did not state:

- **All generators read only `is_verified = true` claims** (§6.5). This makes the evidence rule protect the outreach, not just the research screen — otherwise the generator writes "I see you have 125 reps" from a guess, which is exactly the dead-meeting scenario the review described.
- **A generated WhatsApp draft is free text, not a Meta-approved template** (§6.6). Fine for R1's manual sending; R3 must restructure them into approved templates with variables. Recorded so nobody assumes R1's output is R3-ready.

**Consequence, stated not absorbed: Release 1 moves from 3–4 weeks to 5–6 weeks** (§10). Cutting any addition back is the founder's call.

## 14. Approval

No code will be written until this document is approved. On approval the next step is the implementation plan for **Release 1 only**.

Remaining open items:

1. Revision 2 above — **does it capture the review correctly?**
2. **5–6 weeks for Release 1** — accepted, or cut something back?
3. O1–O3 in §11 (API key, monthly AI budget, model choice) — your answers.
