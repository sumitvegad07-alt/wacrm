# OZZO DMS Plan 5 — recording payments, filters, dispatch and customer parity

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Everything the founder asked for on 2026-11-15 after using the portal, in the
order that unblocks him fastest.

**Still outstanding before any of this matters:** `portal_place_order` is the one function
of eighteen not on production. Until he pastes
`docs/RUN-THIS-SQL-dms-plan-4-LAST-BLOCK-place-order.md`, no order can be saved at all.

---

## 0. The research he asked for, and what it settles

> *"a salesman is visiting a dealer/retailer and collecting order and payments and those
> entries should be visible to the distributors and the payments collected by the salesman
> should be handover to distributors? … do some deep research."*

**He is right, and it is the standard Indian FMCG/general-trade model.**

* **Secondary sales are the distributor's own sales.** Primary = brand → distributor;
  secondary = distributor → kirana/retailer. The receivable from the retailer belongs to
  the **distributor**, not the company.
* **The field rep collects that money.** India's NSQF occupational standard for the
  *Distributor Sales Representative* (TSSC, TEL Q2100, NSQF level 3) lists, as performance
  criteria, collecting payment from retailers against delivered stock, issuing receipts and
  recording the transaction — and collecting the stock itself *from the distributor*. The
  role is named after the distributor for a reason.
* **Cash is settled daily with the distributor.** Every van-sales/DSD product in the market
  closes the rep's day by matching stock **and cash** against what was loaded that morning.

**So the cash in a rep's pocket at 6pm is the distributor's cash.** Which decides two
things this plan was otherwise going to argue about:

1. **Payments the rep collects MUST be visible to the distributor**, with the amount, the
   shop and the date. They already are — that is what the Payments screen shows.
2. **"Collected by" is not a nicety, it is the accountability chain.** A distributor who
   can see ₹5,000 collected from Migration pharm but not *who is holding it* cannot chase
   it. Same for "Booked by" on an order: a retailer disputes a quantity and the distributor
   needs to know who wrote it down.

### This REVERSES a founder ruling, on purpose

Spec §17 q4, his own decision of 2026-11-07, is **"no employee is ever named to a
distributor"**, and `portal_orders` deliberately returns no salesman — it says *Portal* or
*Company* and stops. He is now asking for the opposite, and the cash-handover model is why
he is right to. **Flag it to him; do not quietly flip it.** The narrow version is the one
to build: the **name** of the person who booked or collected, and nothing else about them —
no employee code, no phone, no role, no territory.

---

## 1. Payments a distributor can record — SEE §1A, which supersedes the model here

> *"Ok let them record a payment and allow them to convert statuses."*

### The distinction the money forces

| Payment | Whose money | Who records | Who changes status |
|---|---|---|---|
| A shop pays the distributor | the **distributor's** receivable | distributor | **distributor** |
| The distributor pays the company | the **company's** receivable | distributor records it | **company only** |

A distributor marking their own ₹95 to the company as Approved is marking their own
homework. Recording it is right — "I have paid you, here is the UTR" — approving it is the
company's. **Build both, and say on screen which one the reader is looking at.**

### The constraint that shapes the build

`enforce_payment_status_transition()` (migration `20260814210000`) refuses an Approved
insert or update unless `has_permission(auth.uid(), account, 'approve_payments')`, and a
portal user has **no `profiles` row**, so `has_permission` is false for them — the trigger
refuses. Allowed transitions are fixed: `Pending→Approved`, `Pending→Rejected`,
`Pending→Cancelled`, `Approved→Cancelled`, and Approved is otherwise read-only.

Three ways through, and only one is acceptable:

1. ~~Give portal users a profile~~ — 107 web files and 56 DB functions read `profiles`.
   This is the thing Plan 2 was built to avoid.
2. ~~Bypass the trigger~~ — it also enforces the future-date ban, the backdating limit and
   the mandatory cancellation reason. Those must apply to a distributor too.
3. **Teach the trigger about one more kind of caller.** `set_config('ozzo.portal_write',
   'on', true)` inside the portal's definer function, and the permission branches read
   `OR current_setting('ozzo.portal_write', true) = 'on'`. The flag is transaction-local
   and can only be set inside a definer function the portal can call, which itself refuses
   anything but a receipt from one of the caller's own customers. Every other rule in the
   trigger still runs.

   The same pattern already exists in this schema: `set_buying_status()` sets
   `ozzo.system_write` for exactly this reason.

- [ ] **1.1** `supabase/tests/74_portal_payments_write.sql` FIRST. Scenarios:
      P1 record a receipt from their own shop → allowed, lands Pending, `source='customer'`;
      P2 record one for another distributor's shop → refused;
      P3 record one for another tenant → refused;
      P4 a future-dated receipt → refused (the trigger's rule still applies);
      P5 backdated beyond the account's limit → refused;
      P6 distributor approves a receipt from their own shop → allowed;
      P7 distributor approves their own payment TO the company → **refused**;
      P8 Approved → Pending → refused (the transition table still applies);
      P9 cancel without a reason → refused;
      P10 the `ozzo.portal_write` flag does not survive the function (next statement cannot
      approve anything);
      P11 a revoked login → refused;
      P12 the amount must be > 0 and the shop must be theirs.
- [ ] **1.2** Migration `20261116100000_portal_record_payment.sql`:
      `portal_record_payment(p_payment_id uuid, p_contact_id uuid, p_amount numeric,
      p_payment_type text, p_date date, p_reference text, p_notes text)` and
      `portal_set_payment_status(p_payment_id uuid, p_status text, p_reason text)`.
      Idempotent on `p_payment_id`, like `portal_place_order`. Receipt number from the
      existing generator, never a second series.
- [ ] **1.3** Mutation-check: remove the "their own customer" check → P2/P3 fail; remove
      the "not themselves" check on status → P7 fails; remove the flag reset → P10 fails.
- [ ] **1.4** The screen: **Record payment** on the Payments list, and a status action on a
      receipt the distributor owns. Their own dues to the company show the status read-only
      with one line: *"Your company confirms this one."*
- [ ] **1.5** RUN-THIS-SQL document.

---

## 1A. SUPERSEDES §1 — the collection route is per distributor

Founder, 2026-11-15, after reading the research:

> *"In one organisation there are different ways some distributors collect payment them
> selves and some distributors send salesman to collect payments… this option will be
> provided when admin enable DMS access at that time he will choose for that particular
> distributor how they want to handle payments entries."*

He is describing two routes, chosen per distributor at the moment DMS access is granted:

* **A — direct:** Shop → Distributor → Company. *"we must need to mentioned which salesman
  did enter it."*
* **B — via salesmen:** Shop → Salesman → Distributor → the company's salesman → Company
  approves.

### The structural point that makes this buildable

**Two different questions are being answered by one word, and they must not be.**

* **Custody** — who is holding the money right now? That is what his arrows are. Route A
  has two handovers; route B has four.
* **Approval** — is this receipt accepted? That is `payments.status`, which already exists,
  already has a fixed transition table, already has permissions and an audit trail, and is
  already read by the CRM, the mobile app and the ageing report.

If the four hops are squeezed into `status`, "Approved" comes to mean two things and every
existing screen that reads it becomes wrong. So: **`status` is untouched, and custody
becomes its own thing.**

### And route B is really TWO ledgers, not one chain of four

Follow the money rather than the arrows:

| Leg | Who owes whom | What settles it |
|---|---|---|
| Shop → … → Distributor | the shop owes the **distributor** (secondary) | a receipt against the shop's outstanding |
| Distributor → … → Company | the distributor owes the **company** (primary) | a payment against the distributor's own outstanding |

The company never receives the shop's money. It receives *the distributor's* money, which
the distributor happens to have funded out of collections. These are two payment rows
against two different customers, and the portal already shows both — "You owe the company
₹95" and "Your customers owe you ₹28,997" are those two ledgers.

**So the salesman legs are custody steps inside each ledger, not a single five-party
pipeline.** This matters: modelled as one chain, a shop's ₹5,000 would appear to reduce the
distributor's dues to the company, which is wrong and would corrupt the ageing report.

### What gets built

**The setting** — `contacts.portal_collection_route`, `'direct' | 'salesman'`, default
`'direct'`, set on the **Provide DMS Access** block beside the login, exactly where he said
it belongs. It is a **seventh portal column**, so it MUST be added to both lists inside
`guard_contact_portal_columns()` (migration `20261108100000`) — the guard names its six
columns one by one, and a column it does not name can be changed by anyone, silently.

**The setting decides what the PORTAL OFFERS, not what is true.** A distributor on
`'salesman'` whose own man is off sick still collects a payment himself that day. So the
route changes which buttons and which confirmations the portal shows; the payment row
records what actually happened either way. A rule that forbids the real world loses.

**The custody trail** — `payment_handovers (payment_id, seq, from_party, to_party,
happened_at, recorded_by_profile_id, recorded_by_contact_id, amount, note)`. A table, not
columns on `payments`: route A has two rows and route B four, he has asked for a "logs
view", and this IS that log. `from_party`/`to_party` are `'shop' | 'salesman' |
'distributor' | 'company'`.

**Who may add a hop**: only the party receiving the money, and only for a payment they can
already see. A distributor confirms *salesman → distributor*; the company confirms
*distributor → company*. Nobody can confirm a handover to somebody else.

**"Which salesman entered it" already exists** — `payments.user_id` and `orders.user_id`
are the auth user who created the row, and `payments.source` already distinguishes a
visit-collected receipt (`'visit'`) from an office one (`'admin'`). §2 of this plan surfaces
the name; nothing new is recorded for his point 1.

- [ ] **1A.1** Scenarios first, in `supabase/tests/74_portal_payments_write.sql`: the ones
      listed in §1.1, plus — the route defaults to `'direct'` for an existing distributor;
      a handover can only be added by the receiving party; a handover against another
      distributor's payment is refused; the two ledgers stay separate (a shop's receipt
      never moves the distributor's own outstanding); and the guard refuses a direct write
      to `portal_collection_route` from an API role.
- [ ] **1A.2** Migration: the column, the guard update, `payment_handovers` + RLS,
      `portal_record_payment`, `portal_set_payment_status`, `portal_confirm_handover`.
- [ ] **1A.3** Mutation-check each rule, including the guard's new column.
- [ ] **1A.4** CRM: the route selector on the DMS access block; a **Collected by** column
      and a handover state on the Payments list; the handover log on the payment.
- [ ] **1A.5** Portal: Record payment, the status action on their own receipts, and
      "Received from salesman" confirmation when the route is `'salesman'`.

### Three answers still needed from him

1. **Can one distributor use both routes at once** — some shops collected by his own man,
   some by himself? The build above says yes and treats the setting as the default. Confirm.
2. **When a salesman collects for a distributor, may the distributor REJECT the receipt**
   (wrong amount, cheque bounced), or only confirm it? Rejecting somebody else's entry
   needs a reason and an audit row; confirming does not.
3. **Does the company's salesman collecting FROM the distributor need the same portal
   confirmation**, or is that leg entirely inside the CRM? It is the company's own money
   and the company's own staff, so this plan assumes the CRM and the portal only shows it.

## 2. "Collected by" and "Booked by"

- [ ] **2.1** `portal_payments` returns `collected_by_name`; `portal_orders` and
      `portal_order_detail` return `booked_by_name`. The NAME only, resolved from
      `profiles.full_name` for a staff row and from the portal contact for a portal row
      (the distributor's own login reads as their own business name).
- [ ] **2.2** Scenarios: the name appears for a staff-booked order; nothing else about the
      employee is in the payload (no email, phone, code or role — assert the JSON does not
      contain them); a portal-placed order says the distributor, not an employee.
- [ ] **2.3** Both columns on the lists, in MANAGE COLUMN, and in the export.
- [ ] **2.4** Update spec §17 q4 to record the reversal and the reason.

## 3. A filter row on every table

> *"all the tables view has no filtering option similar to what we have in our OZZO."*

The CRM filters server-side through `useServerTable`; the portal's lists are server
components reading `portal_*` functions that take no search. So the filter has to reach the
function.

- [ ] **3.1** Extend `portal_orders`, `portal_customers` and `portal_payments` with
      `p_search text` plus the per-column filters each list needs (status, placed via,
      buying status, mode). Keep every existing argument in place and defaulted — these
      functions are LIVE on production and a changed signature is a 404 for the running app.
      **Add a new overload only if an argument cannot be appended.**
- [ ] **3.2** The filter row in `DataTable`, copied from the CRM's: one control per column,
      driven by the URL like the pager, so a filtered list has an address.
- [ ] **3.3** A text filter must not be a full table scan on Mumbai: match
      `search_text` where the table has it (contacts does), else the two or three columns
      that matter.
- [ ] **3.4** Scenario: a filter narrows the rows AND the count, and the export carries the
      filtered set, not the whole table.

## 4. Dispatch on the order

> *"once the purchase order is placed and the order is dispatched the dispatched details
> should be visible here in portal too."*

- [ ] **4.1** Read how the CRM's order page shows it (`dispatches`, `dispatch_items`,
      ordered vs dispatched quantity, the order's own status flow).
- [ ] **4.2** Extend `portal_order_detail` with per-line `dispatched_quantity` and a
      `dispatches` array (number, date, status, items). Nothing about the vehicle, the
      driver or the delivery boy — spec §17 q4 again, and it is a person.
- [ ] **4.3** Scenarios: a part-dispatched order shows 10 ordered / 4 dispatched; a
      dispatch on another distributor's order is invisible; the figures agree with the
      CRM's own.
- [ ] **4.4** The order screen: a Dispatch summary block and the per-line columns, in the
      shape the admin app uses.

## 5. Customer form parity

> *"i need the same name of the fields when we create customers in OZZO … at least provide
> drop down options to add country, state, city … and if area and sub area flow is enabled
> from Admin those fields should be here in DMS too."*

- [ ] **5.1** `portal_customer_form()` returns the tenant's OWN labels for the predefined
      contact fields (`custom_fields.system_key` = company / name / phone / address / city
      / gst_number …), their required flags, the mapping mode, and the territory options:
      countries → states → cities, plus areas and sub-areas when the account has that flow
      on. **Labels are read, never hardcoded** — an admin who renames "Company Name" in
      OZZO renames it in the DMS, which is the drift he is complaining about.
- [ ] **5.2** `portal_create_customer` v2 takes `p_country/p_state/p_city/p_area_id` and
      resolves `territory_id` through the existing hierarchy. Credit limit, price list and
      customer code stay withheld.
- [ ] **5.3** Scenarios: the labels come from the tenant's rows; a territory outside the
      account is refused; an area the account has not enabled is ignored; the existing
      V-series still passes.

## Sequencing

1 (payments) and 2 (collected by) ship together — they are the same screen and the same
question. 5 (customer parity) and 4 (dispatch) are independent and can follow. 3 (filters)
is the largest and touches three live functions, so it goes last and alone.

**One RUN-THIS-SQL document per shipped group**, never two blocks in one file again: that
is how `portal_place_order` came to be the only function missing.
