# Four plan-demo tenants with lived-in data — design

Date: 2026-10-12
Status: approved, building

## The problem

Prospects are shown OZZO on a tenant that either has no data or has the founder's own data.
A dashboard full of zeros sells nothing, and a dashboard full of obviously-fake data
("Customer 1", ₹1,000.00, five identical reps) sells less than nothing, because the prospect
stops believing the screen.

What's needed is four separate demo tenants, one per sellable plan, each of which looks like a
real company that has been using OZZO for a year:

| Login | Password | Plan |
| --- | --- | --- |
| `ozzowfa@gmail.com` | `123456` | WFA |
| `ozzosfa@gmail.com` | `123456` | SFA |
| `ozzowfacrm@gmail.com` | `123456` | CRM_WFA |
| `ozzosfacrm@gmail.com` | `123456` | CRM_SFA |

Each with at least 5 sales-executive logins that work on the Android app, so a prospect can be
handed a phone as well as shown a browser.

## Prior art in this repo, and what it does not cover

`scripts/seed-playconsole-test-account.mjs` (1079 lines, applied to prod on 2026-10-06) already
builds one complete tenant in eight phases: owner login + account, account configuration,
masters, roles, 20 reps, catalogue, customers, and a noise-clearing pass. It is proven against
this exact production database and its conventions are the ones to follow:

- **`handle_new_user` mints the tenant.** `auth.admin.createUser` with `user_metadata`
  `{ full_name, company_name, plan, sales_users }` creates the account, the Customer ID, the
  owner profile and the plan's `module_settings` in one shot. Reps are created with
  `{ full_name, member_of_account: <accountId> }` so the trigger does **not** mint a second
  account.
- **`handle_new_user` swallows its own errors** (`EXCEPTION WHEN OTHERS -> RETURN NEW`), so a
  missing profile after createUser means the trigger failed silently. Check, never assume.
- **`is_provisioned` must be forced `true`.** Otherwise the dashboard shell re-provisions on
  first web login and overwrites the seeded configuration.
- **Deterministic PRNG (mulberry32) + idempotent phases.** Same seed, same names and
  coordinates; every phase checks for what it already created, so a partial failure is safe to
  re-run.

What it does **not** do is seed any history. No orders, visits, payments, expenses, attendance
or GPS. That is the whole of the work here, plus making the tenant shape a function of the plan
rather than a constant.

## What the dashboards actually read

This drove every volume decision below, so it is recorded rather than summarised.

`src/app/(dashboard)/dashboard/page.tsx` composes itself from the plan: `hasCRM` renders
`CrmSection`, `hasWFA` renders `WorkforceSection`, `hasSFA` renders `SalesSection`. A WFA tenant
sees exactly one section; a CRM+SFA tenant sees all three.

**Today-scoped (from local midnight).** These are the tiles a prospect sees first:

- `WorkforceSection` — `location_pings` today drives the live agent map, "Active Field Agents",
  "Distance Tracked" (Haversine per user) and "Average Battery"; `site_visits.check_in_at` today
  drives "Visits Logged Today".
- `loadWorkforceMetrics` — `expenses.status = 'Pending'` and `leaves.status = 'Pending'` drive
  the two approval tiles.
- `loadSalesMetrics` — `orders.created_at` today and month-to-date drive "Orders Today" and
  month value; `status in ('Approved','Part Dispatch')` drives "Pending Dispatch".
  Order *value* counts only `Pending | Approved | Part Dispatch | Dispatched | Closed` —
  Cancelled and Rejected never count.
- `loadMetrics` (CRM) — leads today vs yesterday, pipelines today vs yesterday, open-deal value.

**Trailing windows**, from `src/lib/dashboard/analytics-period.ts`: Daily = 30 buckets,
Monthly = 12, Quarterly = 8, Yearly = 5. Twelve months of history fills the Daily and Monthly
lenses completely and gives the Quarterly lens 4–5 real bars. Five years of history to fill the
Yearly lens is not worth the rows; the Yearly chart showing 1–2 bars is acceptable.

**Activity feed** (`loadActivity`) reads `messages` (sender_type `customer`), `contacts`, `deals`,
`broadcasts` and `automation_logs` — so the two CRM tenants need conversations and messages, not
just leads, or the feed is one-dimensional.

## Architecture: one generator, two callers

```
src/lib/demo/
  profiles.ts     the four tenant definitions (plan, company, industry, cities, catalogue)
  rng.ts          mulberry32 + pick/between, lifted from the playconsole script
  shape.ts        the realism rules: growth curve, weekday mask, festive lift, rep skill spread
  tenant.ts       build/teardown a tenant's structure (account, people, masters, catalogue, customers)
  history.ts      generate transactional history for a date range
  refresh.ts      top up "today" up to a given clock time
scripts/seed-demo-accounts.ts          run once; --apply / --only=<key> / --teardown
src/app/api/cron/demo-refresh/route.ts nightly + on-demand top-up
```

The generator lives in `src/lib/demo/` as TypeScript rather than in a `.mjs` script because the
cron route must run the *same* code. Two copies of "what does a realistic day look like" is
exactly the drift this repo already had to rescue the pricing engine from. `tsx` is already a
devDependency, so the script runs as `npx tsx scripts/seed-demo-accounts.ts`.

### Why a cron at all

Every headline tile is today-scoped. Seed once and the history charts stay beautiful forever
while the top row of the dashboard reads zero on every day except the day it was seeded — and
the top row is what a prospect looks at first.

`refresh.ts` is therefore idempotent per account per day and **clock-aware**: it writes today's
events only up to the wall-clock moment it runs. Called at 11:00 it produces a GPS trail from
09:40 to 11:00; called again at 17:00 it extends the same day to 17:00. Nothing is ever
future-dated, so the Location Tracking timeline never shows a rep working at a time that has
not happened.

Each run also does three housekeeping jobs, so the tenants stay the same size forever instead of
growing without bound:

1. **Rolls up and prunes GPS.** Pings older than 7 days are summarised into
   `location_daily_summary` and deleted — the same order the retention job uses
   (`requiresSummary`), so a failed roll-up never loses a day's distance.
2. **Tops up the approval queues.** Always leaves 3 `expenses` and 2 `leaves` sitting in
   `Pending`, so the two approval tiles never read zero no matter how long ago the tenant was
   seeded.
3. **Clears its own notification noise** (see below).

Schedule: `0 */2 * * *` in `vercel.json`, alongside the existing `/api/cron/retention` entry.
The route is also callable by hand with the cron secret, for a forced top-up minutes before a
meeting.

**Constraint to confirm at build time:** Vercel's Hobby tier allows 2 cron jobs at daily
granularity only. One daily entry is already in use by retention. If the project is on Hobby,
the schedule degrades to `0 2 * * *` (once at 02:00) and today's data is written for the full
09:30–18:30 window up front, which re-introduces future-dated rows for part of the day. Pro
tier supports the 2-hourly schedule. Verify before choosing.

## The four tenants

Each is defined once, in `src/lib/demo/profiles.ts`. The plan decides which sections exist;
the industry decides what the data is about.

| Key | Company | Industry | Plan | Reps' cities |
| --- | --- | --- | --- | --- |
| `wfa` | Shreeji Facility Services | Housekeeping & facility management | `WFA` | Ahmedabad, Gandhinagar, Nadiad, Anand, Mehsana |
| `sfa` | Balaji Agencies | FMCG distribution | `SFA` | Surat, Navsari, Vapi, Bharuch, Valsad |
| `wfacrm` | CoolCare Home Services | AC & appliance service | `CRM_WFA` | Pune, Pimpri, Nashik, Ahmednagar, Satara |
| `sfacrm` | Satyam Ceramics & Sanitary | Tiles & building materials | `CRM_SFA` | Rajkot, Morbi, Jamnagar, Gondal, Junagadh |

Real coordinates per city; customers scatter 2–8 km around their rep's city, so the live map and
the route lines look like a working territory instead of five pins on one dot.

Account configuration per tenant:

- `subscription_status` `active`, `subscription_expires_at` `2027-12-31` — no trial or expiry
  banner can appear mid-demo (the header warns inside a 15-day window).
- `is_provisioned` `true`, `user_count` 10 (6 logins + headroom).
- `module_settings` = `defaultModuleSettings(plan)` from `src/lib/plans/catalog.ts`, then
  deliberately switch **on** the demo-worthy opt-outs the plan allows: `route` for the two SFA
  tenants (Beat Planning is a strong demo), leaving `scheme`, `stock` and
  `reporting_hierarchy` off. `reporting_hierarchy` stays off so the admin sees every rep's data
  without a hierarchy to configure.
- `geo_fencing.enabled` `false`. A geo-fence blocks visit check-in when the rep is not at the
  customer, which would stop a prospect checking in from your office. Matches the Play Console
  tenant's deliberate choice.
- `tracking_settings` enabled, 09:30–18:30, working days Mon–Sat, 10-minute interval.
- `territory_settings.assignment_mode` `direct` and customers assigned via
  `contacts.employee_id`, so there is no area-assignment step between a rep and their customers.

### People: 6 logins per tenant

One owner/admin (web) plus five sales executives (mobile-only, `web_access: false`), the same
five names in every tenant so there are five names to remember rather than twenty:

| Name | Employee code | Email pattern |
| --- | --- | --- |
| Rahul Mehta | EMP-001 | `rahul.<key>@gmail.com` |
| Priya Sharma | EMP-002 | `priya.<key>@gmail.com` |
| Amit Patel | EMP-003 | `amit.<key>@gmail.com` |
| Sneha Deshmukh | EMP-004 | `sneha.<key>@gmail.com` |
| Vikram Singh | EMP-005 | `vikram.<key>@gmail.com` |

where `<key>` is `wfa` / `sfa` / `wfacrm` / `sfacrm`. So `rahul.sfa@gmail.com`,
`rahul.wfacrm@gmail.com`, and so on. Password `123456` throughout.

These are syntactically real Gmail addresses that may belong to real people. Nothing is ever
sent to them: users are created with `email_confirm: true` and no invitation, exactly as the
Play Console tenant's `test1@gmail.com … test20@gmail.com` logins already are. Accepted
knowingly, on the same precedent.

Each rep gets the stock `Sales Executive` employee role that `provision-account` seeds for the
plan, `default_approver_id` pointing at the owner profile, and `mobile_access: true`.

**Devices are not pre-seeded.** `employee_devices` rows self-register on first login; the mobile
app reads that table only in `FieldTrackingService` for health reporting and does not gate login
on it (39 device rows exist in prod, 7 of them not `active`, and those testers logged in). If
tracking ever reports "device pending approval", it is one click on the web Employees screen.

## The history generator

### Volumes per tenant, over 12 months

| Data | WFA | SFA | CRM_WFA | CRM_SFA |
| --- | --- | --- | --- | --- |
| Customers (`contacts`) | 60 sites | 150 retailers | 90 households | 140 dealers |
| Products / categories | — | 60 / 5 | 20 / 3 | 80 / 6 |
| `site_visits` | ~6,000 | ~6,000 | ~5,000 | ~6,000 |
| `tracking_sessions` | ~1,300 | ~1,300 | ~1,300 | ~1,300 |
| `location_pings` | last 7 days only | last 7 days only | last 7 days only | last 7 days only |
| `location_daily_summary` | 12 months | 12 months | 12 months | 12 months |
| `expenses` | ~800 | ~800 | ~800 | ~800 |
| `leaves` (+ `leave_days`) | ~30 | ~30 | ~30 | ~30 |
| `orders` (+ `order_items`) | — | ~3,300 | — | ~2,800 |
| `payments` | — | ~2,500 | — | ~2,200 |
| `order_dispatches` | — | per Closed order | — | per Closed order |
| `leads` / `deals` / `quotations` | — | — | 600 / 300 / 250 | 600 / 300 / 250 |
| `conversations` / `messages` | — | — | ~120 / ~900 | ~120 / ~900 |
| `tasks` | ~400 | ~400 | ~500 | ~500 |

Roughly 30,000 transactional rows plus ~8,000 pings across all four tenants. Well within a
single Postgres instance; inserted in batches of 500.

### Why GPS is 7 days of pings and 12 months of summaries

`src/lib/retention/policy.ts` deletes `location_pings` older than 365 days
(`cls: "tracking"`, `requiresSummary: true` — a day is only deletable once rolled into
`location_daily_summary`), and `location_daily_summary` is deliberately **not** in
`RETENTION_RULES` because it is the surviving record. Seeding a year of raw pings would be
~70,000 rows per tenant that the retention job is already designed to throw away, and nothing
reads raw pings beyond a few days except the per-day replay screen.

So: full 10-minute pings for the last 7 days (replay works for the days anyone will click), and
`location_daily_summary` rows — distance, ping count, first/last position — for all 12 months, so
distance history and attendance reports are complete. This is exactly the shape a real
year-old tenant's data has after retention has run on it.

### The realism rules

Random data reads as fake. These seven rules are what make it read as real, and they live in
`shape.ts` where they can be tested:

1. **Monthly growth of 5–8%.** Every trend chart slopes up. A flat random series is both
   unconvincing and unimpressive.
2. **Festive lift.** October–November at ×1.35 for the two distribution tenants; March at ×1.15
   (year-end) for all four.
3. **Real calendars.** Sundays near-zero, Saturdays at 60%, and `holidays` from the tenant's
   `holiday_lists` excluded. `holiday_lists.weekly_offs` is honoured rather than a hardcoded
   Mon–Fri — the same bug the Leave Management build had to fix.
4. **Rep skill spread.** Fixed multipliers 1.35 / 1.15 / 1.00 / 0.85 / 0.70 across the five
   reps, so the "Top Salespeople" and "Top Agents" leaderboards rank meaningfully and a
   prospect can be shown performance management rather than five identical bars.
5. **Order status mix:** 58% Closed, 14% Dispatched, 10% Approved, 9% Part Dispatch, 5% Pending,
   4% Cancelled. Gives the status donut real slices and a non-zero "Pending Dispatch" tile.
   `orders.status` has no check constraint; these strings must match
   `sales-queries.ts` exactly or the value tiles silently drop them.
6. **Money that does not reconcile perfectly.** Payments cover 70–95% of each customer's closed
   order value, with 15% of customers deliberately 60+ days overdue, so Outstanding, Overdue,
   Credit and Ageing all show real numbers. `outstanding_settings` on these tenants counts
   orders in `Closed` and payments in `Approved`, so the generator must respect those two
   statuses or the outstanding widgets read zero. ~8% of payments left `Pending`.
7. **No round numbers.** Product prices and amounts end in non-zero rupees (₹1,245, not ₹1,000).

Plus two linkage rules that make charts work rather than merely populate:

- **45% of visits produce an order**, written as `orders.site_visit_id`. "Productive visits" in
  `wfa-analytics` / `sfa-analytics` is defined as a visit that produced an order, so without this
  link the productivity chart is flat.
- **Sales value is dated by dispatch completion**, not order date (per the Sales Report build).
  Every `Closed` order therefore gets an `order_dispatches` row with a `dispatched_at` a few days
  after the order date, or the Sales series and the Order-vs-Sales comparison disagree.

### Numbering and triggers

`order_number`, `payment_number`, `expense_number`, `leave_number`, `quotation_number`,
`deal_number` and `dispatch_number` are all NOT NULL and all filled by BEFORE-insert triggers
(`set_order_number`, `trg_set_payment_number`, `set_expense_number`, `trg_set_leave_number`,
`set_quotation_number`, `set_deal_number`, `set_dispatch_number`) off `account_sequences`.
The generator inserts without them and lets the triggers run — it must not invent numbers, or
the per-account sequence and the stored numbers drift.

Two other triggers fire on this volume and matter:

- Every `contacts` insert fires `trg_emit_customer_created` and `trg_notif_customer_created`,
  and the territory-denormalising BEFORE-write trigger. The first two queue rows in
  `automation_events`, `notification_outbox` and `notifications`.
- Order, payment and expense inserts queue their own notification rows.

So the final phase of both the seeder and the refresh clears `automation_events`,
`notification_outbox` and `notifications` for the demo accounts — the same `clearSeedNoise`
pass the playconsole script ends with, for the same reason: 30,000 seeded rows would otherwise
bury the admin's notification centre on first login. The refresh re-clears nightly so it cannot
accumulate.

### The two id spaces — the most likely way this goes silently wrong

`profiles.id` and `profiles.user_id` (the auth user id) are different uuids, and the columns that
point at a person are split between them — sometimes **within the same table**. Writing the wrong
one either raises a foreign-key error (loud, fine) or inserts a row that every query then fails
to find (silent, and the tile just reads zero). Read from the live schema, not assumed:

| Column | Points at |
| --- | --- |
| `contacts.employee_id` | `profiles.id` |
| `contacts.user_id` | auth `users.id` |
| `expenses.employee_id` | `profiles.id` |
| `expenses.approved_by` | auth `users.id` |
| `leaves.employee_id` | `profiles.id` |
| `leaves.applied_by` | `profiles.id` |
| `leaves.approved_by` | auth `users.id` |
| `leave_days.employee_id` | `profiles.id` |
| `site_visits.user_id` | auth `users.id` |
| `location_pings.user_id` | auth `users.id` |
| `tracking_sessions.user_id` | auth `users.id` |
| `orders.user_id` | auth `users.id` |
| `payments.user_id` | auth `users.id` |
| `payments.approved_by` | auth `users.id` |
| `quotations.user_id` | auth `users.id` |
| `deals.user_id`, `deals.creator_id` | auth `users.id` |
| `deals.assigned_to` | `profiles.id` |
| `leads.user_id`, `leads.owner_id` | auth `users.id` |
| `tasks.user_id` | auth `users.id` |
| `tasks.assigned_user_id`, `tasks.employee_id` | `profiles.id` |
| `employee_devices.profile_id` | `profiles.id` |
| `location_daily_summary.user_id` | **no FK** — must still be the auth id, to match `location_pings` |

`location_daily_summary.user_id` has no foreign key at all, so a wrong id there inserts cleanly
and then simply never joins. It is the one column in this list that cannot fail loudly.

Mitigation: `tenant.ts` returns each rep as `{ profileId, userId }` and `history.ts` takes that
pair, never a bare id. A unit test asserts that every generated row's person column was taken
from the correct field of that pair.

### Dates are account-local

Every date written is computed in the tenant's local timezone (IST) and not via
`toISOString()` on a UTC-midnight boundary. `orders.date` / `payments.payment_date` /
`expenses.expense_date` are `date` columns read by the report engine, while the dashboard tiles
read `created_at`/`check_in_at` timestamps — both must land on the same local day or the
dashboard and the reports disagree about what happened today. This is the same mistake that
made the dashboard trend charts render empty once before.

## Known gap, accepted

**The WFA tenant's "Productive Visits" chart will read zero.** A productive visit is one that
produced an order, and `orders` is gated `line: "sfa"` in `sidebar.tsx` — a WFA-only plan has no
Orders module at all. Forcing orders into that tenant would make the chart move while showing a
prospect data that contradicts the plan they are being sold.

Decision: leave it at zero, and demo the WFA tenant on attendance, visits, distance, expenses
and leaves, which is what a facility-services prospect is buying. Recorded here so it is a known
product behaviour at demo time rather than a surprise.

## Safety

- Every write is scoped to the four new account ids. Account `001001` (the founder's own) and
  `001288` (Play Console) are never read from or written to. The seeder asserts the account id it
  is about to touch is one it created, and the cron route refuses any account whose
  `customer_id` is not in its own demo set.
- `--teardown` removes the four tenants completely, auth users included, by the same phase order
  reversed.
- Default run is a dry run that prints the plan; `--apply` is required to write.
- `--only=<key>` builds or tears down a single tenant, so one broken tenant does not require
  rebuilding all four.

## Testing

Unit tests (vitest, alongside the existing `src/lib/dashboard/*.test.ts` set) on the pure parts,
because those are where a silent wrong number comes from:

- `shape.ts` — growth curve is monotonic across 12 months; weekend/holiday mask excludes the
  right days; rep multipliers sum to a sane total; festive lift lands in the right months.
- `history.ts` — the status mix matches the declared percentages within tolerance; 45% of visits
  carry an order link; every Closed order has a dispatch row; payment totals fall in the 70–95%
  band; no generated date lands on an excluded day.
- A guard test that the demo account-key set is disjoint from `001001` and `001288`.

Verification after apply, printed by the script and checked by hand on prod:

- Row counts per table per tenant against the volume table above.
- Open each of the four dashboards as its admin and confirm: no tile reads zero except the WFA
  productive-visits chart; the live map shows 5 agents; Daily and Monthly lenses both render
  full series; Outstanding / Overdue / Ageing are non-zero on the two SFA tenants.
- Log in as `rahul.sfa@gmail.com` on the Android app and confirm customers, visits, order
  booking and punch in/out all work.

## Out of scope

- No mobile APK build or `eas update` is triggered. Mobile code is not touched by this work.
- FSM-line tenants (`FSM`, `CRM_FSM`, `SFA_FSM`) are not seeded; nothing is built on that line yet.
- No changes to any shipped feature. This adds a generator, a script and a cron route, and
  writes data. The only edit to existing files is the `vercel.json` cron entry.
