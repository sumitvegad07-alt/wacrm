# DMS / Distributor Portal — internal plan

**Status:** PLAN ONLY. Nothing built. Founder decision 2026-11-02: build it as a
**tenant customisation** for one new account, not as a product module.
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

## 2. Part B — the distributor portal

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

### 2.3 The mapping question, and its collision with route_customers

The founder wants dealers mapped to distributors **through beats**. The direct consequence,
already flagged to him on 2026-11-02:

`route_customers` carries `uq_route_customers_one_active_route` — **one customer belongs to
one active route**. If a dealer must sit on a salesman's beat *and* a distributor's beat,
that index forbids it.

Three options, in order of preference:

1. **Reuse the salesman's beat** (recommended). A distributor is assigned the *same* beats
   the salesmen already work. Nothing new is needed, the mapping is automatic, and the
   dealer is on exactly one route. This is almost certainly what the founder means when he
   says "we will use beats".
2. **A second kind of beat** — `routes.purpose in ('sales','distribution')` and make the
   unique index partial on purpose. Clean, but doubles the beat maintenance burden on the
   admin.
3. **Relax the rule entirely.** Rejected. It exists because a rep's day must be
   unambiguous.

**This is open question #4 to the founder.** Build nothing here until it is answered, since
option 2 changes the migration.

Dealer resolution, whichever option wins:

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

If either turns out to be a real requirement, the delivery boy belongs in the existing
Android app behind a `delivery` role, not in the portal. That is a separate quote.

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

### 2.8 Work breakdown — 46 days (excluding Part A)

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
4. Can a dealer sit on a salesman beat **and** a distributor beat? (See 2.3)
5. Delivery boy: browser or app?
6. Hold blocks dispatch, or only flags it?
7. Who may release a Hold?
8. Which prices does a distributor see?

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
