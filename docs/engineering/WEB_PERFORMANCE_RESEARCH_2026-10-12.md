# Why the web app feels slow — and what it will do when real data arrives

**Date:** 2026-10-12
**Question asked:** "Many buttons take long to respond. Today's data is nothing.
When we go live there will be lots of data. Solve this properly."

This is the answer, measured rather than guessed.

---

## How this was measured

- A **production build** (`npm run build` + `next start`), not the dev server.
  The dev server compiles pages on demand and is always slower, so it would
  have given fake numbers.
- Signed in as the real test tenant (001288) against the live Mumbai database.
- Every network request the browser made was recorded, with its duration, for
  a cold page load and for clicking around inside the app.
- Main-thread "long tasks" (anything that freezes the screen for more than
  50 ms) were recorded too.

Nothing was created, edited or deleted. The probe only opened pages.

### What came back

| Page | Click to content on screen | Data requests |
|---|---|---|
| Dashboard (cold load) | ~4 s | 60+, many of them repeats |
| Customers | 1,898 ms | 10 |
| Orders | 475 ms | 11 |
| Leads | 146 ms | 1 |

**Long-task time was 0 ms on every page.** That matters: the browser is not
busy. The screen is not frozen by our JavaScript. The app is simply **waiting
for the database**, and it waits far more often than it needs to.

So "the button is slow" is not a rendering problem. It is a *data fetching*
problem. That is good news, because data fetching is the part that is cheap to
fix and the part that gets catastrophically worse with scale.

---

## Root cause 1 — list pages download the **entire table**, every time

Opening Customers runs this:

```ts
supabase.from('contacts').select('*').order('created_at', { ascending: false })
```

There is no `.limit()` and no `.range()`. It asks for **every customer row, with
every column**. The browser then sorts, filters and paginates that list in
memory, and the table shows 20 of them.

The same page also pulls every tag, every custom field, every profile, every
territory and every area assignment — all unbounded.

A scan of the codebase found **479 queries with no row limit**. The ones that
matter are the tables that grow forever:

| Table | Unbounded queries |
|---|---|
| contacts | 27 |
| payments | 16 |
| tasks | 14 |
| orders | 13 |
| products | 11 |
| leads | 10 |
| location_pings | 7 |

**What this means at scale.** A customer row is roughly 1 KB of JSON.

| Customers in the account | Downloaded per visit to the page |
|---|---|
| 200 (today) | ~0.2 MB — fine |
| 10,000 | ~10 MB |
| 100,000 | ~100 MB |

On an Indian 4G connection, 100 MB is several minutes, repeated on every single
visit to the page. The browser tab will run out of memory before that finishes.

**This is the one that turns "a bit slow" into "the app does not work."**

### DONE — shipped 2026-10-12

All eleven growing list screens now page on the server: Orders, Leads,
Contacts, Payments, Products, Tasks, Expenses, Quotations, Dispatches, Pending
Dispatch and Visits. Each sends one indexed query per page instead of
downloading its table.

Verified on a production build against the live database: every screen sends
exactly one paged request, makes no unbounded request for its own table, and
fires one debounced search query rather than one per keystroke.

The search itself was proved equivalent rather than assumed — the old
client-side predicate was rebuilt in SQL from its source tables and diffed
against the new `search_text` column over ~42,000 real rows, for six search
terms, on all ten tables. Zero rows differed.

Setup data (categories, units, roles, announcements, broadcasts, employees)
deliberately keeps client paging with a 500-row tripwire; the deals kanban is
capped at 1,000 because a board must show every stage at once and needs
per-stage paging as its own piece of work.

### How the fix was built

`src/components/ui/data-table/data-table.tsx` already supports a
`serverPagination` mode: the page hands it one page of rows plus a total count,
and the footer's Prev/Next call back for the next page instead of slicing an
array in memory.

**Only 1 of our 27 tables uses it** — Service → Assets, the newest module.
The other 26 still download everything.

So this is not a redesign. It is wiring 26 existing pages into a component
that already does the right thing.

---

## Root cause 2 — the dashboard reads the same table five times over

Recorded on one cold load of `/dashboard`:

```
x5  payments?select=amount,verified_amount&status=in.(...)
x4  payments?select=contact_id,amount,verified_amount&status=in.(...)
x3  orders?select=total_amount&status=in.(Closed)
x3  contacts?select=opening_balance
x3  contacts?select=id,name,company,credit_limit,opening_balance
x3  orders?select=contact_id,total_amount
```

`src/lib/dashboard/payment-queries.ts` has several separate functions. Each one
downloads **the whole payments table** and then adds the numbers up in
JavaScript:

```ts
const { data } = await supabase.from('payments').select('amount, verified_amount')…
return (data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0)
```

Two things are wrong here:

1. **Adding up should happen in the database, not the browser.** Postgres can
   return one number. Instead we ship every row to the phone and add them there.
2. **The same download happens five times** because each tile asks for it
   separately and nothing shares the result.

At 500,000 payment rows, that is five full-table downloads to draw a handful of
KPI tiles.

**The fix:** one database function (RPC) per dashboard section that returns the
finished numbers, called once. Postgres sums a million rows in milliseconds; the
network never sees them.

---

## Root cause 3 — the login context reloaded itself on every auth event *(fixed)*

`supabase-js` fires `onAuthStateChange` immediately when you subscribe
(`INITIAL_SESSION`), again when the access token rotates (`TOKEN_REFRESHED`),
and again when the tab regains focus (`SIGNED_IN`). `AuthProvider` re-ran the
full profile + account fetch on **every one of those**, on top of the fetch its
own `init()` had already done.

Measured effect: **3 identical `/rest/v1/profiles` requests and 3 identical
`/rest/v1/accounts` requests per page load**, each 200–400 ms.

The cost is worse than the three requests. `AuthProvider` sits at the root of
the app, so each fetch pushed brand-new `profile` and `account` objects into the
context. Every screen re-rendered, and every `useEffect` that depends on
`profile` or `account` re-ran — firing *its* queries again. That is a large part
of why a click mid-session feels dead: the app was quietly reloading itself
underneath.

**Fixed in this change.** The listener now only re-fetches when the signed-in
**user actually changes**, and keeps the previous `user` object when nothing
about it moved, so the context stops re-rendering the app for nothing. The same
guard is on `init()`, because `getSession()` is async and `INITIAL_SESSION`
usually lands first. `refreshProfile()` is untouched — that is still how the
settings screen forces a reload after an edit.

**Measured, same probe, before and after, cold load of `/dashboard`:**

| | Before | After |
|---|---|---|
| `profiles` fetched | 3x | 1x |
| `accounts` fetched | 3x | 1x |
| Distinct queries issued more than once | 12 | 4 |
| Requests wasted on repeats | 24 | 6 |
| Total data requests | not captured | 35 |

The knock-on effect is bigger than the four requests removed. Because the root
context stopped handing out new `profile` / `account` objects, the dashboard's
own effects stopped re-running — which is why the repeated `contacts` and
`orders` queries disappeared too without anyone touching the dashboard code.

---

## Root cause 4 — no row virtualization

Every row the table receives becomes real DOM. At 20 rows per page that is
invisible. It only becomes a problem once a screen legitimately shows thousands
of rows (the route planner already notes this and handles its own). Worth
knowing, but it is behind the three above.

---

## The plan, in the order it should be done

### Stage 1 — stop the duplicate work (small, safe, do first)

| # | Work | Effect |
|---|---|---|
| 1.1 | ✅ **Done** — auth listener no longer re-fetches on every event | −4 requests and one app-wide re-render per page load |
| 1.2 | Share one in-flight request per query key, so two components asking for the same thing get one network call | Removes the x3 / x5 repeats across the whole app |
| 1.3 | Cache reference data (tags, custom fields, units, territories, profiles) for the session instead of re-downloading per page | ~5 fewer requests per page |

1.2 is the single highest leverage item left. A small fetch-deduplication layer
(or adopting TanStack Query, which does this plus caching and background
refresh) removes a whole class of this bug permanently rather than one call site
at a time.

### Stage 2 — server pagination on the 26 list pages (the scale fix)

For each list page:

- query with `.range(from, to)` and `{ count: 'exact' }`
- push search, filter and sort **into the query** instead of filtering an
  in-memory array
- pass `serverPagination` to `DataTable` (the component already supports it)

Do them in order of how fast the table grows:
**contacts → orders → payments → tasks → leads → products → everything else.**

Budget roughly half a day per page. Customers and Orders alone remove the worst
of it.

Each page needs its filter/sort columns indexed. Most already are from the
2026-09-13 index sprint; confirm per page with `EXPLAIN` before shipping.

### Stage 3 — dashboard aggregates in SQL

Replace the download-and-sum functions in `src/lib/dashboard/*-queries.ts` with
one RPC per section returning finished numbers. Start with
`payment-queries.ts` — it is the worst offender and it is self-contained.

**Care needed:** these are money figures. Each RPC must be checked against the
current JavaScript result on a real account before it replaces it.

### Stage 4 — instant feedback on navigation

Client-side navigation commits in 125–350 ms, and only then does the page start
asking for data. That gap is the "dead button" feeling even when everything else
is fast. Add a `loading.tsx` skeleton per route group (only 4 routes have one
today, all under `/service`) so something appears the moment a link is clicked.

Cosmetic rather than structural — but it is the part the user actually *feels*,
so it should not be skipped.

---

## What was NOT the problem

Worth recording so nobody chases these:

- **Not the database.** Individual queries came back in 150–400 ms from Mumbai.
  That is a normal round-trip, not a slow query.
- **Not rendering.** Long-task time was 0 ms on every page measured.
- **Not the bundle size.** Pages committed in 125–350 ms.

The app is slow because it asks for too much, too often — not because any one
thing it asks for is slow.
