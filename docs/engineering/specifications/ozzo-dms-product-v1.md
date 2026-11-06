# OZZO DMS — a product, not a module (v1)

**Date:** 2026-11-07
**Status:** SPEC — approved in design, not yet built.
**Supersedes:** `ozzo-new-modules-2026-11.md` §2 ("OZZO DMS", 15 days, a `(portal)` route
group inside the CRM). That section is dead; build from this document.
**Builds on:** `dms-distributor-portal-plan.md` (PARKED). Its groundwork is reused; its
identity model is explicitly rejected — see §5.1.

---

## 0. What was decided, and by whom

Every line below is a founder ruling from the 2026-11-06/07 design session. They are
recorded first because most of them overturn something in an earlier document.

| # | Decision |
|---|---|
| 1 | DMS is a **separate product**, sold on its own and sellable merged with CRM / SFA. Not a module inside the CRM |
| 2 | Its own app, its own repo, served at **`dms.ozzo.co.in`**. No new domain is bought — it is a free DNS record on `ozzo.co.in` |
| 3 | **Any customer at any level** may be given a login — distributor, stockist or dealer. Each one sees itself and everyone below it |
| 4 | A portal customer may place orders **for themselves and for anyone below them** |
| 5 | Each order uses **that buyer's own price list**. A distributor never sees a margin |
| 6 | Payments are **view only** in v1 |
| 7 | **No tenant toggle.** The DMS line is granted per account by the **superadmin only**. A tenant admin can neither grant it nor raise their own seat limit |
| 8 | Access per customer is a **Provide DMS Access** toggle on the customer page, which opens the login fields. Switching it off ends their access and frees the seat |
| 9 | Charged **per login**: ₹10,000 for 100 logins. Enforced as a seat cap in the database |
| 10 | Login is **email and password**, exactly like an employee. The address need not be real but must be email-shaped (`xyz@abc.com`) |
| 11 | Sales credit for a dealer order typed by a distributor is a **per-tenant setting** — credit the portal, or credit the dealer's salesman |
| 12 | Phase 2 is **stocks, scheme management and delivery**. Scheme *application* on the order screen is pulled forward into v1 — see §7.4 |

---

## 1. Why a separate product is the right answer here

The objection to a second app is always duplication, so it has to be answered with facts.

**The data is not duplicated at all.** Customer hierarchy, customer mapping
(`contacts.parent_id`), the catalogue, price lists, schemes, orders and payments live in one
Postgres. A second front end pointing at the same database shares every one of them by
construction. There is nothing to integrate and nothing to keep in step.

**The arithmetic is not duplicated either, and this was the surprise of the session.**
`calculate_order_pricing` has existed in SQL since **migration 077** and is already the
single authority: `create_order` calls it on every save, re-prices the order server-side,
and records `pricing_status='review'` with a variance when the client's total disagrees.
`detect_eligible_schemes` likewise exists in SQL (`20260819160000_scheme_engine.sql`). The
TypeScript copies in `wacrm-web` and `wacrm-mobile` are a *documented advisory mirror* for
live totals and offline entry, pinned by a shared fixture suite and `sql-parity.md`.

An earlier draft of this design claimed the pricing engine still had to be moved into
Postgres and costed 8 days for it. **That was wrong and the 8 days are removed.**

So the governing rule:

> **Duplicate what is cosmetic. Never duplicate what is arithmetic.**

Design tokens and components may be copied between apps; if they drift, something looks
slightly off. Prices, discounts, schemes, GST and totals are never copied; they are called.
This also happens to be forced: a total arriving from an outsider's browser cannot be
trusted, and the database already refuses to trust it.

### 1.1 Where everything lives

| Piece | Where |
|---|---|
| Customers, hierarchy, mapping, catalogue, price lists, schemes, orders, payments | The same Mumbai Postgres, unchanged |
| Pricing, scheme detection, totals | Already in Postgres. Called, never copied |
| Who may see what | Portal-only SQL functions. Existing policies untouched (§6) |
| Portal UI | New repo `ozzo-dms`, own Vercel project, `dms.ozzo.co.in` |
| Login creation, seats, DMS grant | Inside the existing OZZO CRM. **The DMS app never holds the service-role key** |

A future customer mobile app is a fourth face on the same functions. That is the point of
this shape.

---

## 2. Scope

**In, v1:** portal logins for customers at any level; a sub-tree visibility rule; placing
purchase orders (on the company) and sales orders (for their own customers); scheme
application on those orders; read-only payments and outstanding; announcements; a private
activity list; four fixed reports; seats and the superadmin grant; admin oversight in the
CRM.

**Out, v1, deliberately:** distributor stock, claims (damage / scheme / freight / rate
difference), primary-versus-secondary stock reporting, delivery and delivery boys, scheme
*management* from the portal, dispatch creation by a distributor, a distributor recording
payments, any editing of a dealer's master record.

Every competitor ships claims and distributor stock with auto-replenishment. That is what a
large FMCG company eventually pays more for, and each is roughly another month. At ₹10,000
per 100 logins, ordering and visibility is the right first product. Phase 2 is §13.

---

## 3. Commercials, and the landmine in the plan gate

DMS is **granted, never inherited.**

```sql
alter table public.accounts
  add column if not exists addon_lines        text[] not null default '{}',
  add column if not exists portal_seats_limit integer not null default 0;
```

`account_has_line(account, 'dms')` reads `addon_lines`. It must **not** fall through to the
`subscription_plan` CASE, because that CASE ends:

```sql
else (p_line is distinct from 'fsm')  -- legacy / unknown / null => full access EXCEPT fsm
```

Legacy plans get every line except FSM, and account 001001 is a legacy Enterprise plan. Had
DMS been an ordinary line, **every existing tenant would have received the DMS free** on the
day the migration ran. FSM is already carved out of that fallback for exactly this reason;
DMS is carved out the same way and additionally keyed off `addon_lines` so no future plan
code can grant it by accident.

This also keeps the **8 plan codes at 8**. "SFA + DMS" and "CRM + SFA + DMS" need no new
codes — the add-on composes with any plan.

**Seats.** `portal_seats_limit = 0` means not bought, so no login can be created. The used
count is

```sql
select count(*) from contacts
 where account_id = ? and portal_user_id is not null
   and portal_access and portal_access_revoked_at is null
```

checked **in the database** at creation time, not only in the form — otherwise the cap is a
suggestion. Switching a customer's access off returns the seat to the pool.

**Superadmin screen.** `/admin/companies/[id]` already edits `subscription_plan`. It gains
the DMS add-on switch and the seat number. Behind `requireFounder`, like the rest of
`(superadmin)`.

**Surface gates.** `surface-gates.ts` is the one table every surface reads for "which line
does this screen need". The customer-page access block and the CRM's portal columns get rows
there. The database remains the real ceiling.

---

## 4. The portal's eight screens

Named from the distributor's own books, which is the right way round.

| Screen | In OZZO terms |
|---|---|
| **Dashboard** | Their outstanding to the company, their customers' outstanding to them, orders awaiting approval |
| **Purchase order** | What they buy **from the company**. An order whose customer is them — already `classification = 'primary'` |
| **Sales order** | What they sell **to their own customers**. Orders whose customer is a dealer — already `secondary`. They create these, and they also see the ones the company's reps booked |
| **My Customers** | Everyone below them in the tree, read only |
| **Payments** | Receipts and outstanding, read only |
| **Announcements** | From the company to them (§9) |
| **Activity management** | Their own private to-do and follow-up list (§10) |
| **Reports** | Four fixed reports with date ranges and export (§11) |

---

## 5. Identity and login

### 5.1 A portal customer is NOT a `profiles` row

The parked plan put portal users in `profiles` with a `portal_role` column, reasoning that
it reuses every existing membership check. **That reasoning is backwards and is rejected.**

`profiles` is the employee table in everything but name: it carries `account_role`,
`employee_role_id`, `web_access`. Measured on 2026-11-07, **107 web files and 56 database
functions query `profiles`.** A distributor placed in that table means all 163 sites must
begin asking "is this a real employee, or a customer with a login?", and every one missed
puts a distributor into an employee dropdown, a headcount, an attendance report, a
task-assignment list or an incentive calculation. That is the order-statuses mistake —
one vocabulary hardcoded in 13 files — multiplied by eight.

So a portal customer is **an `auth.users` row and nothing else**, linked from the customer:

```sql
alter table public.contacts
  add column if not exists portal_user_id            uuid null references auth.users(id),
  add column if not exists portal_email              text null,
  add column if not exists portal_access             boolean not null default false,
  add column if not exists portal_access_revoked_at  timestamptz null,
  add column if not exists portal_access_set_by      uuid null references profiles(id),
  add column if not exists portal_access_set_at      timestamptz null;

create unique index if not exists contacts_portal_email_idx
  on public.contacts (account_id, lower(portal_email))
  where portal_email is not null;
```

Zero existing queries change, because a portal customer is not in the table they read. They
are invisible to the CRM by construction rather than by 163 careful filters.

### 5.2 Login is email and password

Founder ruling 10: the same as an employee. `signInWithPassword({ email, password })`.

* The address **need not be real** but must be email-shaped, because Supabase validates it.
  `xyz@abc.com` is fine. Nothing is ever sent to it.
* `auth.users.email` is **globally unique**, which conveniently removes the "two tenants
  both want ramesh" collision. The cost is that one tenant can take an address another
  wanted: the admin must see **"that login is already taken"**, never a raw Supabase error.
* The user must be created with **email confirmation already set**. A fake address can never
  receive a confirmation mail, so without this the login fails forever.
* **There is no Forgot Password in the portal.** A fake address receives nothing. The
  distributor phones their own company and the admin resets the password on the customer
  page — the same place it was set.

### 5.3 Where logins are created

On the **customer page** — creating, editing and viewing — a block shown only when the
account has the DMS add-on:

| Field | |
|---|---|
| Provide DMS Access | The toggle. Off means they cannot sign in; nothing is deleted |
| Login email | Email-shaped, need not be real |
| Password | Set here, reset here |

The write path reuses what `src/app/api/team/employees/route.ts` already does: a server
route holding the service-role key calling `auth.admin.createUser`. **This stays in the
CRM.** If the portal app is ever compromised it cannot mint users or read across tenants,
because it has no privileged key.

One detail that will bite if missed: `handle_new_user` fires on every new `auth.users` row
and creates an account unless the metadata says otherwise (`member_of_account` is the
existing escape hatch, and it still inserts a `profiles` row). A portal user needs metadata
that makes the trigger do **nothing at all** — no account **and no `profiles` row**. Note
that `handle_new_user` was last touched by `20261103130000_automatic_master_codes.sql`;
patch from that version, not an older one.

### 5.4 Revoking

`portal_access = false`, `portal_access_revoked_at = now()`. The visibility resolver tests
both, so the next request returns nothing — we do not depend on ending their session. The
seat returns to the pool. The `auth.users` row is kept so the history of who ordered what
stays readable.

---

## 6. Visibility — the portal gets no table access at all

Both earlier plans proposed adding `OR portal_can_see_contact(...)` to the existing
`contacts`, `orders` and `payments` policies, "additive only". **This design does the
opposite, and the reason is in this repo's own history.**

On 2026-11-02, migration `20261102120000` rebuilt `contacts_select` and silently dropped
three branches: `collaborator_ids` (so "Also Assigned To" granted nothing), `employee_id`
(direct-assignment owners — the exact latent bug `20261005160000` had been written to close)
and `data_scope_extends`. That was a careful engineer editing one policy deliberately, and
three things broke quietly. `contacts_select` guards every customer record of every tenant.
It is not being opened again to let an outsider in.

**So a portal login can `execute` a named list of functions and has `select` on nothing.**

| Function | Returns |
|---|---|
| `portal_me()` | Their own customer record |
| `portal_customers()` | Everyone below them |
| `portal_orders(p_kind, p_from, p_to, ...)` | `purchase` (theirs) or `sales` (their customers') |
| `portal_order_detail(p_order_id)` | One order with its lines |
| `portal_catalogue(p_buyer_id)` | Sellable products priced for that buyer |
| `portal_outstanding()` | What they owe, what their customers owe them |
| `portal_payments(p_from, p_to)` | Receipts, read only |
| `portal_announcements()` | §9 |
| `portal_activities()` + writes | §10 |
| `portal_report_*(...)` | §11 |

A bug in the portal app — a wrong query, a missing filter, an injection — has no table to
reach. The alternative, a mistake in a rewritten `contacts_select`, exposes every customer of
every tenant. It is also *less* work: new functions nothing depends on yet, instead of
amending six policies that carry all the money and then proving they behave exactly as
before.

### 6.1 One resolver underneath all of them

```sql
create or replace function public.portal_visible_contact_ids()
returns uuid[] language sql stable security definer set search_path = '' as $fn$
  with recursive me as (
    select c.id, c.account_id
      from public.contacts c
     where c.portal_user_id = (select auth.uid())
       and c.portal_access
       and c.portal_access_revoked_at is null
  ),
  tree as (
    select id, account_id, 0 as depth from me
    union all
    select c.id, c.account_id, t.depth + 1
      from public.contacts c
      join tree t on c.parent_id = t.id
     where t.depth < 20
       and c.account_id = t.account_id
  )
  select coalesce(array_agg(id), '{}') from tree;
$fn$;
```

Four things in those lines are load-bearing:

1. **No arguments**, so Postgres evaluates it once per statement rather than once per row.
   An argument-taking `can_see(contact_id)` called from a policy is a per-row function call
   and is the difference between a fast screen and a slow one.
2. **`c.account_id = t.account_id` inside the recursion**, so a tenant boundary cannot be
   crossed even if `parent_id` is corrupted.
3. **The walk starts from `auth.uid()`**, so a revoked login yields an empty array.
4. **`depth < 20`** as belt and braces. `is_legal_customer_parent` already refuses
   "X would end up being supplied through themselves", but that guard has been rebuilt once
   already (`20261104130000`) and prod carries drift the migrations folder does not.

An **unmapped dealer has no parent and therefore appears in nobody's portal.** That is the
honest answer, and it is already how the mapping screen counts "needs a choice" — an area
holding three distributors leaves the dealer unmapped until an admin picks one.

Note also that `orders.parent_contact_id` snapshots the distributor at order time
(`20261103160000`), so a dealer moving to another distributor does not rewrite last year's
portal history. Reports read the snapshot; the live tree drives visibility.

---

## 7. Placing an order

### 7.1 Reuse `create_order`; do not write a second order path

`create_order` is `SECURITY INVOKER` and leans on `orders_insert`, which demands
`is_account_member`, an order permission and the SFA line. A portal customer has none of
those. So `portal_place_order` is a **thin `security definer` gate in front of it**, not a
replacement. It checks five things and then calls the RPC the CRM and the mobile app already
call:

1. The account has the DMS add-on (`addon_lines`).
2. The caller is a portal customer whose access is on and not revoked.
3. The buyer is in `portal_visible_contact_ids()` — themselves or someone below them.
4. Every product is sellable for that account.
5. The buyer is not blacklisted.

Everything after the gate is machinery already trusted: one pricing authority, idempotent
replay on retry, order numbering, primary/secondary classification, and the variance check.
**A distributor's browser may send any total it likes; the database prices the order itself
and records the disagreement.**

### 7.2 Prices and credit are the buyer's own

Decision 5. A distributor ordering for a dealer gets the dealer's price list and the dealer's
credit limit, because in OZZO's terms the dealer is the customer on that order. No new code:
the same `calculate_order_pricing` call with a different `p_contact_id`. No margin is ever
shown in the portal.

### 7.3 Marking a portal order

The Orders list resolves the salesman by looking `user_id` up in `profiles` **in the
browser**. A portal customer has no `profiles` row, so a portal order would show a blank
salesman — not broken, just mysterious, and mysterious is how a number stops being trusted.

```sql
alter table public.orders
  add column if not exists placed_by_portal_contact_id uuid null references contacts(id);
```

Present means it came from the portal. The CRM Orders list gains the **Placed via** column
reading *Portal*, filterable, and the order arrives in the **normal Orders list** as Pending
with the normal approval and dispatch — not a separate inbox, because a second inbox is a
second place to forget to look. A notification fires through the existing system.

### 7.4 Schemes are in v1, scheme management is not

Founder decision 12 put schemes in Phase 2 with stocks and delivery. Schemes are a different
kind of problem and are pulled forward, with his agreement:

`detect_eligible_schemes` **already exists in SQL**. If the portal ignores schemes, a
distributor placing their own order gets a **worse price** than if a salesman had typed the
identical order, because the salesman's screen offers the scheme and theirs does not. That is
a wrong number, not a missing feature, and the distributor will find it. Since the SQL
function exists, offering schemes on the portal order screen is about a day.

Creating and editing schemes stays firmly in Phase 2.

### 7.5 Sales credit is a tenant setting

Decision 11. An Organisation Settings choice, because FMCG companies genuinely answer it
differently:

* **Credit the portal** — the order is attributed to the portal and no salesman's target or
  incentive moves. Honest numbers; a rep may object that a distributor took business off
  their beat.
* **Credit the dealer's salesman** — the rep who owns that dealer gets the credit. Keeps
  territory numbers whole; a rep can hit target on orders they never worked.

Stored on the account, read by the target and incentive work when it is built. Note the DMS
*line* is superadmin-granted (decision 7); this *behaviour inside it* is the tenant's.

---

## 8. Multi-unit, GST and the order screen

The portal order screen is **new and slim** — it is not `order-form.tsx` (1,274 lines) in a
"portal mode". That form assumes staff: full catalogue, salesman assignment, CRM context.
Mounting it for an outsider puts a distributor one wrong condition away from the CRM, which
is the thing both earlier plans warned against.

It must still honour what the tenant has switched on: multi-unit (base-unit pricing and
stock), GST type and per-line tax basis, price-list v5 discount resolution, and
`allow_discount_over_price_list`. All of those are decided by `calculate_order_pricing`, so
the screen's job is to send lines and display what comes back — not to re-implement any rule.

---

## 9. Announcements

`tenant_announcements` targets employees only: `employee_ids`, `employee_role_ids`,
`send_to_sales_app`. There is no notion of a distributor audience.

```sql
alter table public.tenant_announcements
  add column if not exists send_to_portal     boolean not null default false,
  add column if not exists portal_contact_ids uuid[] not null default '{}';
```

`send_to_portal` default **false** is the important part: every announcement ever written
stays invisible to the portal until someone ticks the box. Empty `portal_contact_ids` with
`send_to_portal` true means all portal customers; naming customers narrows it.
`portal_announcements()` returns unexpired rows for the caller.

---

## 10. Activity management

A **private** to-do and follow-up list the distributor keeps for themselves. Nobody in the
company sees it. It deliberately does **not** reuse the Tasks module: `tasks` is keyed to
employees and employee permissions, and pointing it at an outsider drags the whole RBAC
registry into the portal.

```sql
create table public.portal_activities (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(id) on delete cascade,
  owner_contact_id   uuid not null references contacts(id) on delete cascade,
  subject_contact_id uuid null references contacts(id) on delete set null,
  title              text not null,
  notes              text,
  due_date           date,
  status             text not null default 'open' check (status in ('open','done')),
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index portal_activities_owner_idx
  on public.portal_activities (account_id, owner_contact_id, status, due_date);
```

Read and written only through `portal_activities()` / `portal_activity_save()` /
`portal_activity_delete()`. `subject_contact_id` must be inside
`portal_visible_contact_ids()`.

---

## 11. Reports

**Four fixed reports**, each with a date range and export:

1. Purchases from the company — their own orders, by period and product.
2. Sales to their customers — secondary movement they booked or the company's reps booked.
3. Outstanding ageing — theirs to the company, and their customers' to them.
4. Product-wise movement — quantity and value by product across both.

The existing report engine is **not** opened to the portal. It is wired to employee roles,
permissions and `report_registry_*`, and pointing it at an outsider is a far bigger and
riskier job than four purpose-built functions. If the portal later needs the full engine,
that is its own project.

Dates are account-local: convert `AT TIME ZONE` the account's timezone, never
`toISOString()`.

---

## 12. What a portal user sees when something is wrong

These moments decide whether the portal is trusted, so they are specified, not left to
whatever the framework does.

| Situation | What happens |
|---|---|
| Access revoked mid-session | A plain "Your access has been withdrawn — please contact your company". Not an error page |
| Seat cap reached | The **admin** is blocked in the CRM when creating the login, with "100 of 100 logins used". The distributor never sees this |
| Login email already taken by another tenant | The admin sees "that login is already taken". Never a raw Supabase error |
| Total disagrees with the server | The order is **saved**, not rejected, and marked `pricing_status='review'` — exactly as a rep's order is |
| Buyer is blacklisted | Not selectable. The reason is **not** shown in the portal |
| Buyer is unmapped (no parent) | Simply absent from My Customers. No error, nothing to explain |
| DMS add-on removed from the account | Every portal login stops working at once; nothing is deleted |

---

## 13. Phase 2 — the roadmap

Not costed here; each gets its own spec.

| | Why it matters |
|---|---|
| **Distributor stock** | A stock ledger per distributor mirroring `stock_ledger`, with auto-replenishment suggestions. This is what makes primary-versus-secondary reporting possible, which is how a company detects a distributor stuffing his godown to hit a target. Every competitor ships it |
| **Scheme management** | Creating and editing schemes from the portal. Application is already in v1 (§7.4) |
| **Delivery** | Delivery runs and stops, nearest-first sequencing, proof of delivery. The delivery boy belongs in the **existing OZZO Android app behind a `delivery` role** — not a browser (no background location, no offline) and not a second app (OZZO SALES is already public on Play as `com.wacrm.fieldforce`) |
| **Claims** | Damage, scheme, freight and rate difference. Every competitor ships this too |
| **Customer mobile app** | A fourth face on the same portal functions. The reason this design keeps the rules in the database |

---

## 14. Work breakdown — 37 days, about 7½ weeks

| Task | Days |
|---|---|
| Portal access toggle, login email and password, service-role creation route, `handle_new_user` metadata, admin reset | 4 |
| Seats, the database cap, superadmin grant screen, `addon_lines`, `account_has_line` carve-out | 4 |
| Visibility: the resolver, the portal function surface, grants, cross-tenant and cross-distributor tests | 5 |
| The new app: repo, Vercel project, `dms.ozzo.co.in`, login, shell, design tokens | 3 |
| Place order: `portal_place_order`, the slim order screen, catalogue and prices, multi-unit and GST | 6 |
| Schemes on the order screen | 1 |
| Purchase order, Sales order, My Customers, Payments, Dashboard, outstanding | 4 |
| Announcements: column, targeting, screen | 1 |
| Activity management: table, functions, screen | 3 |
| Four reports with export | 3 |
| Admin side: Placed via column and filter, notification, sales-credit setting | 2 |
| DMS as a product line, surface gates, documentation, QA pass | 1 |

The pricing engine costs **nothing**, because it is already in the database. An earlier
draft of this spec costed 8 days for it in error.

---

## 15. Testing

The suite that must exist **before** this goes live, not after:

1. A distributor in tenant A can see nothing whatsoever of tenant B — contacts, orders,
   payments, products, announcements, activities, every report.
2. A distributor can see nothing of the distributor beside them in the same tenant.
3. A stockist sees their own slice of the tree and nothing above it.
4. A revoked login reads nothing, and its seat is free.
5. `portal_place_order` refuses a buyer outside the caller's tree, a blacklisted buyer, an
   account without the add-on, and a total the client has tampered with.
6. The seat cap cannot be exceeded **by calling the database directly**, not merely by using
   the form.
7. An account **without** the DMS add-on is byte-identical to today: no new column on a
   list, no new query, no new menu item, and `account_has_line(acct,'dms')` false for every
   legacy plan.

`tools/pgsql` stands up a throwaway Postgres 17.6 and applies all migrations, so all of this
is testable without touching production. Expect the known storage/realtime failures as noise.
Always reload `00_fixture.sql` first and disable `on_auth_user_created` while loading.

---

## 16. Risk register

| Risk | Mitigation |
|---|---|
| A portal user sees another tenant's or another distributor's data | One resolver; zero table grants; the account check inside the recursion; the test suite in §15 is a release gate |
| The DMS is given away free to legacy plans | `addon_lines`, and DMS carved out of the `account_has_line` fallback exactly as FSM is (§3) |
| A distributor leaks into employee screens | No `profiles` row at all (§5.1). The 163 query sites are never asked the question |
| A portal order is priced differently from a rep's order | Same `calculate_order_pricing`; schemes pulled into v1 (§7.4); variance recorded, never silently accepted |
| An existing tenant's visibility shifts | No existing policy is edited. This is the lesson of `20261102120000` (§6) |
| The portal app is compromised | It holds no service-role key and has `select` on no table |
| Two codebases drift | Only cosmetics are duplicated. Every rule is a database function both apps call |

---

## 17. Open questions

Not blocking the first migrations, but needed before the screens they affect.

1. **May a distributor edit or cancel their own order before approval?** Assumed **no** in
   v1 — they place it and the company decides. One RPC either way.
2. **Does the portal show dispatch status and invoice documents?** Status yes (it is on the
   order). Document PDFs are not costed.
3. **Announcement attachments** — the portal would need read access to that storage bucket.
   Not costed.
4. **Does a distributor see which salesman booked a dealer's order?** Assumed no; it names a
   company employee to an outsider.
5. **Portal language** — English only in v1.
6. Should the sales-credit setting also apply to orders a rep books for a dealer *below a
   distributor*, or only to portal-placed orders? Assumed portal-placed only.

---

## 18. Documents this replaces or amends

* `ozzo-new-modules-2026-11.md` §2 — **superseded in full.** 15 days, a `(portal)` group
  inside the CRM, distributors only, no dealer ordering, additive RLS on existing policies.
  Every one of those is now decided the other way.
* `dms-distributor-portal-plan.md` — stays PARKED. Its §2.2 identity model (portal users in
  `profiles`) is **rejected**; its §2.3 mapping groundwork and §5 competitor gaps are reused.
  Its delivery model moves to Phase 2 here.
* `secondary-sales-v1.md` — unchanged, and relied upon: `contacts.parent_id` is the answer to
  "who supplies this customer", and an area with several holders leaves the customer unmapped
  rather than guessing.
