# OZZO — four new modules

**Written:** 3 November 2026
**Status:** SPECIFICATION. Nothing built. This is the document a development session
builds from.
**Scope:** all four go into **the OZZO product, for every tenant**, plan-gated and off by
default. None of this is a tenant customisation.
**Origin:** the founder's demo with a prospect on 2 November. Four of the things that
prospect asked for turned out to be gaps in OZZO itself, not special requests.

---

## How to read this

Each module below has the same shape:

1. **What it is** — in the founder's own terms.
2. **What already exists** — checked against the live schema, not assumed.
3. **Design** — settings, data, rules.
4. **Screens**.
5. **Work** — days, broken down.
6. **Decisions still needed.**

Every module ends up behind an **Organisation Settings** switch that is **OFF by default**,
so no existing tenant sees anything change until they turn it on. That is not caution for
its own sake: OZZO has live paying tenants, and a module that alters a list, a form or a
money total without being asked is how trust is lost.

**Order of work** is in §6. Read it before starting — two of these have a dependency.

---

## 1. Customer mapping — parent, manual or by beat

### 1.1 What it is

> *"We need customer mapping through the beat mapping and manually both option in our OZZO
> organisation settings. If admin selects manually, add one field in customer creation —
> a parent id in customer. If admin selects beat/route mapping, a simple beat/route
> selection option to map the customers. That is how we will map the primary and secondary
> channel for sales."*

### 1.2 What already exists — and the thing that surprised us

**OZZO has no customer-to-customer link at all today.** This was checked against the live
database, column by column, because the assumption that we already had one shaped a whole
earlier plan.

`contacts` holds: account_id, address, area, avatar_url, city, client_created_at,
collaborator_ids, company, country, created_at, credit_days, credit_limit, custom_values,
customer_code, email, employee_id, gst_number, **hierarchy_level**, id, is_active,
latitude, longitude, name, needs_territory_review, opening_balance, outstanding_balance,
outstanding_updated_at, phone, phone_normalized, pincode, price_list_id, search_text,
state, territory_id, territory_name, updated_at, user_id, whatsapp.

**No `parent_id`. No distributor column. Nothing.**

`hierarchy_level` is a **number**, and migration `077_calculate_order_pricing.sql` shows
the only thing it does:

```
hierarchy off          -> order classification 'direct'
level 1 (top of chain) -> 'primary'
any level below top    -> 'secondary'
level not set          -> 'direct'   (deliberately not 'secondary')
```

So today the hierarchy answers **"what kind of customer is this?"** It has never answered
**"which distributor serves this dealer?"**, and nothing else does either.

**Consequence, and it is a good one:** this module replaces nothing. It is the first answer
to a question the product could not answer. `hierarchy_level` keeps doing exactly what it
does, for every tenant, untouched.

The channel reporting we advertise is also weaker than it looks right now: we can say an
order was primary or secondary, but not *through whom*. That is what this fixes.

### 1.3 Design

**One setting, three values.** Organisation Settings → Customers:

| Mode | Meaning |
|------|---------|
| **Off** | Today's behaviour exactly. No parent anywhere. **Default.** |
| **Manual** | The admin picks each customer's parent on the customer form |
| **By beat** | A beat is given a parent, and every customer on that beat inherits it |

**One column holds the answer in both modes:**

```sql
alter table public.contacts
  add column if not exists parent_id uuid null references public.contacts(id)
    on delete set null;

create index if not exists contacts_parent_idx
  on public.contacts (account_id, parent_id) where parent_id is not null;

-- Beat mode: which customer supplies a beat. One parent per beat; a parent may
-- hold many beats.
create table if not exists public.route_parent_customers (
  account_id uuid not null references public.accounts(id) on delete cascade,
  route_id   uuid not null references public.routes(id)   on delete cascade,
  parent_id  uuid not null references public.contacts(id) on delete cascade,
  primary key (route_id)
);
```

**`contacts.parent_id` is always the answer. The mode decides who writes it.**

- **Manual mode** — a human writes it from the customer form.
- **Beat mode** — a trigger writes it, whenever `route_customers` changes (a customer joins
  or leaves a beat) or `route_parent_customers` changes (a beat changes hands). The field
  is read-only on the form, showing *"From beat: Kalawad Road"*.

This is deliberate. The alternative — deriving the parent on every read — cannot be
indexed, cannot be joined cheaply, and makes every report do the work again. One stored,
indexed column that something keeps correct is the right trade.

**Guards, all enforced in the database, not just the form:**

| Rule | Why |
|------|-----|
| A customer cannot be its own parent | Obvious, and cheap to check |
| No cycles (A → B → A) | Same trigger shape as `prevent_manager_cycle` on profiles (migration 106). That one already exists; copy it |
| A parent must sit **above** the child in `hierarchy_level` | A dealer cannot be a distributor's parent |
| Changing modes does not silently rewrite data | Switching Manual → Beat asks first, shows how many parents would change, and keeps a record |

### 1.4 Primary and secondary channel

This is the point of the module, so it needs to be right.

Today `orders.classification` is computed from `hierarchy_level` alone. With a parent we
can finally say *through whom* a secondary sale happened. Add one snapshot column:

```sql
alter table public.orders
  add column if not exists parent_contact_id uuid null references public.contacts(id);
```

**Snapshot at order time, never recomputed.** If a dealer moves to a different distributor
next March, last year's orders must still report under the distributor who actually served
them. A report that changes its own history is worse than no report.

New report dimensions: *Parent customer*, *Channel* (primary / secondary / direct). New
measures: primary value, secondary value, and the **ratio between them** — in FMCG, primary
running consistently ahead of secondary is the standard sign of stock being pushed into a
distributor's godown rather than sold.

### 1.5 Screens

| Screen | Change |
|--------|--------|
| Organisation Settings → Customers | The mode switch, with plain-English help for each |
| Customer form | **Manual:** a Parent customer picker, filtered to customers of a higher level. **Beat:** a read-only line naming the parent and the beat it came from |
| Customer detail | *Parent:* and, on a parent, *Serves N customers* with a link to the list |
| Customers list | A Parent column — filterable, sortable, in Manage Column, exportable |
| Beats (Routes) | On a beat: *Supplied by*, settable in beat mode |
| Reports | Parent and Channel dimensions; primary/secondary measures |
| Import | `parent_code` accepted in the customer importer, resolved against `customer_code` |

### 1.6 Work — 8 days

| Task | Days |
|------|------|
| Migration: `parent_id`, `route_parent_customers`, cycle + level guards, indexes | 1.5 |
| Beat-mode trigger, both directions, with tests | 1 |
| Settings panel + the mode-change confirmation | 1 |
| Customer form (both modes) + detail panel | 1.5 |
| List column, filter, Manage Column, export | 1 |
| `orders.parent_contact_id` snapshot + order form/RPC change | 1 |
| Report dimensions and measures | 1 |

### 1.7 Decisions needed

1. **How many levels deep?** Two (distributor → dealer) is what has been described. Three
   (super-stockist → distributor → dealer) costs nothing extra in the data model but does
   change what the reports should roll up. Which?
2. **May a customer with no parent still order?** Assumed yes — it is a `direct` order,
   which is what happens today.
3. **Beat mode with a customer on no beat** — their parent is empty. Assumed acceptable,
   shown as a warning count on the Customers list.

---

## 2. OZZO DMS — distributors place their own orders

### 2.1 What it is

> *"Our DMS will also have Sales order and purchase order, which means a distributor can
> simply place the order to the company and the company's admin should receive this order.
> We don't need a delivery module — in transit, hold, anything like that. Our current
> statuses are enough. But we need the same Login ID and Password option."*

### 2.2 What already exists — both objects, already

This is the finding that makes the module much smaller than it sounds.

- A **purchase order** — a distributor ordering from the company — is, in OZZO's own terms,
  an order whose customer is the distributor. `classification` already computes to
  `primary` for a level-1 customer.
- A **sales order** — what a distributor's dealers ordered — is an order whose customer is
  a dealer. Already `secondary`, and once §1 exists we know which distributor it belongs
  to.

**So the DMS needs no new order tables and no new order statuses.** Both objects exist and
are already classified. What does not exist is a **door** the distributor can walk through
to place and see them. That is the module.

What is genuinely new: a portal, a login, and the rule that a distributor may see only
their own business.

### 2.3 Identity — on the customer form, not in Settings

Founder ruling, carried over from the client work on 3 November: distributors are not
created on a separate screen. A distributor is a customer whose level is Distributor.

```sql
alter table public.contacts
  add column if not exists portal_login_id text null,
  add column if not exists portal_access   boolean not null default false,
  add column if not exists portal_user_id  uuid null references auth.users(id);

create unique index if not exists contacts_portal_login_idx
  on public.contacts (account_id, lower(portal_login_id))
  where portal_login_id is not null;
```

The customer form grows one block, shown only when the module is on **and** the customer is
a parent-level customer:

| Field | |
|-------|---|
| Portal login ID | What they type to sign in |
| Password | Set and reset here |
| Portal access | On / off — off means they cannot sign in, and nothing is deleted |

The portal user is a real `auth.users` row with a `profiles` row carrying
`portal_role = 'distributor'`, so every existing membership and audit check keeps working
unchanged. A parallel login system would need its own password reset, session handling and
RLS vocabulary, and would be the most likely place for a cross-tenant leak.

### 2.4 The portal

A new route group, `src/app/(portal)/…`, with its own layout and its own gate. **Not**
inside `(dashboard)` — a distributor must never be one wrong `if` away from the CRM.
Middleware sends a `portal_role` user to `/portal` and refuses them `/dashboard`, and
refuses a CRM user `/portal`.

| Screen | What is on it |
|--------|---------------|
| **Dashboard** | My orders to the company, my dealers' orders, outstanding |
| **Place order** | The existing order form, customer fixed to themselves. This is the purchase order |
| **My orders** | What they ordered from the company, with status |
| **Dealer orders** | What their dealers ordered. Read-only in v1 |
| **My dealers** | The customers whose parent is them |
| **Payments** | What they have paid and what is outstanding |

**No delivery module. No In Transit, no Hold, no delivery boy, no dispatch creation.** The
existing statuses stand, exactly as the founder asked.

### 2.5 What the admin sees

A distributor's order arrives in the **normal Orders list**. Not a separate inbox, not a
separate screen — the same list, the same approval, the same dispatch, with one extra
column, *Placed via*, reading **Portal** instead of a salesman's name.

This matters: a second inbox means a second place to forget to look.

A notification fires on arrival, through the existing notification system.

### 2.6 Visibility

One function, used by every policy, so the rule cannot drift:

```sql
create or replace function public.portal_can_see_contact(p_contact_id uuid, p_account_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_self uuid;
begin
  select c.id into v_self
    from profiles p join contacts c on c.portal_user_id = p.user_id
   where p.user_id = (select auth.uid())
     and p.account_id = p_account_id
     and p.portal_role = 'distributor'
     and c.portal_access;
  if v_self is null then return false; end if;
  -- themselves, or a customer whose parent is them
  return p_contact_id = v_self
      or exists (select 1 from contacts d
                  where d.id = p_contact_id and d.parent_id = v_self);
end; $$;
```

`orders`, `payments` and `contacts` each gain `OR portal_can_see_contact(...)` on SELECT.
**Additive only** — no existing branch is touched, so no existing tenant's visibility moves
by a single row.

Portal **writes** are RPC-only. A distributor never gets a bare insert or update grant on
`orders`; they call `portal_place_order`. That keeps the surface small enough to actually
review.

### 2.7 Work — 15 days

| Task | Days |
|------|------|
| Portal identity: columns, auth user creation from the customer form, `portal_role` | 2 |
| `(portal)` route group, layout, gate, middleware | 2 |
| RLS: the resolver + additive policy branches, with cross-tenant tests | 2 |
| Place order (reusing the order form) + `portal_place_order` RPC | 3 |
| My orders, Dealer orders, My dealers | 2 |
| Payments and outstanding | 2 |
| Admin side: *Placed via* column, notification, filter | 1 |
| Plan gating, settings switch, documentation | 1 |

**Depends on §1.** Without a parent, "my dealers" has no definition. Do not start this
before customer mapping is live.

### 2.8 Decisions needed

1. **May a distributor place an order *for* a dealer**, or only for themselves? Assumed
   only for themselves in v1.
2. **Prices** — does a distributor see their own buying price only, or also the dealer's
   selling price?
3. **Does a distributor record payments**, or only view them? Assumed view only in v1.
4. **Is the portal charged for?** A per-distributor-login charge changes the plan gate.

---

## 3. Buying Status — Buyer / Yet to Buy

### 3.1 What it is

Mark, by itself, which customers have ever placed an order and which never have.

### 3.2 Why it cannot be Active / Inactive

Every module already has Active / Inactive. It answers *"is this record still in use?"* —
a filing question. This is a different question: *"has this customer ever bought?"*

Reusing one for the other would hide exactly the customers a rep should be visiting. A
dealer who has never ordered is a perfectly current customer; the rep is calling on them
**because** they have not ordered yet. Marking them Inactive removes them from the lists of
the very people whose job it is to open them.

So: a second status, its own name.

### 3.3 The name

**Buying Status**: **Buyer** / **Yet to Buy**.

"Yet to Buy" is an instruction rather than a label. *Inactive* tells a rep to ignore
someone; *Yet to Buy* tells him to go and sell. Alternatives, same mechanism either way:
**Billed / Unbilled** (the trade's own words, drier) or **Opened / Not Opened** (the usual
FMCG phrase for a shop's first order).

### 3.4 Why not custom fields

The founder asked directly. A custom field cannot do this:

- **A custom field is a value a human types.** Automating it needs a trigger writing into
  `contact_custom_values` — code either way, and code writing into a field the admin can
  rename, deactivate or delete. The predefined-field lock exists for exactly this class of
  problem and would have to be stretched to cover it.
- **It has to be a first-class column to be useful.** Filterable and sortable on the list,
  present in Manage Column, available to the report engine, readable by the mobile list
  without a join. A column gets all of that for nothing.
- **The manual override needs a second stored fact** — *a human decided this* — so the
  automatic rule knows to stop. Two custom fields kept in step by a trigger is strictly
  worse than two columns.

### 3.5 Design

```sql
alter table public.contacts
  add column if not exists buying_status text not null default 'yet_to_buy'
    check (buying_status in ('buyer', 'yet_to_buy')),
  add column if not exists buying_status_locked boolean not null default false,
  add column if not exists buying_status_set_by uuid null references public.profiles(id),
  add column if not exists buying_status_set_at timestamptz null,
  add column if not exists first_order_at timestamptz null;

create index if not exists contacts_buying_status_idx
  on public.contacts (account_id, buying_status);
```

One trigger on `orders`, AFTER INSERT / UPDATE OF status / DELETE:

```
a customer is a Buyer  <=>  they have at least one order whose status is
                            neither Cancelled nor Rejected
```

- First countable order → `buyer`, `first_order_at` stamped.
- An order moving to Cancelled or Rejected → recount; if nothing countable remains, back to
  `yet_to_buy`.
- Every branch skips the row when `buying_status_locked` is true.

**Recount, not a counter column.** A counter drifts the first time anything writes to
`orders` outside the trigger's assumptions, and this table is written by the importer, the
offline queue and the demo seeder as well as by the order form.

The migration **backfills every account from existing order history in one statement**, so
it is correct on day one rather than only for new business.

### 3.6 Manual override

Admin and sales rep (right: `manage_buying_status`) may set it by hand. Doing so sets the
lock, and the detail page shows *Set by Ramesh on 3 November*. An admin can clear the lock,
which re-runs the rule for that one customer.

### 3.7 Where it appears

Customers list column with filter and export; the customer page with the first-order date;
the mobile list, so a rep on a beat can see which shops he has never sold to; and a report
dimension plus a *Buyers opened in period* measure.

### 3.8 Work — 5 days

| Task | Days |
|------|------|
| Migration: columns, index, trigger, backfill | 1 |
| List column, filter, Manage Column, export | 1 |
| Form and detail: value, manual set, lock, who and when | 1 |
| Mobile list badge and filter | 1 |
| Report dimension + measure, tests | 1 |

### 3.9 Decisions needed

1. **Does a Cancelled or Rejected order make someone a Buyer?** Assumed **no** — the order
   was placed but it did not happen. One line either way.
2. **May a rep *release* the manual lock, or only set it?** Assumed admin-only for release.

---

## 4. Automatic codes

### 4.1 What it is

> *"Customer code, employee code, leads code — all the codes should be generated
> automatically, but we need to provide an option in organisation settings. If they enable
> it they can generate those codes automatically. By default it must be disabled."*

### 4.2 What already exists

**The machinery is already here and working.** `account_sequences` holds nine counters
today — `asset_seq, deal_seq, dispatch_seq, expense_seq, job_seq, leave_seq, order_seq,
payment_seq, quotation_seq` — and the pattern is a `get_next_*_number(account_id)` function
plus a BEFORE INSERT trigger, e.g.:

```sql
-- migration 032
CREATE OR REPLACE FUNCTION set_quotation_number() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quotation_number IS NULL OR NEW.quotation_number = '' THEN
    NEW.quotation_number := get_next_quotation_number(NEW.account_id);
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
```

So **documents** already number themselves. **Master records** do not:

| Field | Today |
|-------|-------|
| `contacts.customer_code` | typed by hand |
| `profiles.employee_code` | typed by hand |
| `products.sku` | typed by hand |
| Lead code | **does not exist** — needs a column |

One difference from the existing numbering that must not be missed: today's numbering is
**unconditional**. This must be **optional and off by default**, so the trigger has to read
a setting before it does anything.

### 4.3 Design

Organisation Settings → **Automatic codes**, a row per record type:

| | Enabled | Prefix | Digits | Next | Preview |
|---|---|---|---|---|---|
| Customer | off | CUST- | 4 | 1 | CUST-0001 |
| Employee | off | EMP- | 4 | 1 | EMP-0001 |
| Lead | off | LEAD- | 4 | 1 | LEAD-0001 |
| Product | off | SKU- | 4 | 1 | SKU-0001 |

Stored as `accounts.settings.code_settings`. Four new counters on `account_sequences`;
`leads` gains a `lead_code` column with a per-account unique index.

**Rules that stop it going wrong:**

| Rule | Why |
|------|-----|
| Off by default, per record type | No existing tenant's data changes until they ask |
| Only fills an **empty** field | Someone who types their own code keeps it, exactly like `set_quotation_number` |
| Generated codes are unique per account | A unique index, not a hope. If the generated code collides with a code somebody typed earlier, the generator advances and tries again |
| Existing records are **not** renumbered | Switching it on changes nothing already saved |
| A separate **Backfill** button | One click, shows how many will be given a code, asks before writing |
| The field stays editable | The admin can still override a generated code |

The sequence is taken inside the same `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
statement the existing functions use, so two people creating a customer at the same moment
cannot get the same code.

### 4.4 Work — 6 days

| Task | Days |
|------|------|
| Migration: 4 counters, `leads.lead_code`, unique indexes, 4 generators, 4 triggers | 2 |
| Settings panel with live preview | 1 |
| Backfill RPC + the confirmation screen | 1 |
| Forms: placeholder showing what will be generated when left empty | 1 |
| Importer: respect a supplied code, generate when blank; tests | 1 |

### 4.5 Decisions needed

1. **Should a code include the year or month** (CUST-2611-0001)? Assumed no — it makes
   sorting worse and nobody asked.
2. **Should the counter reset yearly?** Assumed no.
3. **Product SKU** — included above, but SKU often carries meaning (size, pack). Confirm it
   should be auto-generated at all, or leave products out.

---

## 5. What none of this changes

Worth stating once, plainly, because four modules at once sounds like a lot of movement:

| Existing behaviour | After all four |
|--------------------|----------------|
| `hierarchy_level` and order classification | Unchanged |
| Existing document numbering (orders, quotations, payments…) | Unchanged |
| Active / Inactive on every module | Unchanged |
| Beats, beat plans, approvals, route execution | Unchanged |
| Price lists, schemes, credit limits, outstanding | Unchanged |
| Every existing list, form and report for a tenant who switches nothing on | Byte-identical |

Each module is one Organisation Settings switch, off by default.

---

## 6. Order of work, and why

| # | Module | Days | Depends on |
|---|--------|------|-----------|
| 1 | **Automatic codes** | 6 | nothing |
| 2 | **Buying Status** | 5 | nothing |
| 3 | **Customer mapping** | 8 | nothing |
| 4 | **OZZO DMS** | 15 | customer mapping |
| | **Total** | **34 days — about 7 weeks** | |

All four are marked ASAP, so the order is by what unblocks what and what lands soonest:

- **Codes and Buying Status first.** Neither depends on anything, together they are
  11 days, and both are visible to every user on day one. They buy goodwill while the
  bigger two are built.
- **Customer mapping third.** It is the foundation for the DMS and it makes the
  primary/secondary channel reporting real on its own.
- **DMS last.** It cannot sensibly start before mapping exists, because "my dealers" has no
  meaning without a parent.

Codes and Buying Status touch different tables and different screens, so they can run in
parallel if there are two people. Mapping and the DMS must be sequential.

---

## 7. Appendix — open items for the bug session

The founder asked that the open bugs be kept for a separate session. This is the register
to start that session from.

**Confidence is marked honestly.** *Verified today* means I checked it in the code or
against the live database while writing this. *Recorded* means it comes from a note of
earlier work and should be re-checked before anyone spends time on it — some may already be
fixed.

### Verified today

| # | Issue | Detail |
|---|-------|--------|
| B1 | **Custom-field columns are there but empty on most lists** | The founder remembered this for Employees. What is actually wrong is one step further in. The column IS offered — `getVisibleTableColumns()` calls `appendCustomFieldColumns()` internally, so every list gets its custom-field columns in Manage Column. But the renderer reads one key, `row['cf_<fieldId>']`, and **only Orders, Deals and Leads build those keys onto their rows.** On **Team → Employees, Contacts, Products and Tasks** the key is never set, so every custom-field column renders "-" for every row. Employees is the worst of them: it does not fetch employee custom values at all (they live in `user_custom_values`, keyed by user, and the list never joins it). **Caveat:** the founder's words were "not showing in Manage Column", and what I can verify is "shown but always empty". The bug session should confirm which he saw — the fix differs |
| B2 | **Migration `20261019120000_outreach_templates_attachments.sql` is still unapplied on prod** | `outreach_templates` returns 404 from PostgREST. The Revenue Engine outreach tool is founder-only, so the impact is limited to that screen |
| B3 | **9 of 39 customers in account 001001 have no Area** | They are invisible to any rep who does not own them, by design of area visibility. Fix per customer, or with the Territories migration tool (`territory_migrate_contact_geo`) |

### Recorded — re-check before acting

| # | Issue |
|---|-------|
| B4 | Mobile APK is behind: several fixes are pushed but unbuilt, including the territory visibility fix (`61a1d3d`), the new-entry highlight, geo-fenced punch, and the onboarding friendly-error |
| B5 | QA cycle 2026-09-16, item F2 — the definer `search_path` migration was never applied and was left on a branch |
| B6 | Plan-gating audit — a migration recorded as unapplied |
| B7 | Import → "Create new territory" button reported as not working |
| B8 | Proposal GST rounding — `computeTotals` rounds to paise while `quote()` rounds to whole rupees, so a discounted proposal can print ₹3,499.2 |
| B9 | Reports do not exclude `is_active = false` rows |
| B10 | 128 duplicate permissive RLS policies, deferred on risk |
| B11 | Mobile parity gaps: unit, customer code and dedupe are web-only |

### How the bug session should run

1. **Re-verify before fixing.** Several of the recorded items are weeks old.
2. **Fix B1 as one batch.** It is the same omission on four lists, and the right fix is
   probably not four copies of the same mapping code: give `appendCustomFieldColumns` a
   fallback to the row's own `custom_values` JSONB (which contacts, products and tasks
   already carry) so most lists need no change at all, and give Employees the
   `user_custom_values` join it is missing. A shared test should then assert that a list
   with a custom field actually renders its value, not merely that the column exists —
   the existing tests check the column, which is why this survived.
3. **Hand the founder the SQL** for anything needing DDL. The Supabase MCP connection has
   had no permission on the Mumbai project since 16 October; prod is readable through
   PostgREST with the service key, but migrations must be run by hand.
4. **Check the APK backlog early** — several "fixed" items are only fixed in the repository.

---

## 8. Still to decide, all modules

Pulled together so none is lost:

| Module | Question |
|--------|----------|
| Mapping | Two levels or three? |
| Mapping | May a customer with no parent still order? (assumed yes) |
| DMS | May a distributor order *for* a dealer? (assumed no, v1) |
| DMS | Which prices does a distributor see? |
| DMS | Does a distributor record payments, or only view them? (assumed view) |
| DMS | Charged per distributor login? |
| Buying Status | Does a Cancelled order make someone a Buyer? (assumed no) |
| Buying Status | May a rep release the manual lock? (assumed admin-only) |
| Codes | Year or month in the code? (assumed no) |
| Codes | Counter resets yearly? (assumed no) |
| Codes | Auto-generate product SKU at all? |
| All four | Which plans include them — or are they on every plan? |

The assumptions above are safe defaults, not guesses dressed up: each takes the less
surprising option, and each is one line to change. Work can start without the answers; none
of them blocks a migration.
