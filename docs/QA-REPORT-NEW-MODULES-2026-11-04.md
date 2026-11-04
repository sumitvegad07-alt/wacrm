# QA report — the four November modules

**4 November 2026. 45 database scenarios, 12 screens clicked through on the live
account, 4,045 unit tests. Five bugs found, five fixed, all re-tested.**

The four modules are Buying Status (with Blacklist), Customer mapping, Automatic
codes, and the territory "area is not mandatory" fix.

---

## Where it stands

| Module | Database | Screens | Verdict |
|---|---|---|---|
| Buying Status | 15 / 15 | Column, filter, Manage Column, detail, reports | **Working** |
| Customer mapping | 13 / 13 | Form, column, filter, beat mode, Routes | **Working** |
| Automatic codes | 6 / 6 | Preview, backfill count, save | **Working** |
| Territory / area | 7 / 7 | Checked under real row-level security | **Working** |
| Settings panel | n/a | Each toggle saved on its own | **Working** |

Everything found has been fixed and re-tested. Nothing is known to be broken.
That is not the same as "there are no bugs left" — the limits are listed at the
end, and they are real.

---

## The five bugs

### 1. Settings said "saved" and threw the choice away — `e6193e7`

Buying Status, Customer mapping and Automatic codes could not be switched on at
all. Picking one and pressing Save reported success and wrote the value the
control had started with.

`handleSave` is a `useCallback` and those three were missing from its dependency
list, so React kept handing the Save button a copy of the function from an
earlier render. It saved correctly only if some *other* setting happened to
change in the same visit, which is why it looked intermittent. `handleDiscard`
had the mirror gap.

**This is why the other three bugs were invisible.** Every screen behind those
toggles had never run in production.

### 2. A saved supplier still read "Direct" — `1e2902e`

Choosing a supplier saved correctly, but the customer page kept saying "Direct —
no supplier recorded" until the page was reloaded. Saving reloads the customer
row; the supplier is a separate query whose effect was keyed on the customer id,
which does not change when you edit a customer.

The one screen meant to confirm the mapping had worked said it had not.

### 3. "Buying Status in reports" did not exist — `470bff7`

The migration registered a dimension, a measure and a filter for the Order and
Ageing reports in the database. The report screens do not read those tables —
they build from the TypeScript config, and neither report's config was ever
told. The SQL was correct and unreachable.

Both reports now group by Buying Status, and the measure "Buyers Opened" is
offered. Gating it needed a new mechanism: the registry rows exist for every
tenant, while the module is off by default. With the module off, the tab, the
measure and the filter are all absent. Verified both ways.

### 4. An order would not save once Customer Level was on — `470bff7`

Saving an order recalculates the customer's outstanding balance, which writes to
the customer's row. Switching Customer Level on makes the level compulsory and
the database refuses any write to a customer without one — so **the order
failed**, telling the salesman to set a level he had never touched. Deleting an
order and taking a payment failed the same way.

The November build had already invented `is_ozzo_system_write()` for exactly
this and given it to Buying Status. The outstanding balance is older and never
got it.

Not caused by the new modules, and nobody has hit it: no tenant has Customer
Level switched on. Two accounts already have the levels **defined**, so it is
one click away, and it would have failed on the very first order.

### 5. A column no migration ever created — `470bff7`

`contacts.customer_code` exists on the live database but is created by no
migration, so the chain could not rebuild the schema — the automatic-codes
migration puts a unique index on it and failed outright. Same drift as
`data_scope_extends`. Finding it is what made the database testable at all.

---

## What was actually checked

**Database — 45 scenarios, run against a real PostgreSQL** with every migration
applied, now kept in `supabase/tests/`. This layer had no automated test of any
kind before, and it is where the rules these modules promise actually live.

Every rule holds **even against the service-role key, which bypasses row-level
security** — so it holds for every tenant, on the web, on the phone, through an
import and through the API:

- a blacklist with no reason, or a whitespace reason → refused
- an invalid status value → refused
- a supplier from another tenant → refused
- a customer supplying itself → refused
- a supply loop (A supplies B supplies A) → refused
- a dealer supplying a distributor, with levels on → refused
- a non-admin, and an admin of another tenant → refused

And the things that must work: order history drives the status, cancelled and
rejected orders do not count, a human override locks the row, a locked row
ignores new orders, a one-time stop does not change anybody's supplier, the
re-map dry run counts exactly what the write changes, codes grow past their
digit width instead of truncating, and each tenant's code sequence is its own.

**The territory fix, under real row-level security**: a rep assigned one Area
sees the customer tagged only to the City above him (the original complaint),
sees his own area's customers, and does **not** see the neighbouring area's —
exactly two rows visible, which is right.

**Production data, all 11 tenants, read-only**: across 1,165 customers and 6,403
orders, Buying Status agrees with real order history in every single case, with
no mismatched `first_order_at`, no invalid status, no reasonless blacklist and
no cross-tenant supplier.

**Screens, on the live account**: settings saving each toggle alone, the
customers list column and filter, Manage Column, the detail page status change,
the blacklist reason being demanded, the Supplied By picker, beat mode's
read-only box, the Routes supplier box, both reports, and the auto-code preview
and backfill count.

---

## What this does NOT cover

- **The phone.** Mobile reads the same setting for the Buying Status badge, but
  no APK has been built, so it is unproven and will stay that way until one is.
- **A tenant with Customer Level switched on, in the screens.** The rules are
  tested in the database; the forms are not, because no tenant has it on.
- **The AI connector (MCP)** gates whole data sets by module, not single fields,
  so Buying Status is visible there even to a tenant with the module off. The
  figures are correct and maintained for everyone by design; it is a
  consistency gap, not a leak, and closing it means a new per-field gate.
- **Load and concurrency.** Code generation was proven duplicate-free under
  concurrent writers in an earlier session, not re-run here.

---

## Two SQL files still to run

Both are safe to run twice, and neither changes anything today:

| File | Why |
|---|---|
| `20261104110000_contacts_customer_code_column.sql` | Declares the column the live database already has |
| `20261104120000_outstanding_is_a_system_write.sql` | **Run before switching Customer Level on for anyone** |

`docs/RUN-THIS-SQL-outstanding-system-write.md` explains both in plain terms.

---

## Account 001001, as left

Buying Status **on** and Customer mapping **Manual** — what you were trying to
set. Automatic codes **off**: switched on only to test, and switched back.
`BUG-01 Test Customer` was used for the blacklist and supplier tests and put
back exactly as it was. No module toggle changed, no beat supplier was created,
and no customer was re-mapped.
