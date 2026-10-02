# OZZO Revenue Engine — Product Requirements & Architecture

**Status:** Revision 3 — architecture approved in principle; **Release 1 scope awaiting freeze** (§14). No code until frozen.
**Date:** 2026-10-02
**Owner:** Sumit Vegad (founder)
**Contents:** PRD · database schema · permissions matrix · navigation · user journeys · AI architecture · implementation roadmap · frozen scope

---

## 0. Read this first — what this is, and what it is not

The original brief described a 15-phase "AI-Powered Revenue Operating System". After auditing the codebase, the honest framing is different, and it is better news:

**A large part of it is already built and running inside OZZO CRM.** The Revenue Engine is not a new product. It is *OZZO pointed at itself*, plus a few genuinely new things — an AI research layer, message generation, and an email channel.

### Already built and live in `wacrm-web`

| Brief phase | What already exists |
|---|---|
| 1. Lead Intelligence Hub | `leads`, `contacts`, activities, custom fields, attachments, import |
| 5. WhatsApp Campaigns | `broadcasts` + Meta Cloud API templates (`src/lib/whatsapp/`) + `inbox` |
| 6. Sales Sequences | the automations engine — step trees, condition eval, event worker (`src/lib/automations/`) |
| 10. Pipeline | `deals` + `pipelines` with stages, plus `/admin/forecast` |
| 11. Campaign Analytics | broadcast status + the 10-report engine (`src/lib/reports/`) |
| 2 / 9 / 13. AI | the Claude client and RAG behind ASK OZZO (`src/lib/ozzo/`) |
| 14. Competitor Intelligence | the 12 `/compare` pages on ozzo.co.in — real content to seed battlecards from |
| Proposals | `/admin/proposals`, founder-only, all 5 plans as content packs, PDF rendering |

### Genuinely not built

Email channel (there is **no** Resend, SendGrid, SES or nodemailer dependency in `package.json` — email today is only Supabase auth SMTP), AI Research Agent, scoring, outreach generation, battlecards as data, country profiles, Prospect Discovery, Meeting Booking, Sales Coach, Website Intelligence, Content Studio.

### Why this does not spec all 15 phases as one build

Fifteen phases as written is roughly 8–12 months. A single approved spec that large does not survive contact with reality — it gets renegotiated weekly until the approval means nothing. So:

- **The architecture below covers the whole engine**, so nothing gets painted into a corner.
- **Only Release 1 is specified to build-ready depth**, and §14 freezes it.
- Later releases are named, ordered and sized — the same way `OZZO_SFA_FUTURE_MODULES.xlsx` works today.

---

## 1. Settled decisions

| # | Decision | Consequence |
|---|---|---|
| D1 | **Founder-only internal tool**, inside `/admin` | No plan gating, no rights registry, no mobile work, no support burden. If it is ever sold, most of it is a rewrite — accepted. |
| D2 | **Operator concept in the schema from day one** | Every company, activity and deal carries `owner_id`. Adding 2–3 telecallers later is granting access, not a migration. |
| D3 | **Source Adapter boundary** — 7 adapters documented, 2 built in R1 | The data-source question never blocks the rest of the engine. |
| D4 | **Generate messages in R1, send them later** | R1 researches, scores **and writes the outreach** — WhatsApp, email, call script, LinkedIn — which you send by hand. *Generation* carries none of sending's cost: no domain, no provider, no warm-up, no Meta policy. |
| D5 | **Spend caps live in the database**, not in code comments | A bug cannot run up a Google or Anthropic bill. |
| D6 | **No LinkedIn adapter. No CAPTCHA or bot-detection bypass, ever.** | Some directories are simply not viable. Written down now rather than discovered later. |
| D7 | **`re_*` tables are fully separate from tenant tables** | Nothing here can touch `contacts`, `leads`, `deals` or any customer's data. The main payoff of D1. |
| D8 | **Channel Provider boundary — all sending is optional and modular** | The engine works forever on the `manual` provider. If you never buy a sending domain, nothing breaks. Added in revision 3. |
| D9 | **Fit and Priority are two different scores, in two different tables** | They answer different questions and are recomputed on different triggers. Added in revision 3. |
| D10 | **Competitor facts are founder-authored, never AI-researched** | Wrong claims about a competitor are a disparagement risk. The AI composes pitches from approved facts only. Added in revision 3. |

### Two constraints that shaped everything

**AI cannot generate a prospect list.** A language model asked for "FMCG distributors in Gujarat with decision makers" produces plausible company names, titles and phone numbers that do not exist. It has no directory inside it. AiSDR's own site claims 700M contacts, never states a source, and gives 300M+ in one place and 700M+ in another — which means the number is marketing, not a spec. What sits behind a database like that is a data-operations business: licensing, contributory networks, bulk purchase, and a team that cleans it. **The AI is the writing and reasoning layer. It is never the collection layer.**

**Cold WhatsApp is a bad first touch.** Messaging businesses that never opted in violates Meta policy and risks the WABA number and its quality rating. WhatsApp is excellent for follow-up *after* a conversation starts, so the engine treats it as a follow-up channel only.

---

## 2. Goals and non-goals

### Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | One place holding every OZZO prospect, no duplicates | Duplicate rate under 2% on `re_companies.dedup_key` |
| G2 | Know which prospects deserve time, before spending it | Every company has a Priority score with visible reasons |
| G3 | Never pitch on an invented fact | 100% of displayed claims carry an evidence URL, or are visibly labelled a guess |
| G4 | Research per company down from ~30 min to under 2 min | Founder's own timing, recorded in the activity log |
| G5 | **One cockpit that runs the day** | Revenue Command Center is the founder's landing page and first screen |
| G6 | Never contact someone who said no | `re_suppressions` checked on every outreach screen and by the generator |
| G7 | Never be stuck on what to say, or which product to pitch | Every qualified company has drafted outreach plus four Fit scores |
| G8 | Walk into every demo prepared | A meeting brief generated from verified claims |
| G9 | **Win against an incumbent, with facts** | Every company with `existing_software` gets a migration pitch from an approved battlecard |
| G10 | **Sell abroad without a compliance accident** | Every non-India company shows its country's consent regime before any outreach is drafted |

### Non-goals for Release 1

No automated email or WhatsApp **sending** — messages are generated and sent by hand · no meeting **booking** (calendar links and reminders are R4; the *brief* is in R1) · no sales coach · no website-visitor intelligence · no content studio · no mobile surface (ever, unless D1 changes) · nothing tenant-facing — no customer sees any of this.

---

## 3. Personas and the permissions matrix

Release 1 has one user. The matrix still defines three human roles and — importantly — **the AI agent as its own principal with its own limits**, because that is where the real risk sits.

### Principals

| Principal | Exists in | Description |
|---|---|---|
| **Founder** | R1 | `sumitvegad07@gmail.com`, via the existing `requireFounder()` in `src/lib/auth/superadmin.ts` |
| **SDR** | R3+ | A telecaller or inside-sales hire; works assigned companies |
| **Agency** | R4+ | Outside freelancer; works assigned companies only, cannot see money |
| **AI Agent** | R1 | The research, scoring and generation jobs, running as a service role |
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
| **Write Fit scores** | override only | no | no | yes | no |
| **Write Priority scores** | **no** | no | no | yes | no |
| View Fit + Priority with reasons | yes | yes | own only | read | no |
| Generate outreach drafts | yes | yes | own only | yes — writes drafts | no |
| Edit / approve an outreach draft | yes | yes | own only | **no** | no |
| Generate a meeting brief | yes | yes | own only | yes — writes briefs | no |
| **Author / edit a battlecard** | **yes — only principal that can** | no | no | **no** | no |
| **Approve a battlecard** | yes | no | no | no | no |
| Generate a migration pitch | yes | yes | own only | yes — writes drafts | no |
| View country profile | yes | yes | yes | read | no |
| Edit country profile | yes | no | no | **no** | no |
| Log an activity | yes | yes | own only | **no** | no |
| View deal value / pipeline total | yes | yes | **hidden** | no | no |
| Create / edit deal, move stage | yes | yes | no | no | no |
| **Generate a proposal draft** | yes | no | no | yes — prefill only | no |
| **Approve / send a proposal** | **yes — only principal that can** | no | no | **no** | no |
| Manage suppressions | yes | add only | add only | no | no |
| Configure source adapters + caps | yes | no | no | no | no |
| Configure channel providers | yes | no | no | no | no |
| Run a source harvest | yes | no | no | no | no |
| View AI / API spend | yes | no | no | no | no |
| Export to CSV | yes | no | no | no | no |
| Any access to tenant tables | yes, via existing `/admin` | no | no | no | n/a |

### The four rules this matrix encodes

1. **The AI agent can never write a business record — only evidence and drafts.** It writes to `re_research_runs`, `re_research_claims`, `re_fit_scores`, `re_priority_scores`, `re_outreach_drafts`, `re_meeting_briefs` and `re_migration_pitches`. It cannot create a company, edit a contact, move a deal, send anything, author a battlecard, or edit a country profile. Drafts are explicitly *drafts*: a human approves before use, and `approved_at` records it. If the model hallucinates, the damage is confined to a row clearly labelled AI output that nobody has acted on.
2. **The founder cannot write a research claim.** Claims are machine-authored and evidence-bearing. A human who disagrees adds a Fit *override* or a company note — the claim history stays honest.
3. **Money is a separate permission from data.** The Agency role sees companies and logs calls, but `value_inr` and the pipeline screen are hidden — enforced in RLS through a restricted view, not by hiding a button.
4. **Competitor facts are founder-only, both ways (D10).** Only the founder can write a battlecard, and the AI can never write one. The AI may *compose a pitch* from an approved battlecard; it may not decide what is true about a competitor.

### Enforcement

- **Route level:** `requireFounder()` on every `/admin/revenue/*` page, exactly as `/admin/proposals` does today.
- **Database level:** RLS on every `re_*` table, via two policy shapes:
  - **Owned tables** (`re_companies`, `re_contacts`, `re_activities`, `re_deals`, and the research / score / draft tables through their company) use `public.re_can_read(owner_id)`. In R1 that helper resolves to "is the founder", so the policy is already correct when SDR rows arrive in R3.
  - **Founder-only tables** (`re_operators`, `re_suppressions`, `re_source_configs`, `re_source_runs`, `re_battlecards`, `re_country_profiles`, `re_channel_configs`) have no `owner_id` and use `public.re_is_founder()` directly. `re_suppressions` gains an insert-only policy for SDR and Agency in R3.
- **Service role:** the AI jobs use the service-role key but are narrowed by `GRANT` to `INSERT` on the seven research / score / draft tables only — **explicitly not** `re_battlecards` or `re_country_profiles`. No blanket service-role access.

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
| A3 | **MCA via data.gov.in** | CIN, legal name, ROC, **paid-up capital**, status, NIC industry code, registered address, directors | **Free** (official Open Government Data API) | Lowest risk of all. Public-record data, official API, no scraping. **Best Fit-scoring source available** — paid-up capital is a real size signal instead of a guess. No emails. |
| A4 | **Google Places API** | Business name, address, **phone**, website, category, by city + category | ~1,000 companies/month free, then up to $40/1,000 | Legal paid API. **This is where contactable data actually comes from.** |
| A5 | **IndiaMART + TradeIndia** | Company name, city, product categories, sometimes GST | Via Apify, ~$3.50–$45 per 1,000 records | **Emails and mobile numbers are gated behind their buyer login and are not publicly scrapable.** You get names and cities, not contactable leads. Rate-limited (HTTP 429 from cloud IPs). Terms prohibit scraping. Useful for *discovering names by product category*, then enriching via A4. |
| A6 | **JustDial** | Local business listings | Via Apify | Actively blocks. Terms breach. Lowest value of the set. **Recommend last, or not at all.** |
| A7 | **Europages + Kompass** | EU/global suppliers — name, phone, email, VAT, employees, country | Via Apify, ~$3.50–$45 per 1,000 | Needed for the international-sales goal. **GDPR applies the moment you email them** (§9, §5.1d). Kompass has no public bulk API. |

### Do not build the scrapers — call maintained ones

Apify already hosts maintained, pay-per-result actors for IndiaMART, TradeIndia, JustDial, Europages, Kompass and the MCA registry, at roughly **$3.50–$45 per 1,000 results**.

**So A5, A6 and A7 are a single adapter** — `apify` — with a per-actor config row. Apify maintains the parsers, handles proxies and blocking, and we call an HTTP API. That gives you every directory you asked for, at cents per lead, with **zero scraper maintenance and no CAPTCHA work** (which D6 forbids anyway).

Honest caveats, recorded so they are not a surprise later:

- Apify actors are third-party. Quality varies and they can break; the adapter must handle a bad run without corrupting the database.
- **Legal responsibility for using the data stays with OZZO** — Apify running the scraper does not transfer the terms breach or the GDPR duty.
- It does not defeat login gating. IndiaMART emails and mobiles remain unavailable (A5 above).

### The recommended source strategy

1. **A3 (MCA, free)** gives the *universe* of real Indian companies plus a true size signal.
2. **A4 (Places, ~free at your volume)** gives the *phone number and website*.
3. **The Research Agent** reads the website and works out the distribution model and product fit.
4. **Scoring** combines all three.

A5/A6/A7 are optional top-ups for categories MCA and Places cover poorly, and for the EU.

### Spend caps (D5)

`re_source_configs` holds `monthly_cap_units` and `monthly_cap_usd` per adapter; `re_source_runs` accumulates usage per calendar month. A run that would cross either cap **fails before making the first external call**, and the Sources screen shows the remaining allowance. Default caps for R2: Places 900 lookups/month (under the ~1,000 free tier), Apify $25/month, MCA unlimited (free).

---

## 5. Database schema

Postgres on the existing Supabase project (Mumbai, `ltigfpywdbfilsagtpyd`). Migrations follow the repo convention `YYYYMMDDHHMMSS_snake_name.sql`. All tables RLS-enabled. Timestamps `timestamptz`; **all date grouping converts to the account timezone (IST), never `toISOString()`** — the DSR "0 visits" bug came from exactly that mistake.

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
The unit of work. **A company, not a contact** — a company has many contacts, one owner, one status, one current Fit set and one current Priority.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | |
| `website` | text | |
| `domain` | text | normalised host, no `www.`, lowercased |
| `country_code` | text | ISO-2 → `re_country_profiles` |
| `state` / `city` | text | |
| `industry` | text | |
| `nic_code` | text | from MCA |
| `cin` | text | MCA company identifier |
| `paid_up_capital` | numeric | from MCA — the real size signal |
| `employee_band` | text | `1-10` … `1000+` |
| `source_adapter` | text not null | `import` \| `inbound` \| `mca` \| `places` \| `apify` |
| `source_ref` / `source_url` | text | |
| `first_seen_at` / `last_refreshed_at` | timestamptz | |
| `owner_id` | uuid | → `re_operators.profile_id` |
| `status` | text | `new` \| `researching` \| `qualified` \| `working` \| `demo` \| `proposal` \| `won` \| `lost` \| `disqualified` |
| `disqualify_reason` | text | |
| **Fit** — product suitability | | |
| `fit_crm` / `fit_wfa` / `fit_sfa` / `fit_fsm` | integer | **0–100 each.** Denormalised from latest `re_fit_scores` |
| `best_fit_line` | text | `crm` \| `wfa` \| `sfa` \| `fsm` — the highest of the four; **the single most actionable field on the record** |
| `fit_computed_at` | timestamptz | |
| **Priority** — who to contact today | | |
| `priority_score` | integer | 0–100, denormalised from latest `re_priority_scores` |
| `priority_band` | text | `today` \| `this_week` \| `later` |
| `priority_computed_at` | timestamptz | |
| **Distribution intelligence** (§5.1a) | | |
| `dealer_count` / `distributor_count` | integer | **better buying signals than employee count** |
| `branch_count` / `depot_count` | integer | |
| `field_force_estimate` | integer | |
| `territory_states` | text[] | |
| `existing_software` | text | the incumbent to displace → drives the migration pitch |
| `tags` | text[] | |
| `notes` | text | |
| `dedup_key` | text not null | **unique** — `domain`, falling back to `slug(name)` + `city` |
| `is_active` | boolean | default `true`; soft delete, matching the repo's pattern |
| `created_at` / `updated_at` | timestamptz | |

Indexes: unique on `dedup_key`; btree on `owner_id`, `status`, `priority_band`, `best_fit_line`, `country_code`, `city`, `domain`, `existing_software`; GIN on `tags`, `territory_states`.

#### `re_contacts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | → `re_companies` on delete cascade |
| `name` / `designation` | text | |
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
| `inputs` / `raw_output` | jsonb | |
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

> **The evidence-or-flag rule.** The UI renders a claim as a fact only when `is_verified` is true, showing the quote and a link. When it is false the claim renders as **"AI guess — unverified"** in muted styling and is excluded from scoring, outreach drafts, meeting briefs and migration pitches. Without this rule the Research Agent becomes a confident liar: it writes "I see you have 125 field reps", the prospect says "we have 11", and the meeting is over. Same discipline already applied to ROI figures in the brochures.

### 5.1a Claim keys — distribution and territory intelligence

A closed list, because OZZO's buyers are agri, seeds, fertiliser, pumps and manufacturing — **not SaaS**. For these companies employee count is a poor signal and often actively misleading: a 40-person fertiliser business with 200 dealers and 25 field reps is a far better SFA prospect than a 300-person software firm. The claim keys are built around **distribution and field presence**, not headcount.

| Group | Claim keys | Why it matters |
|---|---|---|
| **Distribution** | `dealer_count`, `distributor_count`, `channel_model` (direct / dealer / distributor / hybrid), `distributor_named` | The core OZZO buying signal. Dealers imply field reps, which imply SFA. |
| **Field presence** | `field_force_estimate`, `branch_count`, `depot_count`, `warehouse_count` | Reps to manage = the product. |
| **Territory** | `territory_states`, `territory_districts`, `export_markets` | Multi-state operation implies territory hierarchy and route planning. |
| **Service footprint** | `installed_base_signal`, `service_network`, `amc_offered`, `spare_parts_network` | **The FSM signal.** A pump or machinery maker with an installed base needs FSM — something employee count would never reveal. |
| **Workforce** | `team_size`, `shift_work_signal`, `attendance_pain_signal` | The WFA signal. |
| **Company** | `products`, `locations`, `industry_detail`, `turnover_signal`, **`existing_software`** | `existing_software` flags the incumbent and triggers the migration pitch (§5.1c). |
| **Pain** | `pain_point` (repeatable) | Each one needs its own evidence quote. |
| **Fit reasons** | `crm_fit_reason`, `wfa_fit_reason`, `sfa_fit_reason`, `fsm_fit_reason` | One sentence per line, explaining that line's score |

Numeric claims mirror onto `re_companies` **only when `is_verified` is true**, so the list view can filter and sort on them without re-reading claims.

### 5.1b Scoring — two tables, because they answer two questions (D9)

Keeping these separate was a founder-review correction, and there is a technical reason beyond tidiness: **they are recomputed on different triggers.** Fit changes only when research changes. Priority changes every day and after every activity. Two write frequencies, two tables.

#### `re_fit_scores` — product suitability

Written once per research run. Answers: **what do I pitch?**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `research_run_id` | uuid | which research produced it |
| `rules_version` | text not null | the scoring rules version, not the LLM |
| `fit_crm` / `fit_wfa` / `fit_sfa` / `fit_fsm` | integer | 0–100 each |
| `best_fit_line` | text | the highest of the four |
| `reasons` | jsonb | one sentence per line, from the `*_fit_reason` claims |
| `inputs` | jsonb | every input value, so a score is reproducible |
| `is_override` | boolean | true when the founder set it by hand |
| `override_reason` | text | |
| `computed_at` | timestamptz | |

Fit inputs, per §5.1a: dealer and distributor counts and field force → **SFA** · installed base, service network, AMC, spare-parts network → **FSM** · team size, shift and attendance signals → **WFA** · everything else plus `existing_software` → **CRM**.

#### `re_priority_scores` — who to contact today

Recomputed nightly and after every activity. Answers: **who do I call now?**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `rules_version` | text not null | |
| `total` | integer | 0–100 |
| `band` | text | `today` ≥ 70 \| `this_week` 40–69 \| `later` < 40 |
| `components` | jsonb | each contribution, so the cockpit can show *why* this is today's top call |
| `computed_at` | timestamptz | |

Priority components — deterministic, no LLM:

| Component | Contribution |
|---|---|
| Follow-up due today or overdue | +30 |
| Recent inbound signal (form, reply) | +25 |
| Engagement (answered a call, replied) | +20 |
| Fit magnitude — `best_fit_line` score scaled | up to +15 |
| Never contacted **and** high fit | +10 |
| Decay — per day since last touch beyond 14 days | −1, floor 0 |
| Suppressed, disqualified or inactive | **excluded entirely** |

#### `re_outreach_drafts`
What to say. Generated on demand per company, **never sent by the engine in R1** — you copy it out and send it yourself.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `contact_id` | uuid | who it is addressed to |
| `channel` | text not null | `whatsapp` \| `email` \| `call_script` \| `linkedin` |
| `variant` | text | `first_touch` \| `follow_up_1` \| `follow_up_2` \| `breakup` \| **`migration`** |
| `pitch_line` | text | which product line this pitches — from `best_fit_line` |
| `battlecard_id` | uuid | set when `variant = 'migration'` → `re_battlecards` |
| `subject` | text | email only |
| `body` | text not null | |
| `claims_used` | uuid[] | **the exact verified claims this leaned on** — so every sentence traces to a source |
| `research_run_id` | uuid | |
| `model` / `prompt_version` | text | |
| `cost_usd` | numeric(10,4) | |
| `approved_at` / `approved_by` | timestamptz / uuid | null until a human approves |
| `edited_body` | text | the human's edit, kept separately from the AI's original |
| `sent_manually_at` | timestamptz | set when you mark it sent; writes a `re_activities` row |
| `created_at` | timestamptz | |

Rules: a draft may cite **only** claims where `is_verified = true`. The generator is handed the suppression list and the contact's `opted_out_at`, and refuses to draft for a suppressed contact. It is also handed the country profile (§5.1d) and refuses email drafts for a country whose `requires_prior_consent` is true, unless `consent_basis = 'consent'`. **A WhatsApp draft is free text for manual sending — not a Meta-approved template** (§6.7).

#### `re_meeting_briefs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `deal_id` | uuid | |
| `summary` | text | company in three lines |
| `pain_points` | jsonb | each with its evidence |
| `likely_objections` | jsonb | objection + suggested response; **incumbent objections come from the battlecard** |
| `demo_flow` | jsonb | ordered screens to show, driven by `best_fit_line` |
| `questions_to_ask` | jsonb | discovery questions |
| `claims_used` | uuid[] | verified claims only |
| `battlecard_id` | uuid | when an incumbent is known |
| `model` / `prompt_version` | text | |
| `cost_usd` | numeric(10,4) | |
| `generated_for` | timestamptz | the meeting it was prepared for |
| `created_at` | timestamptz | |

### 5.1c Competitor intelligence (new in revision 3)

#### `re_battlecards` — founder-authored, never AI-written (D10)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `competitor_key` | text not null unique | `koops` \| `beatroute` \| `salesdiary` \| `fieldassist` \| … |
| `display_name` | text not null | |
| `category` | text | which OZZO line it competes with |
| `positioning` | text | how they sell themselves, in one paragraph |
| `our_differentiators` | jsonb | array of `{claim, proof_source}` — **`proof_source` required**, pointing at an OZZO feature, screenshot or `/compare` page |
| `their_strengths` | jsonb | **honest.** A battlecard that pretends a competitor has no strengths gets you ambushed in a demo. |
| `objection_responses` | jsonb | array of `{objection, response}` |
| `migration_notes` | text | what switching from them actually involves — data, retraining, contract timing |
| `pricing_notes` | text | only what is publicly stated; **no speculation** |
| `source_urls` | jsonb | where each fact came from — including your own `/compare` pages |
| `is_approved` | boolean | default `false`; **an unapproved battlecard cannot be used by any generator** |
| `approved_by` / `approved_at` | uuid / timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

**Seeding:** the 12 existing `/compare` pages on ozzo.co.in are the source for the first battlecards. That content is already written and already yours, so R1 seeds rather than invents.

**Guardrail (D10):** the AI cannot insert or update this table — enforced by `GRANT`, not convention. Every factual claim about a competitor is written and approved by the founder. Claims about a competitor's weaknesses that turn out to be false are a disparagement risk, and unlike a product fact there is no page to quote. `their_strengths` is mandatory precisely so the cards stay usable rather than becoming marketing fiction.

#### `re_migration_pitches`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `battlecard_id` | uuid not null | must be `is_approved = true` |
| `why_switch` | text | from approved differentiators plus this company's verified pain points |
| `switching_plan` | text | from `migration_notes`, shaped to this company's size |
| `objection_prep` | jsonb | the battlecard's responses, ranked for this company |
| `claims_used` | uuid[] | verified claims only |
| `model` / `prompt_version` / `cost_usd` | | |
| `approved_at` / `approved_by` | | null until reviewed |
| `created_at` | timestamptz | |

### 5.1d International market intelligence (new in revision 3)

#### `re_country_profiles` — curated reference data, not AI output

Seeded for the countries you actually sell into, then extended as needed.

| Column | Type | Notes |
|---|---|---|
| `country_code` | text pk | ISO-2 |
| `display_name` | text not null | |
| **Legal — the part that matters** | | |
| `consent_regime` | text | `legitimate_interest` \| `prior_consent_required` \| `opt_out_only` \| `unknown` |
| `requires_prior_consent` | boolean | **hard gate.** True blocks email drafting unless `consent_basis = 'consent'` |
| `regulation_names` | text[] | e.g. `{GDPR, UWG}` for Germany |
| `opt_out_required` | boolean | |
| `data_retention_note` | text | |
| `legal_source_urls` | jsonb | **required** — where each legal fact came from |
| **Operational** | | |
| `timezone` | text | |
| `business_hours_local` | text | so you do not call at 3am their time |
| `working_days` | text[] | e.g. Sunday–Thursday in parts of the Gulf |
| `primary_languages` | text[] | |
| `currency_code` | text | |
| `public_holidays` | jsonb | |
| **Guidance — explicitly not fact** | | |
| `outreach_guidance` | text | professional norms: preferred channel, formality of address, typical decision cycle |
| `guidance_is_unverified` | boolean | **default `true`, and the UI always labels it** (§6.6) |
| `market_context` | text | OZZO-relevant notes — field-sales maturity, competitor presence |
| `updated_by` / `updated_at` | uuid / timestamptz | |

**Why the split matters.** The legal and operational fields are checkable facts with sources, and the engine *enforces* them — `requires_prior_consent` is a hard gate on drafting, not advice. The guidance fields are soft and have no evidence URL, so they are always labelled unverified and never used to make a decision. See §6.6 for the reasoning.

**R1 seed:** India, plus the EU countries reachable through A7 — with **Germany and Austria flagged `prior_consent_required`** (the German UWG requires prior consent for commercial email even when GDPR is satisfied), and the UK, Ireland, France, Netherlands, Spain and Italy on `legitimate_interest`.

### 5.1e Proposal workflow (first-class in revision 3)

#### `re_proposals`
The workflow state. **Rendering stays in the existing `/admin/proposals` builder** — this table tracks the lifecycle and the handoff, and does not duplicate the generator.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `deal_id` | uuid not null | |
| `proposal_ref` | uuid | the record in the existing proposal builder |
| `stage` | text not null | `draft` \| `in_review` \| `approved` \| `sent` \| `accepted` \| `rejected` \| `expired` |
| `plan_id` | text | a `PlanId` from `src/lib/plans/catalog.ts`, defaulting to `best_fit_line` |
| `users_count` | integer | |
| `billing_term` | text | `quarterly` \| `half_yearly` \| `yearly` |
| `value_inr` | numeric | **from `quote()`, never hand-entered** |
| `ai_prefill` | jsonb | what the AI suggested: pain points, fit reasoning, migration angle |
| `claims_used` | uuid[] | verified claims only |
| `review_notes` | text | |
| `sent_at` / `sent_by` | timestamptz / uuid | |
| `decision_at` | timestamptz | |
| `rejection_reason` | text | |
| `valid_until` | date | |
| `created_at` / `updated_at` | timestamptz | |

**The workflow, enforced as a state machine:**

```
Lead  ->  Demo  ->  Proposal Draft  ->  Review  ->  Send  ->  Accepted / Rejected
         (brief)   (AI prefill)      (founder)   (founder   (writes back to
                                                  only)      re_deals.stage)
```

Rules: a proposal can only be created from a deal at stage `demo` or later · only the founder can move `in_review → approved → sent` (§3) · `sent` requires `approved_at` · moving to `accepted` sets the deal to `won` and writes a `re_activities` row · `value_inr` is recomputed by `quote()` on every stage change, so the proposal and the pipeline can never disagree.

#### `re_activities`
Every touch. In R1 these are hand-logged, or written automatically when you mark a draft sent or move a proposal stage; from R2 the channels write here too.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | |
| `contact_id` | uuid | |
| `owner_id` | uuid not null | |
| `type` | text | `call` \| `whatsapp` \| `email` \| `meeting` \| `note` \| `status_change` \| `proposal_event` |
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
| `plan_id` | text | a `PlanId`; **defaults to `best_fit_line`** |
| `users_count` | integer | |
| `billing_term` | text | |
| `value_inr` | numeric | **computed by `quote()` in `src/lib/plans/pricing.ts`, never hand-entered** |
| `stage` | text | `discovery` \| `demo` \| `proposal` \| `negotiation` \| `won` \| `lost` |
| `probability` | integer | |
| `expected_close` | date | |
| `lost_reason` | text | |
| `competitor_lost_to` | text | → `re_battlecards.competitor_key`, so losses feed the battlecards |
| `owner_id` | uuid not null | |
| `created_at` / `updated_at` | timestamptz | |

#### `re_suppressions`
Global do-not-contact. **In R1 even though nothing sends** — so that when someone says no during a manual call, they are off every future list permanently.

`channel` (`email` \| `phone` \| `whatsapp` \| `domain` \| `all`) · `value` (normalised, unique with `channel`) · `reason` (`opt_out` \| `bounce` \| `complaint` \| `competitor` \| `existing_customer` \| `manual`) · `note` · `created_by` · `created_at`.

#### `re_source_configs` and `re_source_runs`

`re_source_configs`: `adapter_key` (unique), `display_name`, `is_enabled`, `credentials_ref` (env var name — **never the secret itself**), `default_params` jsonb, `monthly_cap_units`, `monthly_cap_usd`, `apify_actor_id`.

`re_source_runs`: `adapter_key`, `params` jsonb, `records_found`, `records_new`, `records_duplicate`, `records_rejected`, `units_used`, `cost_usd`, `status`, `error`, `started_at`, `finished_at`, `created_by`.

#### `re_channel_configs` — the Channel Provider boundary (D8, new in revision 3)

Sending is optional and modular. The engine runs forever on `manual`; every other provider is a row that can stay disabled.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `channel` | text not null | `email` \| `whatsapp` \| `sms` |
| `provider_key` | text not null | `manual` \| `smartlead` \| `instantly` \| `meta_whatsapp` |
| `is_enabled` | boolean | **default `false` for everything except `manual`** |
| `credentials_ref` | text | env var name only |
| `config` | jsonb | domain, mailbox ids, WABA id |
| `daily_cap` | integer | per-mailbox send cap (§9) |
| `monthly_cap_usd` | numeric | |
| `created_at` / `updated_at` | timestamptz | |

```
ChannelProvider.send(draft) -> { external_ref, status }

  manual         (R1, always available, no credentials — you send, we record)
  smartlead      (R2, optional)
  instantly      (R2, optional)
  meta_whatsapp  (R3, optional, templates only — §6.7)
```

The `manual` provider is not a stub: it marks the draft sent, writes the activity, and advances priority. **Nothing in R1 depends on a paid provider existing.** If you never enable one, the engine is fully functional — it just means you keep pressing send yourself.

### 5.2 Later-release tables (named now, not built)

`re_sequences`, `re_sequence_steps`, `re_enrollments` (R3) · `re_email_identities`, `re_email_messages`, `re_email_events` (R2) · `re_campaigns` (R3) · `re_meetings` (R4) · `re_web_sessions` (R5) · `re_content_assets` (R6).

### 5.3 Migrations for Release 1

| File | Contents |
|---|---|
| `20261002120000_revenue_engine_core.sql` | `re_operators`, `re_companies`, `re_contacts`, indexes, `updated_at` triggers, `re_can_read()` / `re_is_founder()` helpers, RLS |
| `20261002120100_revenue_engine_research.sql` | `re_research_runs`, `re_research_claims` (closed claim-key check per §5.1a), the `is_verified` generated column |
| `20261002120150_revenue_engine_scoring.sql` | `re_fit_scores`, `re_priority_scores`, denormalisation triggers onto `re_companies` |
| `20261002120200_revenue_engine_generation.sql` | `re_outreach_drafts`, `re_meeting_briefs`, `re_migration_pitches`, the verified-claims-only constraint, narrowed service-role grants |
| `20261002120250_revenue_engine_intelligence.sql` | `re_battlecards`, `re_country_profiles` — **with the AI explicitly denied write access**; seeds the 4 named competitors and the R1 country list |
| `20261002120300_revenue_engine_pipeline.sql` | `re_activities`, `re_deals`, `re_proposals` + the stage state machine, `re_suppressions` |
| `20261002120400_revenue_engine_config.sql` | `re_source_configs`, `re_source_runs`, `re_channel_configs`, the cap-check function, seed rows (only `import`, `inbound` and `manual` enabled) |
| `ROLLBACK-revenue-engine.md` | Matching rollback notes, as every other module in this repo has |

---

## 6. AI architecture

### 6.1 Model and cost

The repo already has an Anthropic client at `src/lib/ozzo/claude.ts` using `claude-sonnet-5`, and `@anthropic-ai/sdk ^0.122.0` is installed. The Revenue Engine adds a second, separate client — it must not share ASK OZZO's prompt or rate budget.

**Recommended model: `claude-opus-5-5`** ($4 per million input tokens, $20 per million output).

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

**Research runs as an overnight Batch job.** Research is never latency-sensitive — you read it next morning, and the Batch API halves the bill for free. A "Research now" button exists for single companies and uses a live streaming call.

Model choice is yours; `re_research_runs.model` is per-row, so nothing depends on it. I recommend starting on Opus 5.5, measuring the claim-verification rate for a month, and stepping down only if the cheaper model holds that rate.

### 6.2 How the Research Agent works

```
  company (name + website + MCA facts)
            |
      [1] web_search_20260209   -- find the site if we only have a name
      [2] web_fetch_20260209    -- homepage, about, products, dealers, service, contact
            |  max_content_tokens caps the spend per page
      [3] one Claude call, structured output, strict closed-key schema (§5.1a)
            |
      [4] every claim must carry evidence_url + evidence_quote, or be returned null
            |
      [5] write re_research_runs (immutable) + re_research_claims
      [6] Fit scoring reads ONLY claims where is_verified = true
```

- **Anthropic's server-side `web_fetch` does the reading.** No scraper to build for website research, and `max_content_tokens` caps per-page cost. `web_fetch` only fetches URLs already in the conversation, so the website is always passed explicitly.
- **Structured output with a strict schema.** The response is validated before anything is written. A malformed response or an unknown claim key fails the run; it never writes a partial record.
- **The prompt instructs the model that a claim without a supporting quote must be returned with `evidence_url: null`,** rather than omitted or invented. Being allowed to say "I am guessing" is what stops it guessing silently.
- **`prompt_version` is stored on every run**, so old research stays interpretable when the prompt changes.

### 6.3 Prompt caching — and an honest limit

Caching is a prefix match: `tools` → `system` → `messages`. The stable prefix is the OZZO fit rules and claim schema (~4K tokens), behind a `cache_control` breakpoint.

**Be realistic: caching saves little on this workload.** Most tokens are each company's own fetched pages, unique every time, so there is nothing to reuse. Caching the 4K prefix saves about $0.015 per company — real, but not the lever. **The Batch API is the lever** (50%); `max_content_tokens` is second.

Where caching genuinely pays: multi-step runs within one company, where fetched pages are reused across turns. Verify with `usage.cache_read_input_tokens` — if it is zero across repeated runs, something volatile has leaked into the prefix.

### 6.4 Guardrails

| Risk | Control |
|---|---|
| Invented facts about a prospect | The evidence-or-flag rule; unverified claims excluded from scoring and every generator |
| **Invented facts about a competitor** | **D10 — the AI cannot write `re_battlecards`, enforced by `GRANT`. Only approved cards reach a generator.** |
| **Unverifiable cultural claims** | §6.6 — guidance fields labelled unverified; only the legal fields are enforced |
| Runaway spend | `re_source_configs` and `re_channel_configs` monthly caps; a per-month AI budget checked before each batch; `max_content_tokens` per fetch |
| AI writing business records | Service-role `GRANT` limited to the seven research / score / draft tables (§3) |
| Prompt injection from a prospect's website | Fetched page content is **data, never instruction**. The system prompt states that page text cannot change the task, and the output schema is strict, so an injected instruction has nowhere to land. |
| Model refusal | `status = 'refused'` is a first-class outcome, surfaced in the UI, not retried in a loop |
| Silent model drift | `model` + `prompt_version` + `effort` on every run; a weekly verification rate on the Spend screen |

### 6.5 The agents in Release 1

All of them share one hard rule: **they read only claims where `is_verified = true`.** This is what makes the evidence rule protect the outreach, not just the research screen.

| Agent | Runs | Reads | Writes | Cost |
|---|---|---|---|---|
| **Research Agent** | Overnight batch, per new company | `web_search` + `web_fetch` | runs + claims | ~$0.08 / company (batched) |
| **Fit Scoring** | After every research run | verified claims + MCA fields | `re_fit_scores` | **$0 — no LLM** |
| **Priority Scoring** | Nightly + after every activity | activities, follow-ups, fit, inbound | `re_priority_scores` | **$0 — no LLM** |
| **Outreach Generator** | On demand, per company you work | verified claims + `best_fit_line` + suppressions + country profile | `re_outreach_drafts` | ~$0.02 / set of 4 |
| **Migration Pitch** | On demand, when `existing_software` is known | verified claims + **approved** battlecard | `re_migration_pitches` | ~$0.02 |
| **Meeting Brief** | On demand, before a meeting | verified claims + activity history + battlecard | `re_meeting_briefs` | ~$0.02 |
| **Proposal Prefill** | On demand, from a deal at `demo`+ | verified claims + fit + plan + `quote()` | `re_proposals.ai_prefill` | ~$0.01 |

**Cost impact of the generators is small**, because they run on demand per company you actually work, and you will work far fewer companies than you research. Research remains the bulk of the bill.

### 6.6 Why country guidance is labelled, not enforced

The founder review asked for country profiles including "communication style and market context". That request splits cleanly in two, and the split matters:

- **The legal and operational half is factual and checkable** — consent regime, whether prior consent is required, time zone, business hours, working days, language, currency, holidays. Each field carries `legal_source_urls`. The engine **enforces** these: `requires_prior_consent = true` is a hard gate that blocks email drafting, not a tip.
- **The "communication style" half has no evidence URL.** There is no page to quote for "Germans prefer formal email." An AI asked to produce it generates confident generalisations about nationalities — which is both the invented-fact problem the evidence rule exists to prevent, and a stereotyping risk.

So: `outreach_guidance` and `market_context` exist as requested, are **founder-editable**, default to `guidance_is_unverified = true`, are **always labelled unverified in the UI**, and are **never inputs to a score or a gate**. They can inform how you write; they cannot decide anything. Guidance is kept to professional norms (preferred channel, formality of address, typical decision cycle) rather than cultural claims.

### 6.7 One constraint on generated WhatsApp messages

A generated WhatsApp draft is **free text for you to send by hand**. It is *not* a Meta-approved template. Outside the 24-hour customer-service window, the Cloud API requires a pre-approved template with variables, not free text.

Fine for R1 — you copy and send. But **R3 cannot simply automate these drafts**: they will have to be restructured as approved templates with variable slots and submitted for Meta review. Recorded now so nobody assumes R1's output is R3-ready. The existing `src/lib/whatsapp/template-*` code already handles template structure and the approval lifecycle, so this is known, bounded work — not a surprise.

### 6.8 Later AI features

- **Sales Coach (R4)** — a prompt over verified claims plus approved battlecards. No new data access.
- **Meeting *booking* (R4)** — calendar links, scheduling, reminders. The infrastructure half; the *brief* shipped in R1.
- **Content Studio (R6)** — marketing copy, nothing publishes without founder review (the existing brochure discipline).

---

## 7. Navigation structure

Module names follow the founder's review: **Prospect Hub · Research Agent · Outreach Studio · Pipeline · Campaign Center · Revenue Command Center.** Routes stay under `/admin/revenue/*`, in the founder-only nav group in `src/app/(superadmin)/admin/admin-shell.tsx`.

### The Command Center is the founder's landing page — with one caution

**This touches shared code, so it is scoped tightly.** Post-login landing today is `/dashboard` (the plan-aware dashboard) for every user. Making `/admin/revenue` the landing page is a **founder-only redirect**, gated on the same founder check, and it must not change where anybody else lands. It gets:

- a redirect only when the signed-in email passes the founder check,
- a one-click "go to my CRM dashboard" link so the normal app is never more than one click away,
- **a test asserting that a non-founder user still lands on `/dashboard`.**

This is the only item in Release 1 that reaches outside `/admin`, which is why it is called out rather than buried.

### Routes

| Module | Path | Screen | Release |
|---|---|---|---|
| **Revenue Command Center** | `/admin/revenue` | **The cockpit — founder landing page** | R1 |
| Prospect Hub | `/admin/revenue/companies` | List: filter by priority band, **fit line**, status, owner, country, city, dealer count, incumbent, source | R1 |
| Prospect Hub | `/admin/revenue/companies/[id]` | Company detail — the workhorse, seven tabs | R1 |
| Prospect Hub | `/admin/revenue/companies/import` | Spreadsheet import (Universal Import Framework) | R1 |
| Outreach Studio | `/admin/revenue/companies/[id]/outreach` | Generate and edit the 4 channel drafts | R1 |
| Outreach Studio | `/admin/revenue/companies/[id]/brief` | Meeting brief | R1 |
| Pipeline | `/admin/revenue/pipeline` | Deals by stage, value from the pricing engine | R1 |
| Pipeline | `/admin/revenue/proposals` | **Proposal workflow board** — draft / review / sent / decided | R1 |
| Pipeline | `/admin/revenue/suppressions` | Do-not-contact list | R1 |
| Campaign Center | `/admin/revenue/battlecards` | **Competitor battlecards, founder-authored** | R1 |
| Research Agent | `/admin/revenue/countries` | **Country profiles and consent regimes** | R1 |
| Research Agent | `/admin/revenue/sources` | Adapters, caps, run history | R1 read-only → R2 runnable |
| Research Agent | `/admin/revenue/channels` | **Channel providers — all optional, `manual` default** | R1 read-only → R2 runnable |
| Research Agent | `/admin/revenue/spend` | AI + API spend, claim-verification rate | R1 |
| Campaign Center | `/admin/revenue/sequences` | Sequence builder | R3 |
| Campaign Center | `/admin/revenue/campaigns` | Email + WhatsApp campaigns and analytics | R3 |

**Company detail, seven tabs:** **Facts** (verified claims with quotes; guesses separated below) · **Fit** (four scores with reasons — what to pitch) · **Contacts** · **Outreach** (drafts, plus the migration pitch when an incumbent is known) · **Timeline** · **Deal** · **Proposal**.

### The cockpit, specified

`/admin/revenue` is the operational screen, not a vanity dashboard. Six blocks, in this order:

1. **Today's calls** — companies at `priority_band = 'today'`, ranked, each showing *why* it is there (from `re_priority_scores.components`), the best fit line, and the incumbent if known.
2. **Needs a decision** — proposals in `in_review`, deals stalled past expected close, drafts generated but never approved.
3. **Overnight results** — research finished, new scores, newly qualified companies, anything `refused` or `failed`.
4. **Follow-ups due** — from `re_activities`, in account-local time.
5. **Pipeline snapshot** — value by stage from `quote()`, win/loss this month, losses by competitor.
6. **Health** — AI spend against budget, source caps remaining, **claim-verification rate**, suppression adds this week.

Every block links straight into the action. The target in G5 is that the first click of the day is already the right one.

---

## 8. User journeys

### J1 — Morning cockpit (daily, R1)
Founder logs in and lands on `/admin/revenue`. Today's calls are ranked with reasons. **Success: under 60 seconds from login to dialling.**

### J2 — Bring in a list (R1)
Upload a spreadsheet at `/admin/revenue/companies/import` → map columns → the engine normalises, computes `dedup_key`, rejects duplicates and anything suppressed, and reports **reasons** for every rejected row (the import-failure-reasons pattern already in the app). Accepted rows land `status = new` and queue for overnight research.

### J3 — Research runs overnight (R1)
The nightly job takes every `status = new` company with a website, submits one Batch request, and writes runs and claims on completion. Morning: `researching → qualified`, with Fit scores and a Priority. **Failures are visible, never silent.**

### J4 — Judge a company, and know what to pitch (R1)
The Facts tab shows verified claims each with its quote and source link — "200 dealers across 6 states" next to the sentence it came from. Guesses sit below, greyed, labelled unverified. The Fit tab shows **SFA 92 · FSM 80 · CRM 35 · WFA 20**, each with its reason. **No number appears without a source.**

### J5 — Generate the outreach (R1)
One click produces four drafts — WhatsApp, email, cold-call script, LinkedIn — pitching `best_fit_line` and citing only verified claims. Each lists the claims it used, so every sentence traces to a source. Founder edits (stored separately from the AI's original), copies out, sends personally. Marking it sent writes an activity and updates Priority. **A suppressed contact cannot be drafted for, and a `prior_consent_required` country blocks the email draft.**

### J6 — Beat the incumbent (R1, new in revision 3)
Research found `existing_software = FieldAssist`. The Outreach tab offers **"Generate migration pitch"**, which composes from the *approved* FieldAssist battlecard plus this company's verified pain points: why switch, what switching involves, and ranked objection responses. **If the battlecard is not approved, the button is disabled** — the engine will not improvise about a competitor.

### J7 — First contact, by hand (R1)
Founder calls using the generated script, logs an activity with an outcome. If interested, status → `working`, follow-up set. Suppression status is shown before the call.

### J8 — Prepare for the demo (R1)
One click generates the brief: company in three lines, pain points with evidence, likely objections (incumbent objections from the battlecard), a demo flow ordered by `best_fit_line`, discovery questions. Read in two minutes on the way to the call. **Verified claims only.**

### J9 — Someone says no (R1)
Outcome `not_interested` prompts a one-click suppression add. That phone, email and domain are off every future list permanently, and the generator refuses to draft for them.

### J10 — Proposal, as a tracked workflow (R1, first-class in revision 3)
From a deal at `demo` or later: **Generate proposal draft.** `plan_id` defaults to `best_fit_line`, so the research decides what you quote; `value_inr` comes from `quote()`. The AI prefills pain points, fit reasoning and the migration angle from verified claims. The proposal moves `draft → in_review → approved → sent`, visible on the proposal board, **with only the founder able to approve or send**. Rendering is the existing `/admin/proposals` builder — this adds the lifecycle, not a second generator. `accepted` sets the deal to `won`; `rejected` records a reason and, if lost to a competitor, feeds `competitor_lost_to` back to the battlecards.

### J11 — Selling into a new country (R1, new in revision 3)
A Europages-sourced German company opens. The country panel shows **prior consent required (UWG)** before anything else, and **email drafting is blocked** unless the contact's `consent_basis = 'consent'`. Business hours, language and currency are shown so you call at a sane hour. Outreach guidance appears, clearly labelled unverified.

### J12 — Weekly review (R1)
`/admin/revenue/spend`: companies added, researched, qualified; activities; pipeline value; losses by competitor; AI spend against budget; **claim-verification rate** — the health metric for the whole AI layer.

### Later journeys
J13 enrol in a sequence (R3) · J14 handle an email reply and auto-pause a sequence (R3) · J15 book a meeting with calendar links (R4) · J16 identify an inbound visitor's company (R5).

---

## 9. Compliance and non-functional requirements

### Email — a serious, specific warning

**Resend, SendGrid and Amazon SES all prohibit cold outreach in their terms.** Resend's acceptable-use policy requires recipient consent; SendGrid suspends cold-outreach accounts without warning; AWS documentation says to send only to recipients who explicitly requested mail. Thresholds are tight — SES goes under review at 5% bounces or 0.1% complaints.

**OZZO already uses Resend for `ozzo.co.in` mail, with Supabase custom SMTP.** That is the same path that sends **password resets and auth mail for every tenant**. If cold outreach went through it and the account were suspended, password reset breaks for all customers. That is a production outage caused by a marketing decision.

**Therefore, non-negotiably, when sending is enabled (R2):**

1. **A separate sending domain** (e.g. `ozzocrm.in`), never `ozzo.co.in`.
2. **A separate provider built for outreach** — Smartlead (from ~$39/month) or Instantly (from ~$47/month), not Resend/SendGrid/SES.
3. **Separate mailboxes:** 2–3 per domain, each capped at **30–50 emails/day** (`re_channel_configs.daily_cap`), with a 14–21 day warm-up before the first real send. Google's technical limit is 2,000/day; exceeding ~50 cold sends per mailbox damages reputation regardless.
4. `re_email_identities` records which domain and mailbox each message used, so a reputation problem traces to one identity and is isolated.

**D8 makes all of this optional.** Nothing in R1 depends on it. If you never enable a provider, the engine runs on `manual` forever.

### Data protection

- **EU:** B2B cold email is lawful under GDPR **legitimate interest** (Art. 6(1)(f)) when the recipient is a business, the message is relevant to their role, opt-out is simple, and **the legitimate-interest assessment is documented**. `re_contacts.consent_basis` records the basis per contact; `re_country_profiles.legal_source_urls` holds the assessment per country.
- **Germany and Austria require prior consent** under the German UWG even with GDPR satisfied. This is **enforced in code**, not documented: `requires_prior_consent = true` blocks email drafting for those contacts (§5.1d).
- **India (DPDP Act):** suppression and opt-out plumbing exist from R1.
- **Terms of service:** using Apify does not transfer the breach. A5/A6/A7 are a commercial-risk decision the founder takes knowingly; recorded here rather than buried.
- **Competitor claims:** D10 keeps every factual claim about a competitor founder-authored and sourced, which is as much a legal control as an accuracy one.

### Other non-functional requirements

| Area | Requirement |
|---|---|
| Security | `requireFounder()` on every route; RLS on every table; no secret in the database — `credentials_ref` holds the env var name only |
| Tenant isolation | No `re_*` table references a tenant table; no tenant query touches `re_*`. Verified by a test. |
| **Landing-page safety** | A test asserts a non-founder user still lands on `/dashboard` (§7) |
| Dates | All grouping converts `timestamptz` to the account timezone (IST). Never `toISOString()`. |
| Retention | Prospect data kept while active; research runs 2 years; source-run logs 90 days — matching `src/lib/retention` |
| Cost ceiling | Hard monthly caps per source adapter and channel provider, plus an AI budget, enforced before the external call |
| Tests | Vitest, `src/**/*.test.ts` only (`*.spec.ts` is not picked up). Required: dedup key · suppression check · cap enforcement · Fit computation · Priority computation · the evidence-or-flag rule · claim-schema validation · generators refuse unverified claims · generators refuse suppressed contacts · **email drafting blocked for `prior_consent_required` countries** · **generators refuse unapproved battlecards** · proposal state machine · non-founder landing page |
| Honesty rules | The repo's absolute rules apply: no fabricated stubs, no generated reports asserting results that were not measured, no `any` without a justifying comment |

---

## 10. Implementation roadmap

### Release 1 — the operational engine

**Goal:** research and score real companies, know what to pitch, have the message written, beat the incumbent, run a tracked proposal, and work it all from one cockpit.

**Estimate: 7–8 weeks.** Revised from 5–6 weeks by revision 3. The six additions cost roughly 11 working days: proposal workflow 2 · competitor intelligence 3 · Fit/Priority split 1 · cockpit + landing redirect 2 · country profiles 2 · channel boundary 1.

**That is close to double the original 3–4 weeks**, so §14 offers a split. See it before freezing.

### Release 2 — Real data sources + optional sending
MCA adapter (A3, free), Google Places (A4) with caps, Apify (A5/A6/A7) per-actor; then **optionally** the sending domain, provider, mailboxes, warm-up, `re_email_identities` / `_messages` / `_events`, and email verification. **Covers brief phase 4 and part of 5. ~4 weeks, plus 2–3 weeks of warm-up waiting that runs in parallel.**

### Release 3 — Sequences and campaigns
Sequence builder over the existing automations engine; email + WhatsApp campaigns (WhatsApp follow-up only, and templates per §6.7); reply detection auto-pausing a sequence; campaign analytics on the existing report engine. **Covers phases 5, 6, 11. ~4 weeks.**

### Release 4 — Meeting booking and coach
Calendar links, demo scheduling, auto-reminders; sales coach over verified claims and approved battlecards. **The demo brief already shipped in R1.** **Covers phases 7, 9. ~2 weeks.**

### Release 5 — Website intelligence
Analytics and lead capture — **not visitor identification**, which the original brief itself cautioned against. **Battlecards already shipped in R1.** **Covers phase 12. ~1.5 weeks.**

### Release 6 — Content Studio
Campaign, LinkedIn, blog and case-study drafting, founder review before anything publishes. **Covers phase 13. ~2 weeks.**

### Mapping back to your priority order

| Your priority | Release |
|---|---|
| 1. Lead Intelligence Hub | R1 |
| 2. AI Research Agent | R1 |
| 3. Lead Scoring | **R1 — now Fit + Priority, two scores** |
| 4. Pipeline | R1 |
| 5. Email Campaigns | **generation R1** · sending R2 → R3 |
| 6. WhatsApp Campaigns | **generation R1** · sending R3 |
| 7. Sales Sequences | R3 |
| 8. Demo Preparation | **brief R1** · booking R4 |
| 9. Revenue Dashboard | **R1 — the cockpit and landing page** |
| 10. Sales Coach | R4 |
| 11. Website Intelligence | R5 |
| 12. Competitor Intelligence | **R1** (moved up in revision 3) |
| 13. Content Studio | R6 |
| — Proposal workflow | **R1** (first-class in revision 3) |
| — International intelligence | **R1** (added in revision 3) |

---

## 11. Open decisions for the founder

| # | Question | Needed by | My recommendation |
|---|---|---|---|
| O1 | Set `ANTHROPIC_API_KEY` in the web environment | **R1** | Do it now; it also unblocks ASK OZZO |
| O2 | Monthly AI budget ceiling | R1 | $100/month — about 1,200 companies researched on Opus 5.5 via Batch |
| O3 | Model: Opus 5.5 or Sonnet 5.5 | R1 | Start on Opus 5.5, measure the verification rate for a month, step down only if it holds |
| O4 | **Which competitors beyond the four named** | R1 | The four named plus any you have lost a deal to. Cards are cheap; unapproved ones are simply unusable. |
| O5 | **Which countries to seed** | R1 | India + the EU set reachable via A7. Add others when a real prospect appears. |
| O6 | Which sending domain to buy | R2, optional | A close variant such as `ozzocrm.in` — never `ozzo.co.in` |
| O7 | Smartlead or Instantly | R2, optional | Either; Smartlead is cheaper at low volume |
| O8 | Apify budget | R2 | $25/month cap to start, which is thousands of records |
| O9 | Accept the terms-of-service risk on A5/A6/A7 | R2 | Explicitly yes or no, in writing, once you have read §4 and §9 |
| O10 | When do SDRs get access | R3 | The schema is ready; it is a decision, not work |

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Cold email suspends the Resend account and breaks tenant password resets** | **High** | Separate domain + separate provider, mandatory when sending is enabled (§9); D8 makes sending optional so this risk is opt-in |
| AI invents facts about a prospect | High | Evidence-or-flag rule; unverified claims excluded from every generator; verification rate tracked weekly |
| **AI invents facts about a competitor** | **High** | D10 — founder-authored battlecards only, AI write access revoked at the `GRANT` level, unapproved cards unusable |
| **R1 has grown to 7–8 weeks and ships nothing until then** | **High** | The R1a / R1b split in §14 — working software in 4 weeks |
| Compliance accident on an EU contact | Medium | `requires_prior_consent` enforced in code, not documentation; Germany and Austria blocked by default |
| IndiaMART/TradeIndia yield names but no contacts | Medium | Already known (§4) — MCA + Places are the contactable path; A5 is a top-up |
| Directory scraping breaks or gets blocked | Medium | Apify maintains the parsers; a failed run is visible and never corrupts data |
| Google Places bill runs away | Medium | Database cap below the free tier; a run that would cross it fails before the first call |
| **Landing-page change affects tenants** | Medium | Founder-gated redirect plus an explicit test that non-founders still land on `/dashboard` |
| Scope creep back toward all 15 phases at once | Medium | This document, and the freeze in §14 |
| Fifth unfinished front — FSM still has nothing built | Medium | D1 keeps this founder-only: no pricing, onboarding, support or mobile burden. The FSM claim keys (§5.1a) also turn this into demand discovery for that line. |
| WABA number banned by cold WhatsApp | Low, if respected | WhatsApp is follow-up only |

---

## 13. Review log

### Revision 2 — 2026-10-02, founder review

Five changes requested, all accepted: **AI Outreach Generator in R1** (generation is not sending — my omission) · **proposal draft in R1** · **meeting brief moved up from R4** (booking stayed) · **OZZO Fit Score promoted to four first-class scores** replacing an `ozzo_fit` jsonb of booleans · **distributor and territory intelligence** as a closed claim-key list, built for agri/pumps/manufacturing rather than headcount. Module names adopted. R1 moved 3–4 → 5–6 weeks.

Two things added that the review implied but did not state: all generators read only `is_verified` claims; and a generated WhatsApp draft is free text, not a Meta-approved template.

### Revision 3 — 2026-10-02, founder review (architecture approved in principle)

| # | Change | Where it landed | Assessment |
|---|---|---|---|
| 1 | **Proposal generation as a first-class workflow** — Lead → Demo → Draft → Review → Send | §5.1e `re_proposals` + state machine, J10, nav board | **Accepted.** Implemented as a lifecycle on the deal, deliberately *not* a second generator — rendering stays in the existing `/admin/proposals`. Only the founder can approve or send. |
| 2 | **Competitor intelligence moved to R1** — battlecards + migration pitches | §5.1c, D10, J6, R1 | **Accepted, and cheaper than I priced it in R5.** Your 12 `/compare` pages seed it and `existing_software` was already a claim key. **Added guardrail D10:** battlecards are founder-authored and the AI's write access is revoked at the `GRANT` level — wrong claims about a competitor are a disparagement risk with no page to quote. `their_strengths` is mandatory so the cards stay honest. |
| 3 | **Separate Fit from Priority** | D9, §5.1b — two tables | **Accepted, and it corrected my design.** I had one "ICP score" doing two jobs. There is also a technical reason to split: Fit recomputes on research, Priority recomputes nightly and after every activity — two write frequencies. |
| 4 | **Command Center as default landing page and cockpit** | §7 — six specified blocks + founder-gated redirect | **Accepted, with a caution.** Post-login landing is currently `/dashboard` for everyone, so this is a **founder-only** redirect plus a test asserting non-founders are unaffected. It is the only R1 item reaching outside `/admin`. |
| 5 | **International market intelligence** | §5.1d `re_country_profiles`, §6.6, J11 | **Accepted, split in two.** The legal and operational fields are factual, sourced and **enforced** — `requires_prior_consent` blocks email drafting. "Communication style" has no evidence URL and would be AI-generated generalisation about nationalities, so it exists as founder-editable guidance, always labelled unverified, never an input to a score or a gate. |
| 6 | **Sending infrastructure optional and modular** | D8, §5.1 `re_channel_configs` | **Accepted — good instinct.** A Channel Provider boundary mirroring the Source Adapter boundary. `manual` is a real provider, not a stub. Nothing in R1 depends on a paid provider, so the whole Resend/deliverability risk class becomes opt-in. |

**Consequence, stated not absorbed: R1 moves from 5–6 weeks to 7–8 weeks** — close to double the original estimate. §14 offers a split so you are not waiting two months for the first usable screen.

---

## 14. Release 1 scope — to be frozen

You asked to freeze R1 before any code. Here is the full scope, and a recommended split.

### Everything currently in R1

| # | Item | Days |
|---|---|---|
| 1 | Seven migrations + rollback notes (§5.3) | 3 |
| 2 | Revenue Command Center cockpit + founder landing redirect + test | 4 |
| 3 | Prospect Hub: list + detail, seven tabs | 5 |
| 4 | Spreadsheet import (A1) + inbound forms (A2) | 3 |
| 5 | Research Agent: batch + live, strict closed-key schema, evidence-or-flag, full §5.1a claim set | 6 |
| 6 | Fit scoring (4 lines, reasons) | 2 |
| 7 | Priority scoring (components, nightly + event-driven) | 2 |
| 8 | Outreach Generator — 4 channels, approval, manual send | 3 |
| 9 | Meeting Brief Generator | 2 |
| 10 | Battlecards: schema, founder editor, seeding from `/compare`, approval gate | 3 |
| 11 | Migration Pitch generator | 1 |
| 12 | Country profiles: schema, editor, seed, **consent gate on drafting** | 2 |
| 13 | Activities, deals, suppressions | 3 |
| 14 | Proposal workflow: state machine, board, AI prefill, handoff | 3 |
| 15 | Channel Provider boundary + `manual` provider | 1 |
| 16 | Sources / channels / spend screens (read-only) | 2 |
| 17 | Tests per §9 | 4 |
| | **Total** | **~49 days ≈ 7–8 weeks** |

### Recommended split — my recommendation is to take it

**R1a — "revenue capable" (~4 weeks, items 1–9, 13, 15):** database, research, both scores, outreach generation, meeting brief, activities, deals, suppressions, cockpit, import, `manual` channel. **At the end of R1a you can find, research, score, write to and track real prospects.** That is a working revenue engine.

**R1b — "competitive and international" (~3–4 weeks, items 10–12, 14, 16, 17 remainder):** battlecards, migration pitches, country profiles and the consent gate, proposal workflow, config screens.

**Why I recommend splitting:** R1a gives you working software in four weeks instead of eight, and four weeks of real use will teach you things that change R1b's design — particularly which claim keys actually matter and what the outreach drafts get wrong. Building R1b on four weeks of evidence is better than building it on a guess today.

**One caution if you split:** the §5.3 migrations should still all land in R1a. Schema churn is the expensive kind of rework; the tables are cheap to create and sit empty until R1b fills them.

### To freeze, confirm

1. **Does revision 3 (§13) capture your six additions correctly?**
2. **R1 as one 7–8 week block, or the R1a / R1b split?**
3. **O1–O5** (API key · AI budget · model · competitors to seed · countries to seed).
4. Anything in §14's list to **cut**.

On your answers I will freeze this scope, then write the Release 1 implementation plan. **Still no code until that plan is approved.**
