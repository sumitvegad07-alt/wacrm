# Lead Discovery (Google Places) — V1

**Status:** Built and live · 2026-10-06
**Owner:** Founder-only tool. Not a product line, not tenant-facing, no mobile.
**Route:** `/admin/revenue/discover` · **API:** `/api/admin/revenue/discover`

## Why this exists

The founder needs a free supply of callable Indian manufacturer and distributor
numbers to sell OZZO SFA. Paid data sources were ruled out: the requirement was
"free now, and ideally free forever." Target volume was ~20,000 numbers, which is
5–6 months of telecalling — i.e. a **one-off harvest, not an ongoing pipeline.**

This is the first slice of the larger [OZZO Revenue Engine](./ozzo-revenue-engine-r1.md)
to be built. It is deliberately the smallest useful piece: discovery only, CSV
out, worked by hand. No scoring, no AI, no sending.

## The economics this design protects

Google's India pricing gives 7x the global free tier, per SKU, per month:

| Tier | Free calls/month | Contains |
|---|---|---|
| Essentials | 70,000 | IDs, coordinates, address |
| Pro | 35,000 | Business name, address, status, `addressComponents` |
| Enterprise | **7,000** | **Phone number, website**, rating, review count |

Phone number is the entire point of the tool, so **every call is billed at the
Enterprise rate** and the real budget is 7,000 calls a month. Verified on Google's
SKU table 2026-10-06; `reviews`, `editorialSummary` and atmosphere fields are
excluded from the field mask because any one of them promotes the call to the
Enterprise + Atmosphere SKU, which has its own much smaller allowance.

One search returns ≤20 results and Google refuses to paginate past 3 pages, so
**60 results is the hard ceiling per search phrase.** That single constraint is
what shapes the whole design.

### Known, accepted risk

Google's Maps Platform Terms §3.2.3(a) ("No Scraping") prohibit copying and saving
business names and addresses, and separately prohibit using Maps to build a
mailing or telemarketing list. **The founder was shown this and chose to proceed.**
Two deliberate consequences:

1. **A dedicated Google Cloud project.** Nothing in OZZO uses Google Maps — web
   and mobile both run on Leaflet/OpenStreetMap — so a terminated key cannot
   break any customer-facing feature.
2. **The server stores no prospect data.** Only Place IDs, which Google
   explicitly permits storing indefinitely. Names, phones and addresses live in
   the CSV on the founder's machine and in his own sales account's `leads` table.

## Design decisions

### D1 — Industrial areas, not just districts

Manufacturers cluster in KIADB industrial estates, and each estate is its own
separate 60-result bucket. Searching Hubballi's Tarihal and Gokul Road separately
finds more than searching "Dharwad" ever can. Karnataka ships with **31 districts
and 163 industrial areas**, giving a full single-industry sweep of 163 searches
(~294 expected calls). A district with areas selected is **not** also searched
whole — that would re-find the same companies at full price.

States without an area list fall back to district-level search: fewer results,
never wrong results.

### D2 — District search aliases

The shared India seed (`supabase/seed-data/territory-seed.json`, also used by
Territory Master) carries official Kannada spellings — *Dharwada, Gadaga,
Bagalakote, Koppala*. Google matches far better on *Dharwad, Gadag, Bagalkot,
Koppal*. Sending the official spelling returns fewer results **and fails
silently**, which is indistinguishable from an empty district. The founder picks
the official name; Google receives the alias.

### D3 — The browser drives the loop

A sweep is ~163 searches over several minutes, which does not fit in a serverless
function's lifetime. The page requests **one search per HTTP call** and keeps rows
in browser memory. No job queue to get stuck, visible progress, and each request
is a second or two. Cost: the tab must stay open — stated in the UI and guarded
with a `beforeunload` warning, because losing the rows wastes the quota they cost.

### D4 — Two independent brakes on spend

1. `DAILY_CALL_CAP = 220` enforced server-side by summing `calls_used` from
   `re_discovery_queries` for the current IST day. The last search of the day is
   shortened to fewer pages rather than overshooting.
2. The same number set as a per-day quota in the Google Cloud console, which
   refuses the call independently of our code.

The monthly 7,000 is also checked. A 429 from Google is treated as success of the
brake, not a crash.

### D5 — Deduplication at two levels

- **Place level:** `re_discovery_seen_places` holds every Place ID ever
  harvested, so a later industry sweep never re-surfaces a company. Also
  de-duplicates by phone number inside a harvest, catching the common pattern of
  one company having a Google listing per branch on one head-office number.
- **Search level:** a search run successfully in the last 45 days is skipped for
  free. This is what lets a two-day sweep resume where it stopped instead of
  re-paying for yesterday's searches. The "Ignore my previous harvests" tick
  overrides both.

Place IDs are recorded **before** the response is returned, so a lost response
cannot leave a company eligible to be harvested twice.

### D6 — Retail is filtered out, visibly

The category dropdown offers Manufacturer, Distributor, Wholesaler and
Exporter/Supplier — **never dealer, retailer or showroom**, per the founder's
ruling that this list is for SFA, not FSM. Because Google returns shops anyway,
results whose `primaryType` is a retail or consumer-service type are dropped, and
the count is reported so a bad keyword is visible rather than silent. The generic
`store` type is deliberately kept: Google types many real small manufacturers that
way.

### D7 — City comes from what we searched

`city` and `area` are set from the searched district and estate, not parsed out of
Google's formatted address. The searched district is a fact; parsing an Indian
address for a city is guesswork that silently mislabels rows. PIN code *is* read
from `addressComponents`, falling back to a 6-digit match on the address string.

### D8 — Phone format

Stored as `91XXXXXXXXXX` — digits only, no `+`. Three reasons: it matches
`normalizePhone()` in `src/lib/whatsapp/phone-utils.ts` so the `leads` unique
index sees the same string we de-duplicated on; it is what WhatsApp expects; and a
leading `+` would be read as a formula by Excel.

## What Google cannot give

**No contact person, no email.** Google Maps lists businesses, not people, so
those CSV columns come out blank — the founder is calling a switchboard and asking
who handles sales. The free MCA company API on `data.gov.in` (director names) is
the intended later fix; it is not in V1.

## Files

| File | Role |
|---|---|
| `src/lib/revenue/discovery-taxonomy.ts` | 25 industries, 4 categories, retail-type exclusions |
| `src/lib/revenue/discovery-geography.ts` | District aliases + 163 Karnataka industrial areas; states/districts reused from the Territory Master seed |
| `src/lib/revenue/discovery-query.ts` | Pure logic: query plan, quota maths, field mask, place→row, dedupe, CSV |
| `src/lib/revenue/discovery-query.test.ts` | 31 tests over all of the above |
| `src/lib/revenue/places-client.ts` | Google Places Text Search, server-only |
| `src/app/api/admin/revenue/discover/route.ts` | `requireFounder()`, start/search/finish, cap enforcement |
| `src/app/(superadmin)/admin/revenue/discover/` | Page + harvest UI |
| `supabase/migrations/20261006100000_revenue_lead_discovery.sql` | The three `re_discovery_*` tables |

## Database

Three tables, RLS enabled with **no policies** — platform-owner data, reachable
only through the service role after `requireFounder()` passes, exactly like
`retention_runs`. They touch neither `leads` nor `contacts`.

- `re_discovery_runs` — one row per harvest. Counts only. `owner_id` from day one
  so a telecaller login later is a login, not a migration.
- `re_discovery_queries` — one row per search. `calls_used` summed over the
  current IST day is the daily cap; it is per-query rather than per-run so a tab
  that closes mid-harvest still has its spend counted.
- `re_discovery_seen_places` — Place IDs only.

## Leads importer fixes shipped alongside

The CSV is useless if the import loses rows, and three real bugs were found in
`src/components/leads/lead-import-dialog.tsx`:

1. **The phone went into the wrong column.** It wrote `whatsapp` and left `phone`
   NULL — but the unique index added in migration `20261005150000` is generated
   from `phone`, so the duplicate check never fired. Now writes both.
2. **One duplicate killed 49 good rows.** Inserts ran in batches of 50 and a
   single unique violation rejects the whole statement, counting all 50 as
   failures. Now a failed batch is retried row by row, and `23505` is reported as
   "Already had" rather than "Failed".
3. **Columns silently dropped.** `area`, `pincode`, `latitude` and `longitude`
   were never mapped despite the template advertising lat/long. Now mapped, and
   duplicates inside one file are removed before any insert.

## Configuration

`GOOGLE_PLACES_API_KEY` — server-side only, set in Vercel. Absent, the page shows
a warning and refuses to start. The key is never sent to the browser.

In the Google Cloud console: restrict the key to the Places API (New), and set a
**per-day quota of 220** on Text Search requests plus a ₹1 budget alert. The quota
is what makes "free" guaranteed rather than hoped for.

## Not in V1

Contact-person enrichment (MCA API), OpenStreetMap as a second free source,
scheduled/background harvesting, writing leads straight into an account instead of
a CSV, and any state's industrial areas other than Karnataka.
