# Workflow guides — how the work actually flows

Step by step, the way a customer runs their business in OZZO. Each workflow says where it starts,
what it needs switched on, what the system does on its own, and where people get stuck.

**Label:** VERIFIED IN CODE, with the screens VERIFIED IN BROWSER on 2026-10-27 where marked.
Behaviour that is enforced in the database is called out, because that is behaviour nobody can
work around.

---

## 1. Lead → Customer → Deal → Quotation → Order

The spine of the product. Needs the CRM line throughout, plus SFA from the order step.

```
Lead ──► Customer ──► Deal ──► Quotation ──► Order ──► Dispatch ──► Payment
```

### Capture a lead
**Needs:** CRM. Lead → Add Lead, or the mobile app, or the public website form.

Business name, contact person, phone and **WhatsApp number** are required. Source and industry
are configurable lists.

### Convert it
A lead converts into a customer, carrying its details and its history. **Marking a lead Lost does
not delete it** — Lost is a status, and the record stays Active.

### Open a deal
**Needs:** CRM. A deal carries line items and sits in a pipeline stage. Stages are configurable,
and each stage's probability drives the **Weighted Value** on the deal list.

A deal can be raised against a **lead or a customer** — you do not have to convert first.

### Quote
**Needs:** CRM + the `quotation` module. A quotation can also go to a lead or a customer.

- Line items are PRODUCT / UNIT / QTY / PRICE / TAX % / TOTAL.
- **Terms and conditions come from a template**, chosen on the form.
- **Revising a quotation creates a new version dated today** and keeps the old one, so you can
  always show the customer what was quoted before.

### Order
**Needs:** SFA. See workflow 2 — ordering is where the money rules bite.

### Where people get stuck

| Symptom | Cause |
| --- | --- |
| "I can't make a quotation" | The `quotation` module is off, or the plan has no CRM line |
| "Pipeline value and weighted value don't match" | They count different deals — see [feature-catalogue.md](feature-catalogue.md) |
| "My lost lead disappeared" | It did not; the list filters to Active by default and Lost is a status |

---

## 2. Taking an order — and why the price is what it is

**Needs:** SFA line. **VERIFIED IN BROWSER.**

### What happens when the order is saved

The **database** prices it, in a fixed sequence that cannot be reconfigured:

> catalogue price → price list → scheme → salesman discount → price floor

1. **Catalogue price** — the product's own price.
2. **Price list** — if the customer has one: a per-product override first, otherwise the blanket
   discount.
3. **Scheme** — any eligible slab scheme, which may add free goods as flagged lines.
4. **Salesman discount** — what the rep gave, if they are allowed to give it.
5. **Price floor** — `min_price` on the product. **Nothing may cross it.**

The sequence is fixed on purpose: a configurable order would have to store the whole configuration
with every order or its price could never be explained afterwards.

### When the rep's figure and the server's disagree

**The quoted price wins.** The server does not overwrite what the salesman promised the customer.
It records its own figure alongside, marks the order **for review**, and leaves it to an admin.

Those orders are listed at **Order Sync Health**, with a pricing drift log. The screen says
plainly that **money is unaffected** — the server figure is what is used.

**Open that screen for any argument about an order total.**

### Discounts and tax, precisely

- A **whole-order discount is spread across the lines pro-rata**, so each line's tax reduces
  correctly. It is not held at the header.
- **Tax inclusive/exclusive is per line.** An edited order keeps its old lines on their original
  basis. A single order can legitimately be mixed.

### The status lifecycle — enforced in the database

```
Pending  →  Approved | Rejected | Cancelled
Approved →  Dispatched (automatically only) | Rejected | Cancelled
Dispatched / Rejected / Cancelled  →  nothing further
```

- **You cannot set "Dispatched" by hand.** Creating a dispatch is the only route, which is why
  the button appears only while the order is Approved.
- **Once anything ships the order locks** and can no longer be edited.
- Every change is logged with who made it.
- A client that writes the status directly is rejected by a trigger — bypassing the app does not
  work.

### Where people get stuck

| Symptom | Answer |
| --- | --- |
| "I can't mark it Dispatched" | Correct — create the dispatch |
| "I can't edit this order" | It has shipped and is locked |
| "The app won't let my rep discount that much" | `min_price`, or discounting over a price list is off |
| "The total on the phone differs from the web" | Order Sync Health. The server figure is used; money is fine |

---

## 3. Dispatch and part delivery

**Needs:** SFA + the `dispatch` module (and `pending_dispatch` for the queue). **VERIFIED IN
BROWSER.**

1. From an **Approved** order, Create Dispatch.
2. The dispatch's lines are that order's items, **capped at the remaining quantity**.
3. **Prices are inherited and read-only** — a dispatch cannot change money.
4. Add invoice number, invoice date, LR number and date, transport contact.

### The order's status now follows the goods, automatically

| Delivered | Order becomes |
| --- | --- |
| Nothing yet | Approved |
| Some lines, or part quantities | **Part Dispatch** |
| Everything | Dispatched |

Recomputed every time a dispatch line changes. **So several dispatches can belong to one order**,
and **Pending Dispatch** is the queue of part-delivered ones, showing Ordered / Delivered /
Difference.

---

## 4. Collecting payment

**Needs:** SFA + the `payment` module. **VERIFIED IN BROWSER.**

1. Payment → New Payment, or from the mobile app in the field.
2. Customer, amount, payment type, date; optionally a reference number and a photo of the receipt
   or cheque.
3. The payment goes in as **Pending** and someone with the approval right approves it.

**Three different things on one row:** Status (approved or not), **Verified** (a separate flag),
and **Source** (where it came from). They are not the same and customers conflate them.

**Outstanding** on the customer page is *Opening + Closed Orders − Paid*, and that formula is
printed on the screen.

### Where people get stuck

- **"Failed to update status"** when approving — the role lacks the approve right. Viewing
  payments and approving them are separate permissions, and the refusal comes from the database.
- **Collecting without checking in** is governed by a mobile rule (`payment_without_checkin`)
  enforced on the phone, not on the web.

---

## 5. A field rep's day

**Needs:** WFA line. Mostly happens on the phone.

```
Punch in ──► (route, if used) ──► Visit check-in ──► Order / Payment ──► Visit check-out ──► Punch out
```

### Punch in
Measured against the configured **shift and grace**, which the attendance screen prints. If
**Attendance Locations** are configured, the punch is fenced to a place — and the phone's GPS
accuracy is added to the radius automatically, up to 100 m.

**Tracking starts at punch-in and does not care about shift times.** Punched in means tracked, at
any hour.

### Visits
A visit targets a **customer or a lead**, and records check-in and check-out **with location at
both ends**, a duration, an image and a feedback type.

**With geo-fencing on, a rep cannot check in unless they are at the customer.**

**A visit is "productive" only if it produced an order.** That is the definition behind
Productivity % everywhere it appears.

### Punch out
⚠️ **If an attendance location fences punch-out, a rep who ends the day elsewhere cannot punch
out.** For field staff, fence Punch In only.

### What the manager sees
- **Live Feed** — who is online, where, battery, distance
- **Tracking Health** — who is tracking properly, with a **Likely issue** column naming the cause
  per agent
- **All Locations** — the raw ping list with tracking gaps

**Check "Not Punched In" first.** An agent who never started a shift is not a tracking fault.

### Offline
The app queues what a rep does with no signal and syncs later. **A record appearing hours late is
normal**, and the timestamps are the real ones, not the sync time.

---

## 6. Beat planning (routes)

**Needs:** SFA + the `route` module, which **ships off** — free-visit mode is the default.

1. Build a route: a named round of customers with a **primary assignee**.
2. It may need **approval** — the Manager Inbox at Routes → Approvals.
3. Assign it to days in the **Monthly Planner**, which also does bulk assignment.
4. **The rep runs it on the phone.** Route Monitor on the web is explicitly read-only.
5. Monitor who started, who is running, who completed, who skipped.

**There is no top-level menu entry, by design** — creation lives under Team → Employees → the
employee → Routes, monitoring under Location Tracking → Route Monitor.

⚠️ **Draft is not the same as pending approval.** Routes can sit in Draft with an Approve button
while the Manager Inbox correctly reads "Inbox Zero". This confuses everyone.

**Routes are archived, never deleted.**

---

## 7. Expenses

**Needs:** WFA + the `expense` module. **VERIFIED IN BROWSER.**

1. The rep submits a claim: type, date, amount, remarks, and a photo or PDF of the receipt.
2. It sits in **Pending**.
3. Someone with the approve right approves or rejects it.

**Approving is a separate permission from viewing**, and it is enforced by the database — a role
without it gets a refusal the UI shows as "Failed to update status".

---

## 8. Leave

**Needs:** base feature — every plan. **VERIFIED IN BROWSER.**

1. Apply: type, from, to, reason. The system computes a **breakdown**, including half days.
2. Statuses: Pending / Approved / Rejected / **Cancelled**.
3. The approver is whoever the account's approval setup names — the reporting hierarchy, if it is
   switched on.

**The working week is per employee**, from their **Holiday List**, which decides weekly offs and
holidays. Leave taken across those days is not counted, and attendance is judged against the same
calendar.

**"It counted a Sunday as leave"** is a holiday-list question, not a leave bug.

---

## 9. Stock

**Needs:** SFA + the `stock` module, which **ships off** and is switched on in **Catalogue
Settings**.

1. Load opening stock through the **importer**.
2. Movements accumulate in the **stock ledger**.
3. **Closing stock is not stored — it is calculated** by summing that ledger. The screen says so.
4. Click a product for its full ledger and activity.

**A wrong closing figure is never a wrong field.** It is a missing or duplicated ledger movement,
and the ledger will show which.

---

## 10. Sending a WhatsApp broadcast

**Needs:** CRM + the `whatsapp` module. **VERIFIED IN BROWSER.**

1. **Create a template** at Settings → Templates and **submit it to Meta**. Lowercase names,
   `{{1}}`-style placeholders, 1024 characters, with a live preview.
2. **Wait for Meta to approve it.** Nothing can be sent before this.
3. New Broadcast → **Template → Audience → Personalize → Send**.

🔴 **The Broadcasts list screen currently crashes for every tenant** (F-016). Creating a broadcast
still works — reach it from the WhatsApp Dashboard's *New Broadcast* button.

### Automations — two different things with one name

- **Business-event automation** — "send a WhatsApp message when something happens in your
  business". Module + Event + Conditions. The only action today is send-WhatsApp.
- **Chat-flow builder** — a canvas, triggered by an incoming message, for menus and FAQs.

Both need an approved template.

---

## 11. Importing data

**Needs:** base engine; each importer follows its module's line. **VERIFIED IN BROWSER.**

**Upload → map columns → preview → confirm.** Nothing is written until confirm, and every run is
recorded in Import history.

Eleven importers; **Orders is the only one that reads "coming soon"**.

**Import in dependency order** — territories, then products, then customers. See
[setup-guides.md](setup-guides.md).

⚠️ Import module keys are **plural** (`/import/contacts`), unlike custom fields, which are
singular. A mistyped singular URL claims the importer is "coming soon" (N-005).

---

## 12. Printing and sharing a document

**Needs:** base.

- Orders, quotations, dispatches, payments and proposals print from their detail screens;
  expenses and leave print as internal vouchers; **every list screen can print the list you are
  looking at**.
- **A4 or A5** — A5 scales the sheet by 1/√2 rather than restyling it.
- What appears on the document comes from a **document template**; the GST line appears only if
  the template includes it.

---

## 13. Adding a field nobody thought of

**Needs:** base; each module's editor follows that module's line. **VERIFIED IN BROWSER.**

1. Custom Fields → the module.
2. Add a section if needed, then a field; drag to order both.
3. Per field: Required, show in Table, Sort, Search, Active.
4. It appears on the form, and in that list's **Manage Column** dialog.

**Predefined fields are locked** — they cannot be deactivated and their Required flag cannot be
changed, because the app depends on them.
