# Lead Discovery — Enrichment Stage (treg) — V1

**Status:** Specified, not built · 2026-10-17
**Owner:** Founder-only tool. Not a product line, not tenant-facing, no mobile.
**Route:** an Enrich tab on `/admin/revenue/discover` — no new page
**API:** `/api/admin/revenue/enrich` + `/api/admin/revenue/enrich/worker`
**Extends:** [Lead Discovery (Google Places) V1](./lead-discovery-google-places-v1.md)

## Why this exists

The Lead Discovery spec records its own missing half plainly: Google Maps has no
contact person and no email, so those CSV columns are always blank. What a harvest
gives you is a company and a switchboard number. What telecalling needs is a named
person to ask for, and what WhatsApp and email outreach need is their direct
address or mobile.

The harvest already on production, measured 2026-10-17:

| Measure | Count | Share |
|---|---|---|
| Harvested rows | 329 | — |
| Have a company phone | 329 | 100% |
| **Have a website** | **223** | **68%** |

A website means a domain, and a domain is the one key every contact-data provider
needs to start work. So two-thirds of every harvest can be enriched, and one-third
cannot be enriched by this route at all.

This stage takes a row like *"Jay AMBE Industries, Gujarat, 91XXXXXXXXXX,
jayambeindustry.com"* and returns *"Name, Proprietor, verified email, live
mobile."*

The earlier intended fix for this gap was the free MCA API on data.gov.in, which
gives director names only. This spec does not replace it — MCA remains the right
way to make step 2 free later. See Future work.

## What treg is

[treg.to](https://treg.to) is a pay-per-call gateway. One token reaches roughly
3,900 third-party API endpoints. The balance is prepaid, metered at each
provider's own rate with **0% markup**, the first $1 is free, and there are no
seats or monthly minimums.

Its *routed* endpoints are the waterfall: `treg.people.email.find` tries your own
provider keys first, then the cheapest provider, falling through to the next on an
error or a miss, inside a cost cap. `X-Treg-Served-By` says who answered.

That is why this is one integration and not eleven.

## The economics this design protects

treg's own published receipt for this exact workflow: **50 companies cost $3.62
and produced 27 verified deliverable leads — $0.13 a lead, about ₹11.**

Known per-call prices, read from treg's catalogue 2026-10-17:

| Step | Endpoint | Price |
|---|---|---|
| Company search | 11 providers | free (Akta, Hunter Discover) to $0.38 (PDL) |
| Company enrichment | Hunter / LeadMagic / Apollo | $0.0245 / $0.025 / $0.026 |
| Find one named person | `hunter.people.email.find` | $0.0245 |
| Find a work email | `treg.people.email.find` | routed, `usd_per_call: null` |
| Verify an email | `treg.people.email.verify` | $0.00625 LeadMagic / $0.01225 Hunter |
| Find a phone | `treg.people.phone.find` | routed, `usd_per_call: null` |

Four facts about how the money actually leaves:

1. **The default cap on a routed call is $1.** Routed rows report
   `usd_per_call: null` because the price depends on who ends up answering. A loop
   over 200 rows with no explicit cap is a four-figure accident.
2. **A retry can pay twice.** The worker hand-off chain means a timed-out call may
   be reissued. Without an idempotency key that is a second charge for the same
   answer.
3. **Cache hits are not free.** From the second call onward an `X-Treg-Cache: hit`
   costs 10% of list price.
4. **Some providers bill misses.** Hunter and LeadMagic charge only on success.
   Findymail and Tomba advertise free misses but do not report the charge in their
   response, so treg bills them at list rate including misses — $0.56 of treg's
   own $3.62 sample run went that way. Prefer the providers that report honestly.

### The three guardrails

Every call made by this feature carries all three. They are not optional and not
configurable away.

- **`X-Treg-Route-Max-Cost: <usd>`** on every routed call. treg returns 402 and
  charges nothing if the reserve would exceed it.
- **`Idempotency-Key: <runId>:<leadId>:<step>`**, deterministic. A retry with the
  same key returns the stored answer and charges nothing.
- **A per-run ceiling.** `X-Treg-Cost-Micro` from each response is added to
  `re_enrich_runs.total_cost_micro`. When the next call would cross
  `max_cost_micro`, the run pauses.

### Known, accepted risk

Lead Discovery's accepted risk was Google's scraping terms, mitigated by a 90-day
bound on prospect rows. This stage is a larger exposure of a different kind: a
business listing is a company, but a director's name, personal email and personal
mobile are **personal data about a named individual**, and India's Digital
Personal Data Protection Act 2023 governs processing it.

Decided for V1:

1. `re_lead_contacts` is purged on the same 90-day bound as `re_discovery_leads`.
   Enriched contacts are not warehoused.
2. An `opted_out` flag on the contact. Once set, the row is never re-enriched and
   never exported, and it survives the 90-day purge as a tombstone of the contact
   hash alone.
3. Nothing that is not a business domain is enriched. Personal mailbox domains
   (gmail.com, yahoo.in, rediffmail.com and the rest) are skipped before any paid
   call.

## Design decisions

### D1 — A separate, deliberate step. Not part of the harvest.

Harvesting spends free Google quota. Enriching spends real money. Fusing them
would let a 294-search sweep silently spend $40 before anything appeared on
screen. So the harvest is unchanged, and enrichment is a second action taken
against rows you can already see, after a dialog that shows the cost.

### D2 — Reuse the run-row-as-job pattern, unchanged.

The founder's constraint, recorded during the Lead Discovery build, is *"When I
want to start scraping I will not stick on that screen for hours."* The same
applies here, with money at stake.

So `re_enrich_runs` is the job, exactly as `re_discovery_runs` is: `next_index` is
the position, `heartbeat_at` is proof a worker holds it, `cancel_requested` is
Stop, `stop_reason` records a pause. A worker answers the HTTP request first and
works in `after()`, runs for about 240 seconds, then chains to the next worker.
**Every exit clears `heartbeat_at`** so the next link can claim immediately.
`re_enrich_claim_run` uses `for update skip locked`, because two workers on one
run means paying twice for every row.

`CRON_SECRET` is still not set on this Vercel project, so the hand-off uses the
same **single-use `worker_token` uuid** redemption Lead Discovery was rebuilt to
use. No Vercel cron. Opening the page nudges a quiet run along, and an interrupted
run auto-resumes under the existing six-hour `canAutoResume()` rule.

### D3 — An apex domain, or no enrichment at all.

The stored website is not usable as-is. Production rows look like
`https://www.solospolymers.com/?utm_source=google&utm_medium=organic&utm_campaign=gmb`
and `http://www.santushtishakes.com/`.

Normalisation, in order: lowercase, strip the scheme, strip `www.`, drop
everything from the first `/`, `?` or `#`, reject anything that is not a plausible
hostname, reject free-mail and social domains. The result is `solospolymers.com`.

A row with no domain after this is marked `no_domain`, costs nothing, and is
counted in the run summary so the 32% is visible rather than mysterious.

### D4 — The waterfall short-circuits. Each step pays only if the last one found something.

| # | Step | Endpoint | Runs only if |
|---|---|---|---|
| 1 | Who works at this domain | `hunter.companies.emails` | a domain exists |
| 2 | Identify the decision-maker | `treg.people.search` | step 1 returned no named person |
| 3 | Find their work email | `treg.people.email.find` | a person exists with no email yet |
| 4 | Verify the mailbox | `treg.people.email.verify` | step 1 or 3 produced an address |
| 5 | Find the mobile | `treg.people.phone.find` with `X-Treg-Route-Verify: true` | a person exists |

Step 1 is one call that often returns several named people with addresses already.
When it does, steps 2 and 3 are skipped entirely and the company cost one call.

Step 5 does not depend on the email succeeding. A dead mailbox and a live mobile
is a perfectly good outcome, and the better one for WhatsApp outreach.

`X-Treg-Route-Verify: true` on the phone step HLR-checks the number through
`hlrlookup.people.phone.verify` as a separate charge, so a found mobile is known
to be a live SIM rather than a disconnected one.

Step 2 filters on Indian SMB titles — Director, Owner, Proprietor, Partner,
Managing Director — not the US-centric CEO/VP ladder.

### D5 — Every single call writes a receipt row.

`re_enrich_attempts` records the endpoint, which provider answered
(`X-Treg-Served-By`), the cost in micro-dollars, the treg call id, and the
outcome: hit, miss, error, rate-limited or cached.

This is not bookkeeping for its own sake. Every provider in treg's catalogue is
US/UK/EU-first, and nobody knows their real coverage of a Gujarati manufacturer.
After 300 rows this table answers that in plain numbers — "LeadMagic found 4% of
Gujarat mobiles" — and the waterfall order can then be fixed with evidence instead
of guesses. It is also the per-row attempt history shown in the UI.

### D6 — Contacts are a child table.

`hunter.companies.emails` returns several people for one domain, and a
manufacturer may have a proprietor worth calling and an accounts contact worth
emailing. One row per person in `re_lead_contacts`, with `is_primary` for the one
the table view shows, and a denormalised summary on the lead row so the list does
not need a join to render.

### D7 — The ceiling is a pause, not a failure.

Hitting `max_cost_micro` sets the run's status back to `queued` with
`stop_reason = 'cost_cap'`, exactly as Lead Discovery's daily Google cap does. The
run keeps its `next_index`, so raising the ceiling resumes it rather than
restarting it and paying again for finished rows.

A 402 from treg (the per-call cap would have been exceeded) is recorded as an
**uncharged miss** and the row moves on. A 422 from
`X-Treg-Route-Strict-Filters` is likewise uncharged. Neither aborts the run.

### D8 — No ICP builder.

The tool this is modelled on asks a language model to read your website and invent
an ideal customer profile, because its users arrive with nothing. OZZO arrives
with an explicit picker: 64 industries, 1,626 industrial estates across 33 states,
57 district spelling aliases, and a test that fails the build on an unknown key.
That is strictly better targeting than a model guessing from a homepage.

Also not built, for the same reason — these exist only to resell enrichment, and
this is internal: credits, holds, refunds, a credit ledger, customer accounts, a
margin panel, Stripe, and a provider bake-off page.

### D9 — Five rows at a time.

A small promise pool, five concurrent. Enough to finish 200 rows inside a few
worker chunks, small enough that one provider's rate limit does not poison the
whole run. A 429 is recorded as `rate_limited` and the waterfall falls through to
the next provider rather than retrying.

### D10 — `catch_all` is not `valid`.

The verifier returns `valid`, `invalid`, `catch_all`, `risky` or `unknown`. A
catch-all domain accepts every address, so a catch-all result means "we learned
nothing", not "this person exists". It gets its own badge and its own CSV value,
and it is excluded from the deliverable count in the run summary. Only
`output.verified: true` means a mailbox was actually checked.

## Data model

### `re_enrich_runs`

Mirrors `re_discovery_runs`. RLS on, zero policies, service-role only.

```
id               uuid pk
status           text        -- queued | running | finished | cancelled
next_index       int         -- position in the selection
heartbeat_at     timestamptz
cancel_requested boolean
stop_reason      text        -- cost_cap | cancelled | error | null
worker_token     uuid        -- single use, spent by re_enrich_redeem_token
lead_ids         bigint[]    -- the selection, ordered; next_index points into this
max_cost_micro   bigint      -- the ceiling, set before start
total_cost_micro bigint      -- running total from X-Treg-Cost-Micro
rows_done        int
contacts_found   int
emails_verified  int
mobiles_found    int
created_at       timestamptz
finished_at      timestamptz
```

### `re_lead_contacts`

```
id              bigserial pk
lead_id         bigint references re_discovery_leads (id) on delete cascade
run_id          uuid   references re_enrich_runs (id)
is_primary      boolean
person_name     text
person_title    text
person_linkedin text
email           text
email_status    text    -- valid | invalid | catch_all | risky | unknown
mobile          text    -- digits only, 91XXXXXXXXXX
mobile_status   text    -- live | dead | unknown
opted_out       boolean not null default false
cost_micro      bigint  -- what this contact cost to produce
created_at      timestamptz
```

Mobile is stored digits-only as `91XXXXXXXXXX` — the same shape `normalisePhone()`
in `discovery-query.ts` gives the harvest, so WhatsApp links work and Excel does
not read a leading `+` as a formula.

Enrichment uses its own stricter `normaliseMobile`, and **`normalisePhone` itself
must not be changed.** It wrote every stored `re_discovery_leads.phone`, and the
WhatsApp outreach sender runs it over both sides of its opt-out suppression
check; altering it makes that matching fail silently, and the failure is messaging
someone who asked not to be. The new function is stricter because this column
means "a mobile we can WhatsApp": `normalisePhone` accepts landlines and passes
toll-free 1800/1860/1600 numbers through, whereas anything that is not a
ten-digit Indian mobile is stored here as empty rather than wrong.

### `re_enrich_attempts`

```
id           bigserial pk
run_id       uuid
lead_id      bigint
step         text  -- company_people | person_search | email_find | email_verify | phone_find
endpoint_id  text  -- e.g. treg.people.email.find
served_by    text  -- from X-Treg-Served-By
cost_micro   bigint
treg_call_id text  -- from X-Treg-Call-Id
outcome      text  -- hit | miss | error | rate_limited | cached | uncharged
http_status  int
created_at   timestamptz
```

### Columns added to `re_discovery_leads`

```
enrich_status     text    -- pending | no_domain | enriched | partial | failed
enrich_cost_micro bigint  not null default 0
enriched_at       timestamptz
best_email        text
best_email_status text
best_mobile       text
```

## The treg client contract

One wrapper, `src/lib/revenue/treg-client.ts`. Nothing else in the codebase calls
treg directly.

**Sends on every call:** `X-Treg-Token`, `X-Treg-Route-Max-Cost`,
`Idempotency-Key`, and `X-Treg-Meta: feature=enrich,run=<runId>` so spend can be
attributed later.

**Reads on every response:** `X-Treg-Cost-Micro` (the charge — never the
provider's own body), `X-Treg-Call-Id`, `X-Treg-Served-By`, `X-Treg-Cache`.

**Writes** exactly one `re_enrich_attempts` row per call, including failures.

**Handles:** 200 hit, 200 miss, 402 cap-would-be-exceeded (uncharged, move on),
422 strict-filter (uncharged, move on), 429 rate-limited (fall through, do not
retry), 5xx (one retry with the same idempotency key, then record error).

**Refuses** to make the call at all if `total_cost_micro + reserve >
max_cost_micro`. The ceiling is checked inside the client, not by callers, so no
future code path can forget it.

`TREG_TOKEN` goes in Vercel env and `.env.local`. The page warns and refuses to
start without it, as the discover page does without `GOOGLE_PLACES_API_KEY`.

### Money is stored in micro-USD and shown in rupees

treg prices and charges in USD, so **every stored figure is an integer in
micro-USD** — `cost_micro`, `total_cost_micro`, `max_cost_micro`. No floats, no
rupees in the database.

Rupees exist only at the edges, for display and for the ceiling input, converted
through a single hardcoded `USD_INR` constant in `treg-client.ts`. It is not fetched
from a live rate: a drifting rate would make two runs incomparable and could move a
ceiling the founder set. The constant is reviewed by hand, and the spend figure the
UI shows is therefore an approximation of a USD charge, which the attempt drawer
always shows exactly.

## UI

A tab on the existing `/admin/revenue/discover` page, behind `requireFounder()`.

**Starting a run.** Select rows from a past harvest. The dialog states: rows
selected, how many have a usable domain, how many are already enriched, the
estimated cost as a range in ₹, and a ceiling input defaulting to ₹500. Start is
disabled until the ceiling is at least the low estimate.

**While it runs.** Live counters — rows done, contacts found, emails verified,
mobiles found, spent so far in ₹ against the ceiling — and a Stop button. Closing
the tab is safe. Reopening the page auto-resumes under the existing six-hour rule,
and a deliberate Stop is offered back rather than restarted.

**Per row.** An attempt-history drawer: each provider tried, in order, what it
returned, and what it cost. This is the most useful screen in the feature.

**Out.** CSV export including the new columns, shaped to feed the existing Leads
importer, which already maps `phone`, `area`, `pincode`, `latitude` and
`longitude` correctly since commit `921ec4d`.

## Step 0 — the spike, which gates everything above

**Nothing else in this spec gets built until this runs.**

A throwaway script, not shipped code, against 20 of the 223 rows that have a
domain. It fits inside treg's free $1 credit.

**What the sample can and cannot be.** Checked on production 2026-10-17, all 223
enrichable rows are **Gujarat**, in **two industries only** — Beverages & soft
drinks (143) and Seeds (80). So the spike is 10 rows from each industry, and its
result is a statement about Gujarat food and agri manufacturers, not about India.
Reading it as a national hit rate would be wrong.

Widening it is cheap but optional: one district sweep in Maharashtra or Tamil Nadu
costs free Google quota, not money, and a search already run in the last 45 days is
skipped for free. If a second state is wanted before committing, harvest it first
and split the 20 rows across both.

It reports, separately: the hit rate for finding a named person, for finding an
email, for that email verifying `valid`, and for finding a live mobile — plus the
true cost per usable row in ₹.

**The kill criterion.** The chosen shape is "name, email and mobile in one
waterfall", and its cost is dominated by the mobile step. Every provider behind
treg is US/UK/EU-first. **If the mobile hit rate comes back under roughly 15%, the
one-pass shape is wrong** and this design is revisited before any migration is
written — most likely collapsing to name-and-email, with the switchboard number
already in hand doing the calling work.

A dollar spent learning this is cheaper than building a mobile path into an empty
well.

## Testing

- `treg-client.test.ts` — mocked fetch covering hit, miss, 402, 422, 429, 5xx
  retry-with-same-key, cache hit, and the ceiling refusing a call before it is
  made.
- `enrich-domain.test.ts` — normalisation, including the real production cases:
  the `?utm_source=google&utm_medium=organic` suffix, `http://www.` prefixes,
  trailing slashes, and free-mail rejection.
- `enrich-runner.test.ts` — short-circuit order (no person means no email call),
  step 5 running despite step 4 failing, `catch_all` not counting as deliverable,
  and the ceiling pausing a run with `next_index` intact.
- A claim test: two workers racing one run, only one proceeds.

## Out of scope for V1

Mobile app. Anything tenant-facing. Automatic re-enrichment on a schedule. Sending
email or WhatsApp — that is [Outreach](./outreach-whatsapp-sender-v1.md). Scoring
or ranking leads. Enriching rows that came from anywhere other than a discovery
harvest.

## Future work

- **MCA director names, free.** The MCA API on data.gov.in returns director names
  for registered Indian companies at no cost. That is step 2 of the waterfall, for
  free, for every Pvt Ltd in the harvest — and most industrial-estate
  manufacturers are registered. Doing this first would cut the paid waterfall down
  to email and mobile only. It was the originally intended fix for the
  blank-contact gap and remains the right cost optimisation.
- **Reordering the waterfall from `re_enrich_attempts` evidence** once a few
  hundred rows have been through it.
- **Bringing your own provider keys.** treg never meters calls made on your own
  keys. If one provider turns out to carry real Indian coverage, a direct account
  with them becomes cheaper than routing.
