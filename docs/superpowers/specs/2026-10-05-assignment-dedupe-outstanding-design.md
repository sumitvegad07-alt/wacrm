# Multi-employee assignment, configurable duplicate keys, configurable outstanding

**Date:** 2026-10-05
**Status:** items 1a, 3 and 4 shipped; items 1b/1c and 2 outstanding

## Progress (2026-10-05)

| Item | State |
|---|---|
| 1a — one area, many employees | **Live.** Migration `20261005120000` applied and verified: the `area_taken` check is gone from the live function. |
| 1b/1c — "Also Assigned To" | Not started. |
| 2 — duplicate keys | Not started. |
| 3 — outstanding | **Live.** Web (`85e6e1c`, `7c9e900`), database (`c3ccd69`, migration `20261005130000` applied), mobile (`553d82e`, **no APK built yet**). Verified against live data: 306 customers, 0 differences from the old formula, totals identical at ₹67,684.00. |
| 4 — activity dialog | **Live** (`6df8b20`). |

Found and fixed along the way, outside the original scope:
* `custom-fields-section-renderer` painted a section heading before the form could veto the fields under it — empty headings on every module's forms.
* The AI connector's catalog advertised an `outstanding_amount` measure on the `outstanding` data set that had never existed; `ageing` is a dormancy report, not a receivables one. Storing the balance made the promised measure real.
* `contacts_select` RLS never checked `employee_id`, so a directly-assigned employee could not see their own customer. Fix belongs with item 1b.

**Caveat:** reps' phones keep the old rule until a new APK ships — mobile code is pushed but unbuilt, per the founder's batching rule.
**Scope:** all tenants (founder rule — never scope to one account unless told)

Four items requested together. Items 1–3 change the database, Settings, web and
mobile; item 4 is a web-only UI fix. Decisions below are the founder's, taken in
conversation; where a decision overrode an earlier recommendation that is noted.

---

## 1. One area → many employees, one customer → many employees

### 1a. Areas (done, migration pending apply)

`employee_area_assignments` has always been `UNIQUE (employee_id, territory_id)`,
so the table already models many-to-many. The only blocker was an explicit check
in `territory_assign_employee_areas` (migrations 102, 105) returning
`reason: 'area_taken'` whenever another employee already held the area.

Migration `20261005120000_areas_allow_multiple_employees.sql` drops that check.
`v_mode` / `v_conflict` go with it — the assignment mode no longer changes what
the function does.

Change is permissive only. Every existing assignment survives untouched; an admin
who wants one rep per area simply does not assign a second one. **The founder
explicitly declined an on/off switch for this:** nothing is being removed, so
nothing needs a setting.

Web follow-up: `employee-area-assignment.tsx:132` handles the now-impossible
`area_taken` reason and must stop claiming an area is taken.

### 1b. Customers get "Also Assigned To"

`contacts` keeps `employee_id` (profiles.id) as the single **main owner**, so
every report, target, DSR and sales-credit query keeps working unchanged. A new
array column carries the extra employees, who get full access.

Modelled as an array column, matching `leads`/`deals.collaborator_ids`, **not** a
join table — the mobile app writes offline and child-table writes are where the
offline queue has broken before (FK violations when a child outruns its parent).

**Latent bug found and fixed in the same migration:** `contacts_select` does not
check `employee_id` at all. In direct-assignment mode an employee assigned a
customer cannot see it unless they created it. No tenant hits this today (all 33
accounts are `area_wise`), but it is wrong and the new column must not repeat it.

### 1c. Leads rebuilt to match

Leads already store `collaborator_ids`, but the control is labelled
"Collaborators" and lives in a different place. Founder asked for the two screens
to be identical, so both get the same **"Also Assigned To"** control in the same
position.

One-time data cleanup required: `collaborator_ids` holds a mix of `profiles.id`
and auth user ids (older mobile/web flows). RLS checks `auth.uid() = ANY(...)`,
so a stored `profiles.id` silently grants no access at all.

---

## 2. Duplicate prevention

### What already exists (checked against the live database, 2026-10-05)

| Table | Unique indexes |
|---|---|
| `contacts` | `contacts_pkey`, `idx_contacts_account_phone_normalized` — unique `(account_id, phone_normalized)` where phone is non-empty |
| `leads` | `leads_pkey` only — **no duplicate protection of any kind** |

So customer phone numbers are *already* hard-blocked for every tenant, with no
setting. Products keep today's single-choice setting, untouched (founder).

### Decisions

- **Customer phone stays hard-blocked.** The founder's original ask was to make it
  an admin choice; on learning it already exists he ruled: *"if we already have
  phone number is hard blocked then no need to develop it."* Settings will show
  Contact Number as an always-on, locked row so an admin can see the rule rather
  than guess at it.
- **Leads get the same protection, because they have none.** Founder: *"this
  functionality also belongs to leads as well, if not then build it."*
  Leads need a `phone_normalized` generated column and the same partial unique
  index. Safe to add: 33 leads, zero duplicate phones, zero duplicate names.
- **Name / Code / Email are admin-tickable, multi-select, any match blocks** — the
  Salesforce / Zoho model of independent rules per field rather than one winner.

| | Always on | Tickable |
|---|---|---|
| Customer | Contact Number | Name, Customer Code |
| Lead | Contact Number | Name, Email |
| Product | — | Name *or* Code (single choice, unchanged) |

No Lead Code field is being added (founder).

Settings shape, extending `accounts.settings.extra_settings`:

```
customer_unique_keys: ["name"]          // tickable fields only
lead_unique_keys:     ["name", "email"]
```

The existing scalar `customer_unique_key` / `product_unique_key` keys stay
readable as a fallback, so an account that has not re-saved Settings keeps its
current behaviour.

Enforcement is two-layer, as today: an in-app check that produces a good error
message and offers to open the existing record, plus a database trigger as the
race-proof backstop. `isUniqueViolation` (23505) already handles the index case.

---

## 3. Outstanding: admin chooses the rule, and it gets stored

### How it works today

One formula, duplicated in web (`src/lib/payments/financials.ts`) and mobile
(`src/lib/customers/financials.ts`):

```
Outstanding = opening_balance
            + SUM(orders.total_amount  WHERE status = 'Closed')
            - SUM(payments settled      WHERE status = 'Approved')
```

A payment settles `verified_amount` when an approver set one, otherwise `amount`.
Ageing applies payments oldest-first (opening balance, then orders by date) and
compares what is left against `credit_days`.

Nothing is stored. Every screen re-derives it with four parallel queries.

### Decision: status sets, not three presets

The founder rejected the three fixed options as too narrow:

> *"some companies work this way — order generated means outstanding calculated;
> some work when order is closed… there are multiple scenarios right?"*

So the admin picks **which order statuses add to outstanding** and **which payment
statuses reduce it**, with presets as shortcuts over the same underlying lists.

Live statuses: orders — Pending, Approved, Part Dispatch, Dispatched, Closed,
Cancelled, Rejected. Payments — Pending, Approved, Cancelled, Rejected.

```
outstanding_settings: {
  order_statuses:   ["Closed"],     // default = today's behaviour
  payment_statuses: ["Approved"],   // default = today's behaviour
}
```

Order presets: *On order creation* (everything but Cancelled/Rejected) ·
*On approval* · *On dispatch* · *On close* (default) · *Custom*.
Payment presets: *Approved only* (default) · *Pending + Approved* · *Custom*.

Defaults reproduce today's numbers exactly, so no tenant's balances move until an
admin changes something.

### Decision: store it

Founder: *"why outstanding is not stored anywhere, it must be stored."* He is
right, and the reasons are concrete: the customer list cannot sort or filter by
Outstanding today, every screen re-queries, and there is no history.

- `contacts.outstanding_balance` — maintained by triggers on `orders`, `payments`,
  `dispatches` and on `contacts.opening_balance`.
- The formula stays the **source of truth**, demoted to a rebuild function that
  can recompute one customer or a whole account from the ledger at any time. The
  stored number can therefore never drift permanently.
- Changing the setting rebuilds the whole account automatically. This removes the
  earlier warning about silent drift — the change becomes one visible
  recalculation.
- The two credit-limit triggers read the column instead of re-summing every order.

### Call sites that must switch to the shared rule

web: `lib/payments/financials.ts`, `lib/dashboard/payment-queries.ts` (×3),
`components/contacts/contact-financials.tsx`,
`app/(dashboard)/reports/payments/page.tsx` ·
mobile: `lib/customers/financials.ts` ·
SQL: the credit-limit trigger (`20260814200000`), the Ageing report module
(`20260818090000`), `lib/mcp/catalog.ts`.

---

## 4. Activity dialog (done, verified)

Four fixes in `components/tasks/task-form.tsx` and the shared custom-fields
renderer:

1. Dialog 768px → 576px (`sm:max-w-3xl` → `sm:max-w-xl`; note view → `sm:max-w-lg`).
2. **Root cause of the clipped button:** `custom-fields-section-renderer.tsx`
   decided whether to paint a section header from the raw field list, but a form
   can veto individual fields later, inside the loop. The Task form hides both of
   its "Schedule & Priority" fields (they are drawn higher up in a fixed order),
   so the section painted a heading with nothing under it. Fixed by resolving the
   veto first (`visibleSectionFields`, unit-tested) and returning null when
   nothing survives — this benefits every module's forms, not just tasks.
3. Dialog is now a flex column: only the fields scroll, so Save/Cancel are pinned
   and can never be cut off.
4. `autoFocus` on the activity input and the note textarea.

Verified in the browser: width 576px, focus lands on the Task box, and at a
420px-tall viewport the fields scroll while Create Task stays on screen.

---

## Out of scope

- Mobile APK build — founder batches these; mobile changes are committed and
  pushed but never built automatically.
- Counting only the *dispatched portion* of a Part Dispatch order. Option
  "on dispatch" counts the whole order value once any goods leave. Exact
  part-dispatch valuation needs new SQL and was deferred.
