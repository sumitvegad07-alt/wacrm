# Feature catalogue — what each module does, and how it really behaves

This file is not a description of the screens — that is [ui-inventory.md](ui-inventory.md). It is
the **behaviour behind them**: the rules a customer will argue with you about, and the ones that
decide whether an answer is right.

**Label:** VERIFIED IN CODE, 2026-10-27, from the implementation and from `wacrm-web/PROJECT.md`,
which records what was verified against the production database when each feature shipped.
Entries marked **VERIFIED IN BROWSER** were also seen working on 2026-10-27.

Who can reach each of these is a separate question — see
[access-control-matrix.md](access-control-matrix.md).

---

## Customers

**Table:** `contacts` — note the name. Customers live in `contacts`; there is no `customers`
table. **VERIFIED IN BROWSER.**

- A customer carries an **owner** (`employee_id`) and a **collaborator list**. Collaborators get
  full access to the record; the owner is unchanged, so reports and targets still credit one
  person.
- **Credit control** is on the customer: Credit Limit, Credit Days and Opening Balance. The
  detail page shows Outstanding Balance, Available Credit and a Payment Status computed from the
  credit terms, with the formula printed on screen: *Opening + Closed Orders − Paid*.
- **A phone number is unique per account and that cannot be switched off.** Other duplicate
  checks (Name, Customer Code) are opt-in at Settings → Organization Settings.
- **Customer hierarchy** is an opt-in setting. Off, every order is a simple direct order. On,
  orders are classified primary/secondary from the customer's level.
- **Territory is denormalised onto the customer by a database trigger** on every write path,
  including import. A customer with a blank city still gets its territory columns filled.

**Common question — "why can't I save this customer?"** Almost always the phone-number
uniqueness rule, which is always on.

---

## Leads

**Needs:** CRM line. **VERIFIED IN BROWSER.**

- A lead has the same shape as a customer — owner, collaborators, territory, GPS — and converts
  into one.
- **WhatsApp Number is a required field** on the create form, with a "Same as Phone Number" tick.
- Leads had **no duplicate checking at all** until recently. The settings screen warns that
  switching one on "starts rejecting saves that used to be allowed".
- A lead that is marked **Lost stays Active** as a record — Lost is a status, not a deletion.

---

## Deals and pipelines

**Needs:** CRM line. **VERIFIED IN BROWSER.**

- `/deals` and `/pipelines` are the **same screen** (N-004).
- A deal carries line items with their own prices and tax, and totals to Subtotal / Tax / Total.
- Measures on the list: Total Deals, Pipeline Value, Avg Deal Size, **Weighted Value**, Won This
  Month, Lost This Month.
- **Pipeline Value and Weighted Value count different deals.** Pipeline Value is every active
  deal, won ones included. Weighted Value is **open deals only**, each multiplied by its stage's
  probability. So the two never match, and Weighted Value drops when a deal is won — which looks
  wrong and is not. That is what a customer is really asking when they say the pipeline numbers
  disagree.
- Stages are configurable per account at Settings → Deals.

---

## Quotations

**Needs:** CRM line **+ the `quotation` module**. **VERIFIED IN BROWSER.**

- A quotation can be raised against a **customer or a lead** — the form asks which first.
- Line items carry PRODUCT, UNIT, QTY, PRICE, TAX % and TOTAL.
- **Terms and Conditions come from a template**, chosen on the form; templates are managed
  separately.
- Quotations are **versioned**: creating a new version copies the source quotation into a fresh
  record **dated today** and keeps the earlier one, so a customer can always be shown what was
  quoted before. Cloning works the same way.

---

## Products and the catalogue

**Needs:** CRM **or** SFA — never WFA alone. **VERIFIED IN BROWSER.**

- **A product has no tax rate of its own.** The rate comes from the tax slab it points at
  (`products.tax_slab_id → tax_slabs.rate`). Tax slabs are configured per account at Catalogue
  Settings. Call it **tax**, never GST — GST is a separate setting.
- **`min_price` is a hard floor.** No stack of discounts may cross it. Empty means no floor. This
  is the answer to "the system won't let my salesman give that discount".
- **Categories are a tree, up to three levels**, and the number of levels plus each level's name
  is configurable on the Categories screen itself.
- **Units are configurable**, and with **Multi Unit** switched on a product can carry conversion
  units (1 BOX = 12 PCS). Reps then order in any unit, while **price and stock stay in the base
  unit**. That is the rule to quote when the numbers look wrong after switching it on.
- Categories and Units are created in an **in-page dialog** — there is no separate create page.

---

## Price lists

**Needs:** SFA line.

- A price list can carry a **blanket discount** *and* **per-product overrides** at the same time.
- Resolution order for a customer's price: **product override → blanket discount → catalogue
  price**.
- A customer with no price list gets the catalogue price. The customer form says so: "Catalogue
  price (no price list)".
- **`allow_discount_over_price_list` ships OFF.** With it off, a salesman cannot discount further
  on top of a price-list price. This is the second most common "the app won't let me discount"
  answer, after `min_price`.

---

## Schemes

**Needs:** SFA line **+ the `scheme` module, which ships OFF** and is switched on from
**Catalogue Settings**, not Organization Settings.

- Schemes are slab-based: buy *n*, get a discount or free goods. Free goods arrive on the order
  as lines flagged `is_scheme_goods`.
- A scheme can be restricted to particular products and particular customers.

---

## Orders — the module most support calls are really about

**Needs:** SFA line. **VERIFIED IN BROWSER.**

### How an order is priced

**`calculate_order_pricing()` in the database is the single source of truth for order money.**
The sequence is **fixed and not configurable**:

> catalogue price → price list → scheme → salesman discount → price floor

It is deliberately not configurable: a configurable order would have to store the whole active
configuration with every order, or its price could never be explained afterwards.

**The TypeScript pricing in the app is an advisory mirror**, used for live totals on the form and
for offline entry. It is not authoritative. When the two disagree, the server's figure is used.

### Quoted price wins

When the server disagrees with what the salesman promised the customer, it **does not overwrite
the promised price**. It records its own figure in `expected_total` and `pricing_variance`, sets
the order's `pricing_status` to `review`, and leaves it for an admin to judge.

Those orders are listed at **Order Sync Health**, together with a **pricing drift log** — "where
an online client's total disagreed with the server on identical inputs". The screen states
plainly that **money is unaffected, because the server figure is used**.

**This is the screen to open for any argument about an order total.** VERIFIED IN BROWSER.

### Discounts and tax

- A **whole-order discount is spread pro-rata across the lines**, not held at the header, so each
  line's tax reduces correctly.
- **Tax inclusive/exclusive is stored per line**, not per order. An edited order keeps its old
  lines on their original basis and prices only the new lines on the current setting — a single
  order-level value cannot represent a mixed order. The account default is in Order Settings.

### The status lifecycle

A state machine enforced in the database, not just in the app:

```
Pending  →  Approved | Rejected | Cancelled
Approved →  Dispatched (automatically only) | Rejected | Cancelled
Dispatched, Rejected, Cancelled  →  terminal
```

- **"Dispatched" cannot be set by hand.** Creating a dispatch is the only way to reach it, so the
  detail screen shows the Create Dispatch button only while the order is Approved.
- Once anything ships, the order is **locked** and can no longer be edited.
- Every status change is written to the activity log with who did it.
- A client that tries to write the status directly is rejected by a trigger, so bypassing the app
  does not work either.

**Support consequence:** "I can't change this order to Dispatched" is correct behaviour — create
the dispatch. "I can't edit this order any more" means it has already shipped.

---

## Dispatch and Pending Dispatch

**Needs:** SFA line + the `dispatch` / `pending_dispatch` modules. **VERIFIED IN BROWSER.**

- **A dispatch belongs to exactly one order.** Its lines are that order's items, **capped at the
  remaining quantity**.
- **Prices are inherited from the order line and are read-only.** A dispatch cannot change money.
- **Order status is derived from delivered-versus-ordered**, recomputed automatically on every
  change to the dispatch lines: none delivered → Approved; some but not all fully shipped →
  **Part Dispatch**; all fully shipped → Dispatched.
- Several dispatches can therefore belong to one order, and **Pending Dispatch is the work queue**
  for the part-delivered ones, showing Ordered / Delivered / Difference per order.

---

## Payments

**Needs:** SFA line + the `payment` module. **VERIFIED IN BROWSER.**

- A payment records a collection against a customer: Amount, Payment Type, Date, Reference
  Number, and an optional receipt or cheque photo.
- Payments carry a **Verified** flag and a **Source** (where it was collected from) separately
  from Status — three different concepts on one row.
- Payment types are configurable at Settings → Payments.
- **Approval rights are their own permissions.** Being able to see payments does not include
  approving them.

**Four rules decide whether a payment actually reduces a balance** — this is the detail behind
"he paid, so why is the outstanding the same?":

1. **Only orders in the statuses the account treats as debt are counted.** A Cancelled or
   Rejected order owes nothing and is simply absent.
2. **Only payments in the statuses the account treats as received are counted**, and that rule is
   configurable per account — so on some accounts a payment that has not been approved yet
   reduces nothing.
3. **The verified amount wins over the collected amount once it exists.** Not yet verified means
   "unknown", not zero: an approver may verify a different figure from the one the rep entered.
4. **Payments settle oldest-first** — the opening balance first, then orders by date. So a new
   payment often clears an *older* order rather than the one the customer is asking about.

A payment whose customer was deleted settles nothing at all, rather than being spread across
every customer-less order.

---

## Stock

**Needs:** SFA line + the `stock` module, which **ships OFF** and is switched on from **Catalogue
Settings**.

- **Closing stock is not stored. It is derived** by summing the stock ledger. That is why the
  screen says "Closing stock per product, calculated automatically".
- Opening / In / Out / Closing are all read from that ledger, and clicking a product opens its
  full ledger and activity.
- Opening stock is loaded through the importer, not typed in.

**Support consequence:** a wrong closing figure is never a wrong *field* — it is a missing or
duplicated ledger movement.

---

## Expenses

**Needs:** WFA line + the `expense` module. **VERIFIED IN BROWSER.**

- A claim carries Expense Type, Date, Amount, Remarks and an optional proof attachment (photo or
  PDF).
- Expense types and allowance types are configurable at Settings → Expense Settings.
- The list has status tabs: All / Pending / Approved / Rejected.
- **Approving is a separate permission from viewing**, and the approval path is enforced by RLS —
  a role without the approve right gets a refusal from the database, which the UI surfaces as
  "Failed to update status".
- The expense module stores its type name in a column called `expense_name`, not `name` — this
  matters when a report or a print layout looks wrong.

---

## Tasks and activities

**Base feature — every plan.** **VERIFIED IN BROWSER.**

- One module covers **TASK / CALL / VISIT / MEETING / FOLLOW UP / NOTE** — the type is a chip at
  the top of the form.
- **Several people can share a task**, and each ticks off their own copy. The first assignee in
  the list is the one written to the order-of-record field that reports and the installed mobile
  apps read.
- A task can be **linked to** almost anything: a customer, lead, deal, quotation, order,
  dispatch, payment, expense, leave record, product, scheme or conversation.
- The detail view carries a **checklist**, **attachments** and a **comment thread**.
- **Assignment is optional** — a task with nobody on it is valid.
- ⚠️ **The create form is broken when opened by its own URL** (F-012). Reach it from the Tasks
  list.
- ⚠️ **There is no menu entry for Tasks** (F-002).

---

## Visits

**Needs:** WFA line. **VERIFIED IN BROWSER.**

- A visit is **polymorphic**: it can target a **Customer** or a **Lead**. A lead visit therefore
  needs both the CRM and WFA lines — neither alone can produce one.
- A visit records check-in and check-out with **location at both ends**, a duration, an image and
  a feedback type.
- **A visit is "productive" if it produced an order.** That is the definition behind the
  Productivity % on the Visit report and the dashboard, and it is worth stating to a customer who
  thinks productive means "went well".
- **Geo-fencing**, when switched on, blocks check-in or check-out unless the rep is actually at
  the customer.

---

## Attendance, punch in/out and geo-fencing

**Base feature — every plan.** Attendance, Leave and Holiday Management is sold in every column,
CRM included.

- A rep punches in and out; the screen measures them against the **configured shift and grace**
  and prints that on the page ("Measured against the configured shift 10:00 AM – 7:00 PM with
  15 min grace").
- **Shift times never gate tracking.** If they are punched in, they are tracked — at any hour.
  A customer who expects tracking to stop outside the shift is wrong about the design.
- **Attendance Locations** fence where a punch may happen, as a map pin with a radius of 50 m to
  1 km, and per location you choose whether it fences **Punch In only**, Punch Out only, or both.
- Two pieces of on-screen guidance worth repeating:
  - *The phone's GPS accuracy is added to the radius automatically, up to 100 m, so honest reps
    aren't wrongly blocked.*
  - **Fencing punch-out traps a rep who ends the day somewhere else.** For field staff who finish
    in the field, choose *Punch In only*.
- The Attendance screen has four tabs: Punch in / Users / **Days / Monthly**.

---

## Leave and holiday lists

**Base feature — every plan.** **VERIFIED IN BROWSER.**

- Leave statuses: Pending / Approved / Rejected / **Cancelled**.
- A leave record carries a **Breakdown** — how the days split, including half days.
- **The working week is per employee, not per company.** Each employee follows a **Holiday
  List**, which decides their weekly offs and holidays. Leave taken across those days is not
  counted, and the attendance page judges them against that same calendar.
- Every employee gets the company default list unless they are given another.

**Support consequence:** "the system counted a Sunday as leave" is a holiday-list question, not a
leave-module bug.

---

## Location tracking

**Needs:** WFA line (except Attendance and Leave, which are base). **VERIFIED IN BROWSER.**

- **Live Feed** shows every field user with an online/offline state and a map, with Tracked /
  Visits / First & last layers, plus battery and distance per person.
- **All Locations** is the raw ping list, with a **Tracking gap** column.
- **Tracking Health is the support screen.** It explains its own numbers on the page — *Expected*
  is how many locations the app should have recorded (time on duty ÷ the configured interval),
  *Regular* is how many it actually did — and carries a **Likely issue** column that names the
  cause per agent. Manage Columns reveals GPS off, switched off, critical, mock and accuracy.
- Clicking an agent opens their day, and for the commonest case answers outright: *"No shift on
  this day — this agent didn't punch in, so no location was expected."*

**Check "Not Punched In" first.** An agent who never started a shift is not a tracking fault.

---

## Route management (beat planning)

**Needs:** SFA line + the `route` module, which **ships OFF** — free-visit mode is the default.

- **Route Management is SFA, not WFA** (founder's ruling, 2026-09-26). A WFA or CRM + WFA account
  cannot have it.
- **There is no top-level menu entry by design.** Creation and approval live under Team →
  Employees → an employee → Routes; monitoring lives under Location Tracking → Route Monitor.
- A route has a **primary assignee** and may have others. Routes are **archived, never deleted**.
- **Draft is not the same as pending approval.** A route can sit in Draft with an inline Approve
  button while the Manager Inbox correctly reads Inbox Zero. This confuses people, including us —
  it is recorded in `ui-inventory.md` for that reason.
- Each route carries a **health** figure, surfaced in the Manager Inbox.
- **Routes are run on the mobile app.** Route Monitor is explicitly read-only on the web.

---

## Territory Master

**Needs:** WFA line + the `territory` module. **VERIFIED IN BROWSER.**

- Described on screen as the "single source of truth for customer geography" — a tree of
  Country → State → City and below.
- **A trigger denormalises the hierarchy onto each customer before every write**, on every path
  including import, so a customer's flat country/state/city columns always agree with the tree.
- The screen carries a **backfill helper** for customers whose geography was typed in before the
  territory list existed. It matches by name, marks what it cannot match confidently as "needs
  review", and is safe to run more than once.
- **The Settings → Territory link only appears when `assignment_mode` is `area`.** On a
  direct-assignment tenant the master is still reachable at `/territories`.

---

## Reporting hierarchy

**Needs:** WFA line + the `reporting_hierarchy` module, which **ships OFF**.

- Gives each employee a **manager** and an **approver**, walked up and down the chain.
- A cycle is rejected by a database trigger.
- ⚠️ **Switching it ON changes who can see what.** With hierarchy off, data scoping is a no-op and
  visibility stays account-wide; with it on, scoping starts applying and users without
  `view_child_data` / `view_parent_data` drop to their own records. See
  [access-control-matrix.md](access-control-matrix.md).

**Tell the customer this before they switch it on**, or they will report it as data loss.

---

## Team, roles and employees

**Base feature.** **VERIFIED IN BROWSER.**

- An employee is created **with their login** — email and password are part of the Add Employee
  form.
- Every employee has an **Employee Role**, which carries the permission set, and separately an
  **account role** (owner / admin / agent / viewer).
- **Team → Employee Roles is where every "Ask an admin to grant it" message points.**
- The Admin role carries a full bypass, which is why its permissions read "All (Admin)" rather
  than a count.
- An employee also carries a **Holiday List** and a **Territory Assignment**.

---

## The WhatsApp suite

**Needs:** CRM line + the `whatsapp` module. **VERIFIED IN BROWSER 2026-10-27.**

| Screen | What it is |
| --- | --- |
| **Inbox** | The shared conversation inbox. Holds an open realtime connection |
| **WhatsApp Dashboard** | Conversation and message analytics, including **Average First Response Time** against a 5-minute target |
| **Broadcasts** | 🔴 **The list crashes for every tenant — F-016.** Creating one still works |
| **Automations** | Two different things share this name — see below |
| **Flows** (BETA) | Branching, button-driven conversations for menus, FAQs and triage |

### Everything here is blocked behind a Meta-approved template

A broadcast cannot be sent and a business-event automation cannot fire without an approved
template. Templates are created at Settings → Templates, with a live WhatsApp preview, and
submitted to Meta for verification. Template names are lowercase, numbers and underscores only,
and the body supports `{{1}}`, `{{2}}` placeholders within 1024 characters.

**"Why can't I send a broadcast?" is almost always this**, not a permission.

### Two kinds of automation

- **`/automations/module/new`** — a **business-event** automation: "send a WhatsApp message
  automatically when something happens in your business". Module + Event + Conditions. The only
  action today is `send_whatsapp`; the screen says SMS, create-activity and update-field come
  later.
- **`/automations/new`** — a **chat-flow** builder on a canvas, triggered by an incoming message.

They are reached from the same menu entry and are easy to confuse.

---

## Reports

**Base engine; each report follows the line of the module it reports on.** **VERIFIED IN BROWSER
— all twelve.**

- Twelve reports share one engine: Filters, Set Default View, Export, Print, measure tiles and a
  grouped table. Only the measures and dimensions differ.
- **Each user can save one default view per report.**
- **Default periods differ between reports** — Product Summary opens on *Today*, Customer
  Outstanding on *Last 365 days*, the other ten on *This Month*. This is the single commonest
  cause of "the report is empty".
- Several reports carry **tabs** that change the grouping rather than the filter: Payments has
  Collections and Customer Financials; Product Summary has Customer wise / Product wise / Product
  total; Customer Outstanding has Order wise / Customer wise / Area wise / User wise.
- **A many-to-many relation can be a filter but never a dimension** — a report cannot group by
  something a record has several of, because the rows would multiply.
- **Sales means dispatched, not ordered.** The Sales report is dated by dispatch completion and
  counts Closed orders; the Order report counts what was booked. Two different numbers for the
  same month is correct.
- **Dates are account-local.** Everything is converted to the account's time zone, not the
  browser's.

⚠️ Two defects live here: F-008 (Task report tiles count records the table refuses to show) and
F-009 (two Ageing tiles print no number).

---

## Import

**Base engine, gated per module.** **VERIFIED IN BROWSER.**

- One guided flow for everything: **upload → map columns → preview → confirm**. Nothing is saved
  until the confirm step.
- Eleven importers: Customers, Products, Product Categories, Product Units, Leads, Outstanding,
  Tasks, Territories, Opening Stock, Price Lists — and **Orders, which reads "Coming soon"**.
- Each import is recorded in **Import history**, so a bad run can be identified afterwards.
- Territory denormalisation runs on the import path too, so imported customers are not a special
  case.
- ⚠️ **Import module keys are plural** while custom-field keys are singular, and a mistyped
  singular URL claims the importer is "coming soon" (N-005).

---

## Custom fields

**Base feature; each module's editor is gated by that module's line.** **VERIFIED IN BROWSER.**

- Every module can carry extra fields, arranged into **sections**, both drag-ordered.
- Per field: **Required**, show in **Table**, **Sort**, **Search**, and Active.
- **Predefined (system) fields are locked.** They cannot be deactivated and their Required flag
  cannot be changed — nor can the sections that hold them. This is deliberate: the app depends on
  them existing.
- Custom fields appear in the list screens' **Manage Column** dialog like any other column.

⚠️ On the customer detail page the predefined fields are currently **listed a second time, empty**
(F-014).

---

## Document templates and printing

**Base feature.**

- Templates drive the printed documents — orders, quotations, dispatches, receipts. The GST line
  appears only when the template includes it, which is why the Company Profile's GST help text
  says so.
- **Everything prints at A4 or A5.** A5 **scales the sheet by 1/√2** — it does not restyle it.
- Documents, internal vouchers (expense, leave) and **every table's list view** can be printed.
- ⚠️ **Settings → Document Templates cannot be opened from its own URL** (F-011).

---

## Getting Started (Implementation Center)

**Base feature.** **VERIFIED IN BROWSER.**

- A **config-driven** onboarding engine, not a hard-coded checklist: steps, their validation rules
  and their recommended thresholds are stored as data.
- Thirteen steps with time estimates, a **Score**, a **Health** percentage, a Re-check button and
  Skip to dashboard.
- Health tiles count the account's real master data (territories, roles, employees, products…)
  against a recommended minimum.
- ⚠️ **Six tiles print raw database keys instead of labels** (F-007) — on the first screen a new
  customer sees.

---

## Announcements

**Base feature.** **VERIFIED IN BROWSER.**

- An announcement targets **all users, an employee, or an employee role**, carries content, an
  optional external link and an optional attachment.
- **Status and Expiry are different things.** Status = Active means "not deleted", not "currently
  showing". A row can be Active and Expired at once.

---

## Subscription and billing

**Base feature.** **VERIFIED IN BROWSER.**

- Read-only for the tenant: Customer ID, Plan, Start / Renewal / Expiry dates, and a user
  counter against the plan's limit.
- **The Customer ID is what a customer quotes to support** — it is the fastest way to find them.
- Billing terms: **quarterly +40%, half-yearly +20%, yearly is the base price.**
- Expiry warnings appear in the header and as a banner **only within 15 days of expiry**.

---

## Account lifecycle — renewal, seats, people leaving, and getting data out

Added 2026-10-27 after the Stage E rehearsal: these are questions customers ask that the
knowledge base could not previously answer.

### What happens when a subscription expires

**The whole web portal is replaced by one card.** Not a warning banner, not a read-only mode —
the app does not render at all:

> **Subscription Expired**
> Your subscription to the CRM has expired. Please renew it or contact support to restore access
> to your workspace.
> *[Sign out]*

An account counts as expired when **either** its status is `expired` / `deactivated`, **or** the
expiry date has simply passed. There is no grace period in the code.

**Nothing is deleted.** Access is blocked; the data is untouched and comes back on renewal. Say
that plainly to a worried customer.

Before that point, **expiry warnings appear in the header and as a banner only within 15 days**
of the date — so a customer with two months left sees nothing, which is intended.

The Sign-out button on that card exists deliberately: without it, a user who also belongs to a
second, perfectly valid account would be locked out of that one too, with no way back except
clearing cookies.

### Changing a plan

Only we can change an account's plan; the tenant's admin cannot. What happens when it changes is
worth knowing before you sell an upgrade or process a downgrade:

- **The module settings are re-clamped to the new plan.** Any module outside it is forced off,
  whatever was previously stored or requested. That is the server-side ceiling that makes a plan
  enforceable.
- **On an upgrade**, the newly owned modules become *allowable*. Four of them — Route, Reporting
  Hierarchy, Scheme and Stock — still have to be switched on by hand, so an upgrade can look
  like nothing happened. Check those four first.
- **On a downgrade, the screens disappear but the data does not.** Orders already taken stay in
  the database; the account simply cannot reach or create them while the line is gone. Upgrading
  again brings them back.
- **The database enforces this too**, not just the app — a plan line is re-checked on every write,
  so a downgraded account cannot create records for a line it no longer owns by any route.

### Seats: the user limit

The limit is a number on the account. It is enforced **on the server**, in two places — adding an
employee, and redeeming an invitation — so it cannot be worked around from the UI.

When it is reached, the customer is told, in these words:

> *"your user/employee limit has reached. Reach us to increase user limit."*

**Only OZZO can raise it.** The tenant's own admin cannot. If no limit is set, there is no
ceiling.

The current count is on the Subscription screen — "You have created 21 out of 25 allowed users".

### When an employee leaves

**Deactivate them; do not remove them.** Setting an employee's status to **inactive** is the
normal path, and it is what the employee list's own action does. Inactive employees disappear
from the list only because it filters to Active by default, they can be set back at any time, and
their records stay exactly where they are.

There is also a harder operation, and its behaviour surprises people:

- The user is **not** deleted from the authentication system — **they keep their login.**
- A fresh, empty personal account is created for them and their profile is moved to it, as its
  owner. They "start over" rather than ceasing to exist.
- It cannot target the account owner, and it cannot target yourself.

⚠️ Because that moves the profile to another account, **deactivation is the right answer for an
employee who has left.** Reserve removal for someone added by mistake.

### Deleting a record, and getting it back

**Records are soft-deleted on the modules that support it.** A deleted row is not gone: it
becomes **Inactive**, and the list hides it only because the Record Status filter defaults to
Active.

To get it back: clear the Record Status filter so Inactive rows show, then use the **Re-activate**
action — a circular-arrow button that appears in the row's Action column in place of Delete. It
is available on ten modules, and several lists also offer it as a bulk action.

**A bad import is reversible too** — every run is recorded and can be undone as a unit.

### Getting data out

| Want | Answer |
| --- | --- |
| One list | **Export CSV** on the list screen |
| One report | **Export** on the report |
| Everything, in one go | **There is no self-service account-wide export.** It is a support request |

Worth knowing precisely, because it is a fair question: **Export CSV exports every row matching
the current search and filters, not just the page on screen.** On the few screens where it could
only ever have exported the loaded page, the button is deliberately hidden rather than shown
misleadingly.

### Passwords

- **An admin sets the password when creating the employee** — it is a field on the Add Employee
  form.
- **Afterwards the user resets it themselves**, through *Forgot password?* on the sign-in screen,
  which emails a reset link.
- The API does support an administrative password change, but there is **no password field on the
  employee edit form**, so the self-service route is the one to point people at.

### How long data is kept

The published policy lives at **ozzo.co.in/privacy#retention**, and the code is the executable
version of it:

| Data | Kept |
| --- | --- |
| **Business data** — orders, payments, customers, attendance | **While the account is active** |
| **Tracking data** — GPS points, tracking events | **365 days**, then reduced to a daily summary |
| **Technical logs** — device health, automation events | **90 days** |
| **Activity records** | **365 days** |

Two safeguards worth quoting to a nervous customer:

1. **The deletion job works from a closed list.** A table is only ever eligible if it is named on
   that list, and a test pins every business table *off* it — deleting from orders or payments
   would corrupt outstanding balances, and attendance is a business record, not a log.
2. **GPS points are only deleted once the day's summary has been written successfully.** A failed
   roll-up stops the delete, so a day's distance cannot be lost.

### Time zone

Dates and day boundaries are computed in **the account's own time zone**, not the browser's —
which is why an evening punch-in stays on the day it happened.

It is stored on the account as an IANA zone (`Asia/Kolkata`), with a fallback if it has never
been set. ⚠️ **There is no screen for a customer to change it** — no settings panel writes this
value, so a customer operating in another time zone needs it set for them.

---

## What this catalogue does not yet cover

| Area | Why |
| --- | --- |
| **FSM / Service** (`/service/*`) | No tenant owns the FSM line, and a legacy plan explicitly excludes it. Nothing has been seen |
| **The Android app** | Nothing mobile has been verified in this project. Five permission keys are enforced only on the phone |
| **Notifications and alarms** | Built, but not walked in this pass |
| **The founder-only `/admin` tools** | 29 routes, deliberately outside a read-only tenant pass |
| **Anything a non-owner sees** | Every screen was checked as the account owner |
