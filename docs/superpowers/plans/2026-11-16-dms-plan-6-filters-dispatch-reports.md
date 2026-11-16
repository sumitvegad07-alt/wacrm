# OZZO DMS Plan 6 — a filter on every column, who did it, dispatch, and the three screens still missing

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use
> checkbox (`- [ ]`) syntax.

**Founder, 2026-11-16, after dms.ozzo.co.in went live:**

> 1. *"I want searchable filters on each raw on the table not the universal so that
>    Customers can filter things as they need."*
> 2. *"Build collected by/booked by column."*
> 3. *"Create Dispatch and pending dispatch sections for Distributors same to same as our
>    OZZO Standard so that distributors can dispatch their sales orders."*
> 4. *"Than we need Reports, My Activity, follow-ups, Same to same as we have in our OZZO."*

**What is already live on production** (probed 2026-11-16 by calling each function with the
anon key and reading PGRST202 vs a real answer): `portal_orders`, `portal_payments`,
`portal_customers` all accept `p_search` and `p_status`, and `portal_order_detail` answers.
So every Plan 5 block has been pasted. `portal_payment_detail` answers `42501` — it exists
but is granted to `authenticated` only, which is correct.

---

## 0. What point 1 actually asks for, and why the current filter is not it

Plan 5 §3 shipped **one search box and one status dropdown above** each list
(`components/table-filters.tsx`). That is the "universal" filter he is saying is not what he
wanted. OZZO's own tables carry a **permanent second row under the headings, one control per
column** — `components/ui/data-table/data-table-filter-row.tsx`, 607 lines, four control
kinds:

| Column kind | Control | Behaviour |
|---|---|---|
| `text` | inline input with a search icon | 300ms debounce, holds its own draft |
| `select` | popover with checkboxes | multi-select, chip shows "Migration pharm" or "3 selected" |
| `range` | popover, From / To | money, because a *contains* match on 100 also matches 1,100 |
| `date` | popover with presets + custom range | Today / Yesterday / Last week / This month / … |

A filtered cell shows its value as a chip with an × — the applied filter is readable without
opening anything. That is the thing to copy, class for class, as the rest of the portal was.

### The constraint the portal's filters sit under, which the CRM's do not

The CRM filters by building a PostgREST query in the browser. **The portal may not read a
table at all** (`app/portal-screens.test.ts` fails the build if it does), so every filter has
to reach the `portal_*` function as an argument.

**So the filters travel as ONE `p_filters jsonb` argument, not as a new `p_` per column.**
Four reasons, and the fourth is the one that matters:

1. Orders alone would need seven new arguments; payments eight.
2. `DROP FUNCTION ... (old signature)` runs on every deploy of a new argument list, and
   between the CREATE and the DROP a running portal can call a signature that no longer
   exists. One jsonb argument is added **once**.
3. A future column needs no migration at all.
4. **A jsonb bag is not a SQL injection surface here** because nothing in it is ever
   interpolated: each key is read by name through a typed helper
   (`portal_filter_text/list/num/date`), and a key the function does not name is ignored.
   The text helpers `btrim` and the numeric/date helpers refuse anything that is not a plain
   number or an ISO date, so a hostile value is a NULL filter, never a cast error and never a
   fragment of SQL.

- [x] **0.1** Migration `20261116140000_portal_column_filters_and_who.sql` — the four
      helpers, then `portal_orders` / `portal_payments` / `portal_customers` each gaining
      `p_filters jsonb DEFAULT NULL`. **Every existing argument stays, in place, defaulted.**
- [x] **0.2** `components/filter-row.tsx` in the portal: the CRM's four cells, its chip, its
      × and its debounce, driven by the URL (`f_<key>=…`) so a filtered list keeps an address.
      `components/ui/checkbox.tsx` is copied from the CRM verbatim, like the other primitives.
- [x] **0.3** `Column<T>` gains `filter?: { key, type, options? }`; `DataTable` renders the
      row under the headings and nothing at all when no column declares one.
- [x] **0.4** `lib/portal/list-filters.ts` — one place that turns `searchParams` into the
      jsonb bag and back, with tests: a hostile `amount_min=1;drop` becomes no filter; an
      unknown key is dropped; an empty array is dropped, not sent as `[]`.
- [ ] **0.5** The Export button must carry the filtered set. It already reads the same rows
      the screen does, so this is a test, not a change.
- [x] **0.6** Scenarios in `supabase/tests/`: a column filter narrows BOTH the rows and the
      `total`; a filter on another distributor's customer still returns nothing; an unknown
      key is ignored rather than erroring.

## 1. "Booked by" and "Collected by" — Plan 5 §2, now his point 2

**This reverses spec §17 q4** (his own ruling of 2026-11-07: *no employee is ever named to a
distributor*). Plan 5 §0 is the argument for why he is right to reverse it — the cash in the
rep's pocket at 6pm is the distributor's cash, and a distributor who can see ₹5,000 collected
but not who is holding it cannot chase it. **The narrow version is the one built: the NAME,
and nothing else about the person** — no employee code, no phone, no role, no territory.

* **Booked by** is already denormalised: `orders.salesman_name`, maintained by a trigger
  (migration `20261012100000`). No join, and it is already filterable. Where
  `placed_by_portal_contact_id` is set, the answer is the distributor's own business name,
  not an employee — they booked it themselves.
* **Collected by** is `payments.user_id` → `profiles.full_name`, the same resolution the
  CRM's own Payments list does (`app/(dashboard)/payments/page.tsx:176`). A portal-recorded
  receipt reads as the distributor's own name.

- [x] **1.1** `booked_by_name` on `portal_orders` rows and `portal_order_detail`;
      `collected_by_name` on `portal_payments` rows and `portal_payment_detail`.
- [x] **1.2** Scenario: the name appears; **and the payload contains no email, no phone, no
      employee code and no role** — asserted against the JSON text, not column by column, so
      a future field cannot leak in unnoticed.
- [x] **1.3** Both columns on their lists, in MANAGE COLUMN, in the export, and filterable
      as `text` — which is the whole point of pairing this with §0.
- [x] **1.4** Record the reversal in the spec's §17 q4 with the reason.

## 2. Dispatch and Pending Dispatch — his point 3

> *"so that distributors can dispatch their sales orders"*

This is **not** Plan 5 §4. That one showed the distributor what the company had sent *them*
(their purchase orders), and it is built. This is the other direction: the distributor
shipping to their own shops, which is a **write**, and the first one the portal makes against
`order_dispatches`.

### What OZZO does, which is what "same to same" means

* **Pending Dispatch** (`app/(dashboard)/pending-dispatch/page.tsx`) lists orders whose status
  is `Approved` or `Part Dispatch`, with Ordered / Delivered / Difference, and a **Dispatch**
  button per row that opens the form with the order prefilled.
* **Dispatch** (`app/(dashboard)/dispatches/page.tsx`) lists what has shipped: dispatch
  number, order number, customer, date, invoice no, item count, value.
* **The form** (`components/dispatches/dispatch-form.tsx`) is one dispatch against ONE order.
  Lines are that order's items **capped at remaining quantity** (ordered − already shipped),
  prices inherited read-only, plus invoice no/date, transporter, contact, LR no/date, notes.
  Saving inserts `order_dispatches` + `dispatch_items`; a trigger moves the order to
  `Part Dispatch` or `Dispatched`.

### The rules the portal version has to add

1. **Only the distributor's own sales orders.** The order's buyer must be in
   `portal_visible_contact_ids()` **and must not be the caller themselves** — a distributor
   does not dispatch the order they placed on the company. That is the company's job, and
   letting them mark it shipped would corrupt the primary ledger.
2. **Never more than remains.** Checked in the database, not the browser, per line:
   `ordered − already dispatched`. The form's cap is a courtesy; the function's is the rule.
3. **Idempotent on `p_dispatch_id`**, like `portal_place_order`, or a double-tap ships twice.
4. **`SET search_path = public`, not `''`** — it writes, so the dispatch-number generator and
   the order-status trigger run, and those name their tables unqualified. This is Plan 4's
   trap 2 and it will bite again.
5. **No person is named on the way out.** A transporter is a company and a docket is a
   number; no driver and no delivery boy. Spec §17 q4's narrow reading still holds — §1
   reversed it only for *who booked and who collected*.

- [x] **2.1** `supabase/tests/76_portal_dispatch_write.sql` FIRST: D1 dispatch an own shop's
      approved order → allowed, order becomes Part Dispatch; D2 over-ship one line → refused;
      D3 dispatch another distributor's order → refused; D4 dispatch their OWN purchase order
      → refused; D5 replay the same `p_dispatch_id` → one dispatch, not two; D6 a revoked
      login → refused; D7 a cancelled order → refused; D8 the figures agree with the CRM's
      own ordered/delivered arithmetic.
- [x] **2.2** Migration: `portal_pending_dispatch(p_filters…)`, `portal_dispatches(…)`,
      `portal_dispatch_detail(p_dispatch_id)`, `portal_order_lines_for_dispatch(p_order_id)`
      and `portal_create_dispatch(p_dispatch_id, p_order_id, p_lines jsonb, p_header jsonb)`.
- [x] **2.3** Mutation-checked, `scripts/mutation-check-portal-dispatch.sh`. All three rules
      removed in turn; D4, D5 and D9 each watched to FAIL. **D4 was asleep at first and the
      check is what found it**: ORD_P1 was Pending, so the scenario was refused by the
      STATUS rule before the ownership rule was reached, and then by the empty-lines rule
      when `portal_dispatch_lines` (correctly) refused to hand over the caller's own
      purchase order. D4 now sends a real line captured as the admin, so the ownership
      check is the only thing that can refuse it.
- [x] **2.4** Screens: `/pending-dispatch`, `/dispatches`, `/dispatches/new`,
      `/dispatches/[id]`, both in the sidebar, both with the §0 filter row.
- [x] **2.5** A dispatch print sheet, A4/A5, at `/print/dispatches/[id]` — the delivery
      note. Two differences from the order sheet, both because of what the document is
      FOR: **Ordered and Sent side by side** (a note that printed only what was sent
      makes "is this everything?" a phone call) and **a signature line**. The
      distributor's name leads, not the company's: on a delivery note they are the
      sender. A print icon sits on the Dispatch list too.

## 3. Reports, My Activity and Follow-ups — his point 4

### Reports

**`execute_report` must not be reused.** Its live body is in no repo file — it is patched in
place on production ([[report-engine-is-patched-in-place]]) — and every one of its scopes
reads `profiles` and the rights registry, which a portal login does not have. A portal report
is its own function or it is a cross-tenant leak waiting to happen.

Four reports, which are the four a distributor actually runs, each scoped to
`portal_visible_contact_ids()`:

| Report | Answers |
|---|---|
| **Sales** | what I sold, by day / by customer / by product |
| **Collection** | what I collected, by day / by customer / by mode, and by whom |
| **Outstanding** | who owes me what, with the ageing buckets OZZO uses |
| **Order** | what is ordered, what is dispatched, what is still open |

Each is the same shape as OZZO's: a filter bar, a table, a total row, Export and Print.

### My Activity / Follow-ups

In OZZO these are **one screen** — `/follow-ups`, labelled **My Activity** in the sidebar
(`components/layout/sidebar.tsx:206`). It is the `tasks` table filtered to the signed-in
person, with Status (Undone/Done), Period, Type (Task/Call/Visit/Meeting/Follow up/Note),
Priority and a search box.

**A portal login has no `profiles` row**, so "assigned to me" cannot mean a profile id. The
portal's version is the distributor's own list against their own shops:
`tasks.portal_contact_id` — a new nullable column, and therefore **five questions in the
migration's own comments** per the working agreement. A task with that column set belongs to
a distributor; every existing task has it NULL and every existing screen is unchanged.

**Open question for him, not blocking:** should the company's staff *see* a distributor's
follow-ups in OZZO's own My Activity? The build says **no by default** — it is the
distributor's private to-do list, and surfacing it would put 40 distributors' reminders into
his salesmen's screens. A setting can open it later.

- [x] **3.1** Reports: `portal_report_sales`, `portal_report_collection`,
      `portal_report_outstanding`, `portal_report_orders`, each `(p_from, p_to, p_group_by,
      p_filters jsonb)`, each returning `{columns, rows, totals}`.
- [x] **3.2** Scenarios: each report's figures recomputed from the base tables and compared;
      another distributor's rows absent; a date range at the account's own timezone, never
      `toISOString` ([[reports-and-dates-are-account-local]]).
- [ ] **3.3** NOT STARTED — `tasks.portal_contact_id` + RLS + `portal_tasks` / `portal_save_task` /
      `portal_complete_task`.
- [x] **3.4** Screens: `/reports`, `/reports/sales|orders|collection|outstanding`, in the
      sidebar. **`/my-activity` NOT STARTED** — see the note below.

> **Why My Activity stopped here, 2026-11-16.** The four reports are read-only and could
> not break anything. My Activity cannot be: `tasks.user_id` is NOT NULL and points at
> `auth.users`, so a portal task would be a real row in the account's own task table, and
> every one of the company's task screens would have to learn to leave it out. That is a
> schema change plus edits to working screens the founder uses daily, which is precisely
> what the working agreement says to do on its own and test on its own. It is the next
> piece, not a corner of this one.

## Sequencing and shipping

**A — §0 + §1 together.** Same functions, same lists, one migration, one RUN-THIS-SQL.
**B — §2 dispatch.** Its own migration and its own paste.
**C — §3 reports, then My Activity.**

**One RUN-THIS-SQL document per shipped group, never two blocks in one file** — that is how
`portal_place_order` came to be the only function missing for a week.

**The five gates before anything reaches main**: `npx tsc --noEmit`, `npx vitest run`,
`npm run lint:ui`, the DB scenarios, and clicking it through on the real screen.
