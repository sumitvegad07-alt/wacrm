# DMS / Distributor Portal — internal plan

> ## PARKED — do not build from this
>
> **Founder ruling, 2026-11-02 (second pass):** *"Leave our internal DMS building plan
> for now, we will make it a completely new product called DMS in future with some more
> features as well."*
>
> **2026-11-07: that product is now SPEC'd — see `ozzo-dms-product-v1.md`.** This
> document stays parked. Its §2.2 identity model (portal users in `profiles`) is REJECTED
> there; its §2.3 mapping groundwork, §5 competitor gaps and §2.6 delivery model are reused.
>
> So **DMS is not a module inside OZZO.** It becomes its own product, with a wider
> feature set than anything below, and it gets its own plan when that is started.
> Nothing in this document is scheduled and nothing should be built from it.
>
> It is kept because the groundwork in it is still true and still expensive to redo:
> the identity model (§2.2), the beat-to-distributor mapping (§2.3), the RLS shape
> (§2.5), the delivery data model (§2.6), and the competitor feature gaps (§5). Start the
> product plan from here rather than from a blank page.
>
> **Parts A and B are a different matter.** Configurable order statuses (§1) and Buying
> Status (§1b) are this one tenant's customisations, neither depends on the DMS, and both
> are live plans.
>
> **§2.3 is worth reading even though the portal is parked.** It records that `contacts`
> has no dealer-to-distributor link at all — `hierarchy_level` is a number that classifies
> an order as primary or secondary, nothing more — so beat-based mapping disturbs nothing,
> and the one-route-per-customer collision I flagged was not real.
>
> **The delivery boy moved into the existing mobile app**, not a browser — see the note
> at the end of §2.6. The client-facing document already reflects that; §2.6's web
> reasoning below is superseded.

**Status:** PARKED for the portal (§2). LIVE PLANS for Part A (§1, order statuses) and
Part B (§1b, Buying Status).
**Companion document:** `docs/clients/CUSTOMIZATION-PROPOSAL-dms-and-order-status.md`
(the client-facing version — keep the two in step).

---

## 0. The framing problem, stated honestly

The founder's instruction is: *"this will be customization and not affect our existing
software, this will be for this tenant only."*

That is achievable, but only in one specific sense, and the distinction matters enough to
write down before any code is cut:

- **What cannot be tenant-only:** the *code*. There is one Next.js app, one database and
  one mobile app. A distributor portal and two extra order statuses are code that ships to
  everyone's deployment. There is no separate build for one customer and we must not
  create one — a forked codebase for one tenant is the single most expensive mistake a
  small SaaS can make.
- **What can and must be tenant-only:** the *behaviour*. Every other tenant must see
  precisely what they see today, byte for byte, with no new menu item, no new status, no
  new setting and no new query cost.

So the rule for this whole build is: **new tables, new routes, and config that defaults to
off.** Nothing is added to an existing enum, nothing is added to an existing hardcoded
list, and nothing changes shape for an account that has not been switched on.

Both pieces below are gated on one flag: `accounts.module_settings.dms` (and a separate
`order_status_custom`). Default false. Every other tenant has them false forever unless
somebody sells it again — in which case we already have a product, which is the upside of
doing it this way.

---

## 1. Part A — configurable order statuses

### 1.1 What is actually there now

The status vocabulary *Pending / Approved / Part Dispatch / Dispatched / Closed /
Rejected / Cancelled* is **hardcoded in 13 web files and 6 mobile files**, plus inside
database functions (`p_order_statuses` on the dashboard RPCs) and the Outstanding presets
(`ORDER_STATUS_PRESETS`). `src/components/settings/orders-settings.tsx` says so in the UI:
*"Order statuses are fixed."*

The specific places that know the list:

| Where | What it hardcodes |
|-------|-------------------|
| `app/(dashboard)/orders/page.tsx` | colour map + allowed-transition map |
| `app/(dashboard)/orders/[id]/page.tsx` | transition map, colour map, `DISPATCHABLE` set |
| `app/(dashboard)/pending-dispatch/page.tsx` | `['Approved','Part Dispatch']` filter + options |
| `components/dispatches/dispatch-form.tsx` | which orders may be dispatched |
| `lib/dashboard/sales-queries.ts` | `VALUE_STATUSES`, `PENDING_DISPATCH_STATUSES` |
| `lib/dashboard/payment-queries.ts` + the aggregate RPCs | `p_order_statuses` |
| `lib/customers/outstanding-config.ts` | `ORDER_STATUS_PRESETS` |
| `lib/design-tokens.ts` | status badge tone |
| `components/dashboard/sections/sfa-analytics.tsx` | chart colours |
| mobile `DispatchFormScreen`, financials, outstanding config | same again |

An "add two strings" change touches every one of them, and each one it misses becomes a
silent wrong number on a dashboard. That is why this is 12 days and not 2.

### 1.2 Design

One new table, account-scoped, seeded from the current fixed list for the one tenant that
turns it on. Nobody else gets a row, and the code falls back to the existing constants
when there are no rows — which is what keeps every other tenant byte-identical.

```sql
create table public.order_statuses (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  key         text not null,              -- 'in_transit' — stable, never shown
  label       text not null,              -- 'In Transit' — shown, renameable
  position    smallint not null,
  tone        text not null default 'neutral',
  is_terminal boolean not null default false,
  counts_as_sale        boolean not null default false,  -- feeds sales-queries
  counts_as_outstanding boolean not null default false,  -- feeds outstanding
  dispatchable          boolean not null default false,
  requires_reason       boolean not null default false,  -- Hold
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (account_id, key)
);

create table public.order_status_transitions (
  account_id uuid not null references accounts(id) on delete cascade,
  from_key   text not null,
  to_key     text not null,
  permission text not null,   -- e.g. 'order_set_hold'
  primary key (account_id, from_key, to_key)
);

create table public.order_hold_reasons (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name       text not null,
  position   smallint not null default 0,
  is_active  boolean not null default true,
  unique (account_id, name)
);

alter table public.orders
  add column hold_reason_id uuid null references order_hold_reasons(id),
  add column hold_note      text null,
  add column held_at        timestamptz null,
  add column held_by        uuid null references profiles(id);
```

`counts_as_sale`, `counts_as_outstanding` and `dispatchable` are the important columns.
They are how the 13 hardcoded sites stop being hardcoded: instead of asking *"is the status
in this literal array?"* they ask *"does this status carry the dispatchable flag?"*. Every
money number in the app then follows the configuration automatically, which is the only way
to add a status without silently breaking a dashboard.

### 1.3 Resolution order (the thing to get right)

```
statusesFor(accountId):
  rows = order_statuses where account_id = ? and is_active
  if rows is empty -> return the frozen built-in list (today's behaviour, unchanged)
  else             -> return rows
```

Served from one cached read in `useAuth`/account context, the same way module settings are.
No extra round trip per screen.

### 1.4 Rights

New permission keys in `lib/auth/permissions-registry.ts`, one per transition rather than
one per status, because the question is always "may you make *this* move":

`order_approve`, `order_reject`, `order_cancel`, `order_set_hold`, `order_release_hold`,
`order_set_in_transit`, `order_dispatch`, `order_close`.

Enforced twice, as everything in this codebase is: in the UI (the button is not rendered)
and in `enforce_order_status_transition()` at the database, modelled on the existing
`enforce_payment_status_transition()`. Admin/owner bypass via the existing `all` right.

### 1.5 Work breakdown — 12 days

| # | Task | Days |
|---|------|------|
| 1 | Migration + seed function + RLS | 1.5 |
| 2 | `lib/orders/statuses.ts` resolver + cache + fallback | 1 |
| 3 | Convert the 13 web sites off the constants | 3 |
| 4 | Convert the 6 mobile sites | 1.5 |
| 5 | DB transition guard + the 8 permissions | 1 |
| 6 | Settings: status list editor + hold-reason master | 1.5 |
| 7 | Hold reason on the order form, detail, mobile, timeline | 1 |
| 8 | Reports: hold-reason column + filter, dashboard tones | 1 |
| 9 | Tests (the fallback path is the one that must not break) | 0.5 |

---

## 1b. Part B — Buying Status (has this customer ever ordered?)

**Founder ruling, 2026-11-03.** A third tenant customisation, independent of the portal and
of the statuses. Client-facing version: §3 of the proposal.

### 1b.1 Why it is NOT a custom field

He asked directly, and the honest answer is that a custom field cannot do the job:

* **A custom field is a value a human types.** To make it update itself you need a trigger
  writing into `contact_custom_values` — which is code either way, and code writing into a
  field the admin can rename, deactivate or delete is a fault waiting to happen. The
  predefined-field lock exists for exactly this class of problem and would have to be
  extended to cover it.
* **It has to be a first-class column to be useful.** Filterable and sortable on the
  Customers list, present in Manage Column, available to the report engine, readable by the
  mobile list without a join. A real column gets all of that for nothing; a custom field
  gets some of it, slowly.
* **The manual override needs a second stored fact** — "a human decided this" — so the
  automatic rule knows to stop. Two custom fields kept in step by a trigger is strictly
  worse than two columns.

So: columns and a trigger, gated per account.

### 1b.2 Schema

```sql
alter table public.contacts
  add column if not exists buying_status text not null default 'yet_to_buy'
    check (buying_status in ('buyer', 'yet_to_buy')),
  -- A human has set this by hand, so the trigger must leave it alone. Cleared by the
  -- admin to hand the customer back to the automatic rule.
  add column if not exists buying_status_locked boolean not null default false,
  add column if not exists buying_status_set_by uuid null references profiles(id),
  add column if not exists buying_status_set_at timestamptz null,
  -- When they first bought. Makes "Buyers opened this month" a number, not a guess.
  add column if not exists first_order_at timestamptz null;

create index if not exists contacts_buying_status_idx
  on public.contacts (account_id, buying_status);
```

### 1b.3 The rule

One trigger on `orders`, AFTER INSERT / UPDATE OF status / DELETE:

```
a customer is a Buyer  <=>  they have at least one order whose status is not
                            Cancelled and not Rejected
```

* **INSERT** of a first countable order → `buyer`, `first_order_at = the order's date`.
* **UPDATE** to Cancelled/Rejected → recount; if nothing countable is left → back to
  `yet_to_buy`, `first_order_at = null`.
* **DELETE** → same recount.
* Every branch skips the row when `buying_status_locked` is true.

Recount, not a counter column: a counter drifts the first time anything writes to `orders`
outside the trigger's assumptions, and this table is written by imports, the offline queue
and the demo seeder as well as by the order form.

**Cancelled/Rejected not counting is a decision, not a reading of the brief.** He said "has
not placed a one single order in lifetime". An order that was cancelled was still *placed*.
I have taken the commercially useful reading — a cancelled order did not make them a buyer —
and flagged it in the open questions. Changing it is one line.

### 1b.4 Manual override

`buying_status_locked` is set by the UI, never by the trigger. The right is
`manage_buying_status`, granted to admin and (per the founder) to the sales rep. The detail
page shows *Set by Ramesh on 3 November*; an admin can clear the lock, which re-runs the
rule for that one customer.

### 1b.5 Gating and backfill

`accounts.module_settings.buying_status`, default **false**. The columns exist for everyone
— they are cheap and nullable in effect — but no other tenant sees the column on a list, a
filter, the form or a report. The trigger is unconditional and harmless: it maintains a
value nobody reads.

The migration backfills every account from existing order history in one statement, so the
feature is correct on day one rather than only for new business.

### 1b.6 Work — 5 days

| Task | Days |
|------|------|
| Migration: columns, index, trigger, backfill | 1 |
| Customers list column + filter + Manage Column + export | 1 |
| Customer form and detail: value, manual set, lock, who/when | 1 |
| Mobile list badge + filter | 1 |
| Report-engine dimension + "Buyers opened" measure, tests | 1 |

---

## 2. Part C — the distributor portal

### 2.1 Shape

A new route group in the same Next.js app: `src/app/(dms)/…`, with its own layout, its own
sidebar and its own auth gate. **Not** inside `(dashboard)` — a distributor must never be
one wrong `if` away from the CRM shell.

Middleware sends a user whose profile carries `portal_role in ('distributor','delivery')`
to `/dms` and refuses them `/dashboard` outright, and refuses a CRM user `/dms`.

### 2.2 Identity

Distributors and delivery boys are **Supabase auth users with a `profiles` row** in the
same account, carrying a new `portal_role` column. This is deliberate and worth defending:
a parallel identity system would need its own password reset, its own session handling, its
own RLS vocabulary and its own audit trail, and would be the most likely place for a
cross-tenant leak. Reusing `profiles` means every existing `is_account_member` check keeps
working and the distributor is visible in the audit log like anyone else.

```sql
alter table public.profiles
  add column portal_role text null
    check (portal_role in ('distributor','delivery')),
  add column distributor_id uuid null references distributors(id) on delete cascade,
  add column portal_access_revoked_at timestamptz null;

create table public.distributors (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  code        text,
  contact_id  uuid null references contacts(id),  -- when the distributor is also a customer
  phone       text,
  address     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Beat -> distributor. This is the dealer mapping, via routes.
create table public.distributor_beats (
  account_id     uuid not null references accounts(id) on delete cascade,
  distributor_id uuid not null references distributors(id) on delete cascade,
  route_id       uuid not null references routes(id) on delete cascade,
  primary key (distributor_id, route_id)
);
```

### 2.3 Mapping — RESOLVED, and there is nothing to disturb

**2026-11-03. The founder's worry here rests on a misunderstanding of our own schema, and
correcting it removes the whole problem.** His words: *"we already have customer hierarchy
to assign dealers to distributors like mapping them... I have a strong feeling that the
existing workflow should not be disturbed."*

Checked against the live schema. **`contacts` has no `parent_id` and no dealer-to-
distributor link of any kind.** The columns are: account_id, address, area, avatar_url,
city, client_created_at, collaborator_ids, company, country, created_at, credit_days,
credit_limit, custom_values, customer_code, email, employee_id, gst_number,
**hierarchy_level**, id, is_active, latitude, longitude, name, needs_territory_review,
opening_balance, outstanding_balance, outstanding_updated_at, phone, phone_normalized,
pincode, price_list_id, search_text, state, territory_id, territory_name, updated_at,
user_id, whatsapp.

`hierarchy_level` is a **number**, not a link. Migration 077 shows the only thing it does:

```
hierarchy off          -> order classification 'direct'
level 1 (top)          -> 'primary'
any level below top    -> 'secondary'
level not set          -> 'direct'
```

So today the hierarchy answers **"what kind of customer is this?"** — which decides whether
their order counts as primary or secondary sales. It has never answered **"which
distributor serves this dealer?"**, and nothing else in OZZO does either.

**There is therefore no existing mapping to disturb.** This is not a replacement, it is the
first answer to a question the product could not answer. `hierarchy_level` keeps doing
exactly what it does, untouched, for every tenant including this one.

#### The collision I flagged on 2026-11-02 also disappears

I warned that `uq_route_customers_one_active_route` — one customer, one active route —
would forbid a dealer sitting on a salesman's beat *and* a distributor's beat.

It only forbids that if they are two different beats. **They are not.** The same beat does
both jobs: the salesman walks it to take orders, the distributor supplies it. One beat, one
`route_customers` row, no second kind of route, no change to the unique index, no extra
maintenance for the admin. Option 2 from the earlier draft (a `routes.purpose` column) is
**dropped** — it was solving a problem that does not exist.

#### The model

```sql
-- A distributor IS a customer whose hierarchy_level = 1. No separate entity.
create table public.distributor_beats (
  account_id     uuid not null references accounts(id) on delete cascade,
  distributor_id uuid not null references contacts(id) on delete cascade,
  route_id       uuid not null references routes(id)   on delete cascade,
  primary key (distributor_id, route_id)
);

-- A beat has ONE distributor; a distributor has many beats. Without this an order
-- could belong to two distributors and the portal would show it twice.
create unique index if not exists distributor_beats_one_per_route
  on public.distributor_beats (route_id);
```

`distributors` as a table (§2.2) is **withdrawn**. A distributor is a contact, which is how
this client already records them, and it means price lists, credit limits, outstanding and
every report keep working on them with no special case.

#### Set where customers are set, not in Settings

Founder ruling 2026-11-03: *"we don't want to go to settings and create distributors... we
will provide fields for create ID & Password in Customer Creation form only."*

So the customer form grows one block, shown **only** when the tenant flag is on **and**
`hierarchy_level = 1`:

| Field | Stored |
|-------|--------|
| Portal login ID | `contacts.portal_login_id` |
| Password | sets/updates the Supabase auth user |
| Beats served | `distributor_beats` rows |
| Portal access | `contacts.portal_access` |

And on a dealer (`hierarchy_level > 1`), one read-only line — **Supplied by: <name>** —
resolved live from their beat. Nothing to type, nothing to keep in step.

Identity still works as §2.2 describes (a `profiles` row with `portal_role`), it is simply
created from the customer form rather than from a Settings screen, and
`profiles.distributor_id` points at the **contact**.

#### Gating

`accounts.module_settings.dms`, default false. Every other tenant sees no login block, no
beats field and no "Supplied by" line, and `distributor_beats` stays empty for them.

Dealer resolution:

```sql
create or replace function public.distributor_dealer_ids(p_distributor_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct rc.contact_id), '{}')
    from distributor_beats db
    join route_customers rc on rc.route_id = db.route_id
   where db.distributor_id = p_distributor_id
     and rc.archived_at is null
     and rc.one_time_date is null;   -- a one-day guest is not their dealer
$$;
```

Note the `one_time_date is null` — the one-time stop added on 2026-11-02 must not hand a
dealer to the wrong distributor for a day.

### 2.4 Cutting a distributor off

Revoking access is `portal_access_revoked_at = now()` plus `is_active = false`. The RLS
policy checks it, so the session dies on the next request; we do not rely on signing them
out.

**The reassignment screen is the part that must not be skipped.** When access is revoked,
the admin is shown the beats that distributor held and must pick the distributor each one
moves to. Implemented as a single RPC so it is atomic:
`distributor_revoke_and_reassign(p_distributor_id, p_reassignments jsonb)`.

Leaving beats unassigned is allowed but warned about loudly — those dealers' orders have
nowhere to go.

### 2.5 RLS

Every DMS table and every CRM table the portal reads needs a distributor branch. The rule
is one function, used everywhere, so it cannot drift:

```sql
create or replace function public.dms_can_see_contact(p_contact_id uuid, p_account_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_dist uuid;
begin
  select distributor_id into v_dist
    from profiles
   where user_id = (select auth.uid())
     and account_id = p_account_id
     and portal_role is not null
     and portal_access_revoked_at is null;
  if v_dist is null then return false; end if;
  return p_contact_id = any(distributor_dealer_ids(v_dist));
end; $$;
```

`orders`, `dispatches`, `payments` and `contacts` each gain
`OR dms_can_see_contact(contact_id, account_id)` on SELECT. **Additive only** — no existing
branch is touched, so no existing tenant's visibility moves.

Writes are RPC-only for the portal. A distributor never gets a bare `insert`/`update` grant
on `orders`; they call `dms_create_dispatch`, `dms_mark_in_transit`, `dms_assign_delivery`.
That keeps the surface small enough to actually review.

### 2.6 Delivery

```sql
create table public.delivery_runs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references accounts(id) on delete cascade,
  distributor_id uuid not null references distributors(id) on delete cascade,
  delivery_user  uuid not null references profiles(id),
  run_date       date not null,
  status         text not null default 'planned',   -- planned|running|done
  started_at     timestamptz,
  completed_at   timestamptz,
  unique (distributor_id, delivery_user, run_date)
);

create table public.delivery_stops (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  run_id          uuid not null references delivery_runs(id) on delete cascade,
  order_id        uuid not null references orders(id),
  contact_id      uuid not null references contacts(id),
  sequence        smallint,                       -- as planned; the phone re-orders live
  status          text not null default 'pending', -- pending|delivered|held
  hold_reason_id  uuid references order_hold_reasons(id),
  hold_note       text,
  settled_at      timestamptz,
  settled_lat     numeric,
  settled_lng     numeric
);
```

**Nearest-first.** Computed on the phone from `navigator.geolocation` plus each dealer's
`contacts.latitude/longitude`, re-sorted after every stop is settled. Straight-line
distance, not road distance — a routing API is a cost and a dependency we do not need for
a delivery boy who knows his own area. The server stores the *planned* sequence; the phone
owns the live order.

Two things to be honest about in the client document, and they already are:

- a browser reads location only while the page is open, so there is **no background
  tracking**; and
- there is **no offline**. A delivery boy in a basement godown with no signal cannot mark a
  stop. The existing mobile app's offline queue is exactly the thing that solves this, and
  it is not available to a web portal.

**Superseded, 2026-11-02:** both turned out to be real requirements, and the founder's
own conclusion was the right one — the delivery boy belongs in the **existing OZZO
Android app behind a `delivery` role**, not in a browser.

Worth recording why *one app with a role* beats *a second app for delivery boys*, since
he asked:

* OZZO SALES is **already public on the Play Store** (`com.wacrm.fieldforce`). A delivery
  boy installs the normal app and a role-gated nav shows him only his deliveries — no
  sideloading, no "install from unknown sources", no Play Protect warning, and automatic
  updates. Distributing an APK over WhatsApp is a real cost paid by the least technical
  user in the chain, and it is not a cost we have to pay.
* A second app means a second codebase, a second build pipeline, a second release to
  manage and a second copy of auth, offline sync, location and the RBAC registry — all of
  which already exist and all of which would then drift.
* The screens are role-gated, so no other tenant and no salesman ever sees them.

If an off-store build is still wanted for some other reason, it is a **build flavour of
the same codebase**, never a separate app.

### 2.7 Orders and payments in the portal (phase 5)

| Flow | Decision needed |
|------|-----------------|
| Distributor places an order on behalf of a dealer | Reuses the existing order form, scoped to their dealers. Low risk |
| **Sales orders** (dealer -> distributor) | This is what the Orders list already is. No new object |
| **Purchase orders** (distributor -> us) | **New object.** Open question #2 — does the distributor raise it, or do we push stock? |
| **Distributor stock** | **Open question #1, and the big one.** If yes: a `distributor_stock` ledger mirroring `stock_ledger`, plus primary/secondary sales reporting. Adds ~15 days |
| **Payments** | **Open question #3.** Two ledgers (dealer->distributor, distributor->us) is the honest FMCG model. One ledger is half the work |

Primary vs secondary sales is the concept that makes a DMS worth buying — primary is
company-to-distributor billing, secondary is distributor-to-dealer movement, and the gap
between them is how you detect a distributor stuffing his godown to hit a target. We cannot
report on it at all unless question #1 is yes. Worth pushing the client on.

### 2.8 Work breakdown — 46 days (excluding Parts A and B)

| Phase | Task | Days |
|-------|------|------|
| **2** | `distributors`, `distributor_beats`, `portal_role`, RLS, dealer resolver | 3 |
| | `(dms)` route group, layout, auth gate, middleware | 2 |
| | Settings: distributor CRUD, login creation, beat assignment | 2 |
| | Revoke + atomic reassign RPC and screen | 1 |
| **3** | Portal dashboard + Orders list + My Dealers | 3 |
| | Create Dispatch (reusing the dispatch engine) + Mark In Transit | 5 |
| **4** | Delivery boy identity, `delivery_runs` / `delivery_stops`, assignment screen | 4 |
| | Mobile-web delivery screen, geolocation, nearest-first, re-sort | 5 |
| | Delivered / Hold with reason, proof capture, admin visibility | 4 |
| **5** | Order placement in the portal | 4 |
| | Purchase orders | 5 |
| | Payments and ledger(s) | 5 |
| | Admin oversight: reports, filters, audit | 3 |
| | **Total** | **46** |

Plus Part A's 12 = **58 working days, about 12 weeks**, which is the figure in the client
document. **Question #1 answering "yes" adds ~15 days** and must be re-quoted.

---

## 3. Risk register

| Risk | Mitigation |
|------|-----------|
| A distributor sees another distributor's or the CRM's data | One resolver function (`dms_can_see_contact`) used by every policy; portal writes are RPC-only; a cross-tenant/cross-distributor test suite before launch |
| Part A silently breaks a money number for an existing tenant | The resolver falls back to the frozen constants when a tenant has no rows. A test asserts an account with no `order_statuses` rows produces byte-identical results to today |
| The one-route-per-customer rule blocks beat mapping | Open question #4, answered before the migration is written |
| Tenant customisation slowly becomes product | Accepted and planned for: everything is behind `module_settings.dms` and `order_status_custom`, so selling it again is a switch, not a rebuild |
| No offline for delivery | Stated in the client document. Escalate to the Android app if it becomes real |

---

## 4. Open questions — blocking

Carried from the client document section 7; repeated here because the migration cannot be
written without 1, 2 and 4.

1. Distributor stock in OZZO? (±15 days)
2. Purchase order raised by the distributor, or pushed by us?
3. One payment ledger or two?
4. ~~Can a dealer sit on a salesman beat **and** a distributor beat?~~ **ANSWERED
   2026-11-03** — the question was wrong. It is the same beat doing two jobs, there is no
   existing dealer-to-distributor link to disturb, and the unique index is untouched.
   See 2.3.
5. ~~Delivery boy: browser or app?~~ **ANSWERED 2026-11-02** — the existing mobile app,
   behind a `delivery` role. Not a browser and not a second app. See 2.6.
6. Hold blocks dispatch, or only flags it?
7. Who may release a Hold?
8. Which prices does a distributor see?
9. **Buying Status: does a Cancelled or Rejected order make someone a Buyer?** I have
   assumed **no** — the order was placed but it did not happen. One line either way.
   See 1b.3.
10. **Buying Status: may a sales rep change it, or admin only?** The founder said "admin
    and sales Rep.", so the right is granted to both; confirm the rep may also *release*
    the manual lock, or whether that is admin-only.

---

## 5. Sources consulted for the DMS feature set

Vendor marketing, not independent review — used to check we are not missing a category
every competitor has, nothing more.

- [BeatRoute — Distributor Management System](https://beatroute.io/distributor-management-system/)
- [PepUpSales — Distributor Management System](https://www.pepupsales.com/distributor-management-system)
- [MAssist — Distribution Management System (DMS) India](https://www.massistcrm.com/distribution-management-system-dms.html)
- [Heera Software — Distribution Management System](https://heerasoftware.com/distribution-management-system/)
- [Software@Work — Distributor Management System](https://sawindia.com/distributor-management-system-dms)
- [Spirestock — Distributor Claims Settlement FMCG India](https://spirestock.com/blog/distributor-claims-settlement-fmcg-india)

The one gap worth noting against that set: every competitor ships **claims** (damage,
scheme, freight, rate difference) and **distributor stock with auto-replenishment**. We are
excluding both. That is the right call for a first customisation, and it is the first thing
to add if this becomes a product.
