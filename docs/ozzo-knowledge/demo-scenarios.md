# Demo scenarios — the journeys to record

The click paths behind the videos, and behind any live demo. Each one is a continuous journey
with a beginning and an end, written so it can be followed without thinking.

**Status: WRITTEN, NOT YET WALKED.** Every journey below is assembled from verified facts in this
knowledge base, but **none has been performed end to end on a tenant with real data.** Walking
them is the next step, and the first walk will change some of them.

---

## Where to run them

| | |
| --- | --- |
| **Record on** | One of the four demo tenants — they hold data and a daily job keeps "today" populated |
| **Never record on** | Account **001001**. It is the live customer |
| **Do not record on** | Tenant **001288**. It has 696 customers and 25 products but **no transactions at all** — no orders, payments, visits or expenses. Every screen that matters is empty |
| **Sign in as** | The account owner, unless the journey says otherwise |
| **Build** | A production build. Never the dev server |

**Check the demo data on the morning of filming.** The refresh job has to have run; a demo tenant
whose "today" is yesterday films badly.

---

## A note on writing, not just clicking

These journeys **create records**. That is the opposite of every other verification in this
knowledge base, which was strictly read-only.

**So: demo tenants only, and treat each run as disposable.** Decide before filming whether the
tenant is reset afterwards or allowed to accumulate; a tenant that has been demoed on fifty times
looks like a tenant that has been demoed on fifty times.

---

## S1 · Order to cash
**Feeds:** B10, C1, C2, C3 · **Needs:** CRM + SFA, with dispatch and payment on · **~6 min**

The spine of the product, in one unbroken run.

1. **Customers** → open a customer with a credit limit. Show Outstanding, Available Credit and
   the Payment Status line.
2. **Add Order** from that customer. Add two products — one on a price list, one not.
3. Watch the price resolve: catalogue → price list → discount. **Say the sequence out loud as it
   happens.**
4. Try a discount that breaks the floor, and let it be refused. *This is the single most
   convincing moment in the whole demo.*
5. Save. The order is **Pending**.
6. Approve it. Point out that Dispatched is not in the list — only a dispatch gets you there.
7. **Create Dispatch** for part of the quantity. Add the invoice number and date.
8. Back on the order: the status has become **Part Dispatch** on its own.
9. **Pending Dispatch** shows the shortfall as Ordered / Delivered / Difference.
10. Dispatch the remainder → the order becomes **Dispatched** and **locks**.
11. **Record a payment** against the customer. Leave it Pending, then approve it.
12. Back to the customer: Outstanding has moved.

**Say while filming:** the order locked because it shipped; the payment settled the oldest
balance first, which is why it may not be the invoice you were looking at.

---

## S2 · Lead to quotation
**Feeds:** A2, B11, C8 · **Needs:** CRM + quotation module · **~4 min**

1. **Leads** → Add Lead. Business name, contact person, phone, WhatsApp number.
2. Open it, add a note, show the owner and collaborators.
3. **Convert to customer** — the history comes with it.
4. **Add Deal** against the customer. Add line items; show the stage.
5. **Create Quotation** from the deal. Add products, pick a terms template.
6. Print it at A4, then **A5**, to show the scale option.
7. **Revise it** — a new version, dated today, with the old one kept.

**Say while filming:** a deal can be raised against a lead too — conversion is not required
first. Pipeline Value and Weighted Value count different deals.

---

## S3 · A rep's day on the phone
**Feeds:** A8, C7 · **Needs:** WFA + a device · **~4 min** · **Filmed on the phone**

1. **Punch in.** Show the shift and grace line.
2. Today's customers.
3. **Check in** at a customer. Show the location being captured.
4. Take an order, or collect a payment, from inside the visit.
5. **Check out.** Feedback type, a photo.
6. **Punch out.**
7. Cut to the web: **Live Feed** showing where the rep was, then **Tracking Health**.

**Film the geo-fence refusal too**, if the tenant has fencing on — a check-in refused away from
the customer proves the feature better than a successful one.

⚠️ **Nothing mobile has been verified in this project.** Walk this one on a real device before
scripting it in detail; it is the journey most likely to differ from what is written here.

---

## S4 · Who can see what
**Feeds:** C13, B3 · **Needs:** two logins on the same tenant · **~5 min**
**The highest-value journey in this file.**

1. On the web as the **owner**: show a module the account owns.
2. **Team → Employee Roles.** Open a role, show the permission groups and the **Login Access**
   section.
3. Take a right away. Save.
4. Sign in as **that user**: the menu row is gone.
5. Now take **web access** away from the role.
6. Sign in again: the **"Web access disabled"** card — *"Please use the mobile app, or ask your
   administrator to enable Web Portal Access for your role."*
7. Back as the owner: **Settings → Organization Settings**, switch a module off. The screen
   disappears for **everyone**.
8. Finally, **Subscription**: a plan line nobody can switch on.

**Say while filming, in this order:** which app → the plan → the module → the role. First no
wins, and nothing on screen tells you which one it was.

**Needs preparing:** a second login whose rights can be broken and restored without consequence.

---

## S5 · Setting up from nothing
**Feeds:** B1, B2, B4, B5, B9 · **Needs:** a freshly created demo account · **~10 min**

Follow Getting Started in its own order: territories → assignment mode → roles → employees →
mobile app → activity → lead → deal → quotation → products → pricing → order → live data.

Then, separately, **switch on what ships off**: Route and Reporting Hierarchy in Organization
Settings; **Stock and Scheme in Catalogue Settings**.

⚠️ **Do not film the health tiles until F-007 is fixed** — six of them currently print raw
database names.

**Needs preparing:** a genuinely empty account. An account that has already been set up cannot
show setup.

---

## S6 · Expenses and leave
**Feeds:** C4, C5 · **Needs:** WFA + expense module, two logins · **~3 min**

1. As the **rep**: submit an expense with a receipt photo.
2. As the **approver**: approve it, and show that approving is its own right.
3. Apply for leave across a weekend.
4. Show the **breakdown** — and that the holiday list decided which days counted.

---

## S7 · Beat planning
**Feeds:** C6 · **Needs:** SFA + route module ON · **~4 min**

1. **Team → Employees → an employee → Routes.** Build a route; add customers; set the assignee.
2. **Routes → Approvals** — the Manager Inbox.
3. **Monthly Planner**: assign the route to days; show bulk assign.
4. **Route Monitor**: read-only, because routes run on the phone.

**Say while filming:** Draft is not the same as pending approval — a route can sit in Draft while
the Manager Inbox correctly reads Inbox Zero.

**Needs preparing:** the route module switched on — it ships **off**.

---

## S8 · Reports that answer a question
**Feeds:** B11, C10, C14 · **Needs:** a tenant with months of data · **~4 min**

1. Open a report. **Point at the period first** — the commonest reason a report looks empty.
2. Filter, change a dimension, read the measures.
3. **Set Default View**, reload, show it stuck.
4. Export. Print at A4.
5. Side by side: **Order report and Sales report for the same month, showing different numbers** —
   because sales means dispatched.

---

## S9 · Import, and undo
**Feeds:** B7, C9 · **Needs:** a prepared spreadsheet · **~4 min**

1. **Import → Customers.** Upload the file.
2. Map the columns; show an unmapped one.
3. **Preview** — and say clearly that nothing has been written yet.
4. Confirm. Show the records arriving, with territories resolved.
5. **Import history**, and **undo the run**.
6. Show the records gone again.

**Needs preparing:** a spreadsheet with a deliberate problem in it — a duplicate phone number — so
the duplicate rule can be shown refusing a row.

---

## S10 · Recovering a mistake
**Feeds:** C17 · **Needs:** any tenant · **~90 s**

1. Delete a record. It disappears.
2. Clear the **Record Status** filter → it is there, **Inactive**.
3. **Re-activate** it.
4. Mention the bulk version.

**Short, and worth making early.** It turns a frightening moment into a two-click fix.

---

## What each journey still needs

| Journey | Blocked on |
| --- | --- |
| S1 Order to cash | A demo tenant with price lists and a product with a floor |
| S2 Lead to quotation | A terms template configured |
| S3 Rep's day | **A real device, and a first walk — nothing mobile is verified** |
| S4 Who can see what | A second, disposable login |
| S5 Setting up | An empty account, **and F-007 fixed** |
| S6 Expenses and leave | Two logins, one an approver |
| S7 Beat planning | The route module switched on |
| S8 Reports | A tenant with several months of history |
| S9 Import | A prepared spreadsheet, including a deliberate duplicate |
| S10 Recovering | Nothing — this one can be walked today |

---

## The first walk

**Start with S10 and S4.** S10 because it needs nothing and proves the format; S4 because it
feeds the highest-value film in the dictionary and will expose whatever is wrong in these
scripts.

Record what changes. A journey that has been walked should say so here, with the date — the same
discipline as the rest of this knowledge base, where an unwalked claim is never written as a
verified one.
