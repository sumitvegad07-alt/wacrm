# Secondary Sales — one setting, four steps

**Date:** 2026-11-04
**Status:** approved by the founder, build started
**Supersedes:** the beat-based half of `ozzo-new-modules-2026-11.md` §Customer mapping (`0da822a`)

---

## 1. Why this exists

OZZO ships two separate switches for what is really one feature:

| Switch | Where | Writes | Decides |
|---|---|---|---|
| Enable distribution hierarchy | Settings → Orders | `order_settings.hierarchy_enabled`, `order_settings.levels[]` | what KIND of customer this is, and so whether an order is primary or secondary |
| Customer mapping | Settings → Modules | `extra_settings.customer_mapping_mode` | WHO supplies this customer (`contacts.parent_id`) |

The founder, 2026-11-04:

> "Currently we have 2 settings enable customer hierarchy and customer mapping —
> those 2 settings are actually not good option, that actually force users to
> perform two separate tasks for one action."

He is right. Neither half is useful alone. Levels without parents classify orders
as primary and secondary but cannot say *through whom*. Parents without levels
have no rule for who may supply whom. They are one feature with one switch.

## 2. What is NOT changing, and why

**The stored keys stay exactly where they are.** `hierarchy_enabled`, `levels[]`
and `customer_mapping_mode` are read by database triggers (076's
`trg_enforce_contact_hierarchy_level`, 077's classification), by
`customer_mapping_mode()`, by pricing (`calculateOrderPricing`), by the report
registry, and by the mobile app. Renaming them means a migration across ten SQL
objects plus an APK, and buys nothing a user can see. This change rebuilds the
**screen**, not the storage.

**Order classification does not change.** Level 1 → `primary`, any level below →
`secondary`, no level → `direct`. The founder asked for:

> "if the order is from the top level it should be primary ... if the top level
> is super stockiest than it's order should be primary and rest of all the levels
> of customer's orders should be secondary, if the top level is stockiest than
> the same thing"

That is already true today, because level 1 is whatever the tenant names it.
Nothing in migration 077 needs touching.

## 3. The finding that changed the design: a beat is not an area

The founder's reply when asked how the upper levels should get their parent:

> "in our system beat/route is not a different — Area/territory is Beat/route
> simple. For example 150 feet ring road is area assigned to salesman and same
> assigned to customer, which means the beat/route/area is assigned."

Checked in the database, the code and the screens. They are **two different
objects**, deliberately:

| | Area / Territory | Beat / Route |
|---|---|---|
| Tables | `territories` (tree: Country → State → City → Area → Sub Area) | `routes`, `route_customers` |
| Customer joined by | `contacts.territory_id` — one node | a `route_customers` row — one active beat |
| Salesman joined by | `employee_area_assignments` | `routes.primary_assignee_id`, `route_plan_assignments` (weekday planner) |
| Decides | who may **see** which customers (RLS, data scope) | which shops a salesman **visits**, in what order, on which weekday |
| Migrations | 101–105 | 108–113 |

The half he is right about: *"an area is assigned to a salesman and the same area
is assigned to the customer"* is precisely `employee_area_assignments` +
`contacts.territory_id`. That is how OZZO works.

The half that is not so: a beat is a **layer on top of** the area, not the same
record. The Route wizard says so in its own words — *"Build a beat from a
salesman's territory customers"* — and it skips any customer *"outside
territory"*. So one area can hold several beats, a beat can span areas, and a
customer can have an area and no beat at all.

They are not being merged. A beat carries visit sequence, weekday plans and
check-in/check-out history, none of which belongs on a geography tree.

**What was actually wrong is the mapping shipped in `0da822a`: it hangs off the
beat when the founder's channel model is geographic.** That is what this spec
fixes.

## 4. The design

### 4.1 One setting, four steps

A new **Settings → Secondary Sales** panel. The "Enable distribution hierarchy"
block leaves Orders settings; the "Customer mapping" card leaves Modules.

1. **Enable secondary sales** — one switch. Writes `hierarchy_enabled`.
2. **Levels and their names** — minimum **2**, maximum **5**.
   One level is refused, with the reason in plain words: with one level every
   order is primary, so there is nothing secondary to report. The founder's own
   words — *"i don't think if any company has only one level of customers they do
   not need of secondary sales"* — so although his list said "1, 2, 3 or 4", the
   minimum follows his reasoning. The maximum stays 5 because the existing
   screen already allowed 5 and a tenant may have used it.
   Level 1 is the top of the chain; the panel shows the chain as
   `Super Stockist → Stockist → Distributor → Dealer`.
3. **How are customers mapped** — **Manually** or **By area**.
   "From the beat" is no longer offered.
4. **Map them** — the new Mapping screen (§4.4).

A tenant who today has `hierarchy_enabled: true` and mapping `off` keeps working
unchanged; step 3 simply shows as unanswered with a nudge. Nothing is forced.

### 4.2 Mapping by area

One new table records, per area, **who holds each level there**:

> 150 Feet Ring Road → Super Stockist: A · Stockist: B · Distributor: C

```sql
customer_channel_parents (
  account_id        uuid not null,
  territory_id      uuid not null,
  hierarchy_level   int  not null,   -- the level the parent HOLDS
  parent_contact_id uuid not null,
  primary key (territory_id, hierarchy_level)
)
```

Keyed by the level the **parent** holds, not the child — because that is how the
founder describes it ("Customer C is Distributor") and because it makes the
screen one row per level per area.

A customer's parent is then **whoever holds the level directly above them, in
their area**:

- Dealer (4) → the level-3 holder → C
- Distributor (3) → the level-2 holder → B
- Stockist (2) → the level-1 holder → A
- Super Stockist (1) → no parent; level 1 is the top

This is the founder's *"hierarchy should follow the channel"*, and it needs no
beats.

### 4.3 The lookup rule, and one deliberate difference from territory coverage

Resolving a customer's parent:

1. Let `L = contacts.hierarchy_level`. If `L` is null or `L = 1`, there is no
   parent. Stop.
2. Start at the customer's `territory_id` and **walk up** the territory tree,
   taking the first `customer_channel_parents` row found at level `L - 1`.
3. If the result fails `is_legal_customer_parent` (itself, wrong level, a loop),
   leave the customer unmapped rather than write a bad parent.

Walking **up** matters because **Area is not mandatory** (founder, 2026-11-03,
migration `24dbf73`): a customer may be tagged only to a City. Setting the chain
once at City level and letting every area under it inherit is therefore the main
path for most tenants, not a convenience.

**The walk does NOT also look down**, and this is a deliberate departure from
`employee_covered_territory_ids` / `src/lib/territories/coverage.ts`, which looks
up and then down. The reason: a customer tagged to a City whose three child areas
each have a different Distributor has **no** correct supplier, and guessing one
would put real money under the wrong distributor in a channel report. "Who covers
this customer" tolerates a best guess; "who supplies this customer" does not. Such
a customer stays unmapped and is counted on the Mapping screen until somebody
answers the question.

### 4.4 Overriding one customer by hand

A new `contacts.parent_locked boolean NOT NULL DEFAULT false`. When true, area
resync skips that customer and the hand-set parent stands.

This exists for the real case the area model cannot express: one area that
genuinely holds two Distributors. It mirrors `buying_status_locked`, a pattern the
product already uses and the founder already knows.

### 4.5 The Mapping screen

New screen under Customers, two tabs:

- **By area** — the area × level grid of §4.2. Pick who holds each level in each
  area. Shows how many customers each cell will re-parent before saving.
- **Customers** — every customer with their level and their parent, settable in
  **bulk**. Today a level or parent can only be set one customer at a time; that
  does not work for 39 customers, let alone the 1,165 across all tenants.

Both tabs show the two numbers that say whether this is really on: **how many
customers have no level** and **how many have no parent**. Secondary sales is not
"set up" until both are zero, and the settings panel says so rather than silently
classifying everything as Direct.

### 4.6 Beat mapping

`customer_mapping_mode = 'beat'` keeps working in the database — the table,
triggers and `resync_account_beat_parents` from `20261103160000` are untouched —
so no tenant that set it breaks. It is simply no longer offered in the UI. The
mapping toggle could not be saved at all until `e6193e7` (today), so in practice
no tenant is expected to be on it; this is to be confirmed with a prod read
before the beat code is eventually retired.

## 5. The reported bug: Buying Status and Customer Level

> "Currently Buyer status and Customer level selection fields are editable on
> customer view page which is not ideal, it must be editable in edit view only,
> but it's not visible when we edit the customer which is again not ideal."

Both halves are real.

**Editable on the view page.** `contacts/[id]/page.tsx` renders Buying Status and
Customer Level as live `<select>` elements that write on change. Both become
read-only text, and both move into the Edit sheet — Customer Level beside
"Supplied By", Buying Status with its mandatory blacklist reason.

**Missing from the edit form.** `contact-form.tsx` draws predefined fields only
from rows in `custom_fields`, and `hierarchy_level` was added to the defaults
(`src/lib/custom-fields.ts`) after the oldest accounts were created. The form
does call `ensureDefaultSectionsAndFields` to top missing rows up, so the
file-reading theory is not proven — **the cause is to be confirmed in the
browser before the fix is written**, not guessed. Buying Status, separately, is
not in the form at all.

The robust fix either way: render both as **injected synthetic fields**, the
pattern already used for "Also Assigned To", "Assign Employee" and "Supplied By",
so a tenant missing a seeded row still sees the field. `hierarchy_level` stays a
predefined field so it keeps its place in Manage Column and Field Settings.

## 6. Build order

1. SQL: `customer_channel_parents`, `parent_locked`, the resolve/resync functions
   and triggers, `resync_account_area_parents`, a setup-status RPC. Tested on the
   local PG 17.6 harness (`tools/pgsql`) before it goes near prod.
2. `src/lib/customers/mapping.ts`: add `area` to the modes, keep `beat` accepted
   but unlisted.
3. The Secondary Sales settings panel; remove the two old blocks.
4. The Mapping screen.
5. The bug fix.

## 7. Risks

- **Trigger order on `contacts`.** The new BEFORE trigger must run before
  `trg_enforce_customer_parent`, which among BEFORE triggers means its name must
  sort first. Named `trg_area_parent_sync` for that reason.
- **Migration 076 again.** Any system write to `contacts` must set the
  `ozzo.system_write` marker or the write is rejected for a level-less customer
  on a hierarchy account — and would take the caller's transaction down with it.
  The `customer_channel_parents` fan-out write uses it.
- **Recursion.** Resync must not re-trigger itself. The `contacts` trigger fires
  on `territory_id` and `hierarchy_level` only, never on `parent_id`.
- **Existing level-less customers.** Making level mandatory on the form does not
  fix the customers already saved without one; that is what the Mapping screen's
  bulk edit and the two counts are for.
