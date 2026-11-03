# UI inventory — screen by screen

What each screen is, how it is reached, what it shows, and what has actually been confirmed.

| | |
| --- | --- |
| Screens opened and recorded | **91** of 171 routes — 83 working, 8 broken (63 of them opened on 2026-10-27) |
| Not opened, with a stated reason | 76 blocked, 4 outstanding (see [test-matrix.md](test-matrix.md)) |
| Screens found broken | **8** — listed in [known-issues.md](known-issues.md) |
| Verification tenants | **001288** "Play Console" (plan CRM + SFA), signed in as the account owner. Some older entries below are from **001001**, the live account, and say so |
| Verification dates | 2026-10-23 (first pass, dev server) and **2026-10-27** (full sweep, production build) |
| Method | Read-only. Pages opened and read as text; no form submitted, nothing created, changed or deleted |

**Every claim here carries a date.** Anything marked 2026-10-23 was written before the design
system (`b82796d` → `d820882`) and the header-slot change (`130a9d3`) landed on 26 October, so
its *behaviour* still holds but its *layout* wording may not. Entries dated 2026-10-27 are
current.

The per-route status table is [test-matrix.md](test-matrix.md); the complete route and menu list
is [navigation-map.md](navigation-map.md). This file is the prose catalogue.

## What this tenant's configuration means

Read from the database on 2026-10-23 (read-only):

| Setting | Value on 001288 | Consequence |
| --- | --- | --- |
| Plan | `CRM_SFA` | Lines **crm ✓ wfa ✓ sfa ✓ fsm ✗** (SFA includes WFA) |
| Modules ON | `whatsapp`, `quotation`, `dispatch`, `pending_dispatch`, `payment`, `expense`, `territory` | Those screens are reachable |
| Modules OFF | `route`, `stock`, `scheme`, `service`, `reporting_hierarchy` | Route Management, Stock, Schemes and Service screens are blocked by the route guard |
| `assignment_mode` | `direct` | The Settings → Territory Master link is hidden (it needs `area`) |
| `geo_fencing.attendance_enabled` | `false` | The Attendance Locations link is hidden |
| Users | 21 of 25 (1 owner, 20 agents) | Only the owner has web access; the 20 agents are mobile users |
| Data | 696 customers, 25 products in 5 categories, 5 units, 799 territories, 2 roles, 2 tasks | **No leads, deals, quotations, orders, payments, expenses, dispatches, visits or leave records** |

Two consequences for anyone reading this file:

1. **FSM (`/service/*`), Stock, Schemes and Route Management cannot be verified here.** They are
   correctly off, and need a tenant whose plan and toggles include them.
2. **Every transactional screen on this tenant is empty.** That is why so many entries below
   quote an empty state rather than real rows, and why F-008 could only be caught on the one
   report that had data.

---

## What every list screen gives you (shared behaviour)

**Label:** VERIFIED IN BROWSER across twenty-plus lists, 2026-10-27 · Source:
`src/components/ui/data-table/`

All 26 list screens are built on one `DataTable`, so these behaviours are the same everywhere and
are not repeated per screen below.

| Feature | How it appears |
| --- | --- |
| **Filter row** | A row of filter inputs directly under the column headings. Each column declares its own type: free **text**, a **select**, a **date**, or a numeric/money **range** |
| **Manage Column** | A MANAGE COLUMN button opening a dialog to show/hide columns; custom fields appear here too |
| **Saved views** | An "All records" view selector that remembers a filter set per user, so filters survive navigation |
| **Paging** | Rows-per-page 10 / 20 / 50 / 100, a total count, and Prev/Next. Server-side, so big accounts page at the database |
| **Row actions** | A pinned Action column, outside the horizontal scroll |
| **Record Status** | Soft-deleted rows are kept and shown as Active / Inactive rather than disappearing |
| **Total count** | A "Total: N records" line above the grid |
| **Empty state** | "No data found." — each screen may supply its own wording |

**Support consequence:** "the column is missing" is almost always Manage Column, and "my filter
came back" is the saved view, not a bug.

**One list breaks the pattern:** `/location-tracking/visits` prints no heading and no empty-state
line, so an empty list looks like a failed one (F-010).

---

## What every engine report gives you (shared behaviour)

**Label:** VERIFIED IN BROWSER on all twelve reports, 2026-10-27

| Control | What it does |
| --- | --- |
| **Filters** | Opens the filter panel. Chosen filters show as **Active Filters** chips with **Clear All** |
| **Period** | Every report opens on a default period — and they differ, see the table below |
| **Set Default View** | Saves the current filter set as that user's default for this report |
| **Export** | Downloads the current result |
| **Print** | Print / PDF view |

**The empty state is genuinely helpful and worth quoting to customers:** "No records found.
Period: 2026-10-01 to 2026-10-31. **Try a wider period — there may be records outside these
dates.**" Most "the report is empty" questions are this.

### The twelve reports

All read 0 on tenant 001288 except Task Reports. Measures and filters are as observed on
2026-10-27.

| Report | Measures | Filters | Default period |
| --- | --- | --- | --- |
| **Lead** `/reports/leads` | # lead, # converted lead, # ratio % | Lead Source, Lead Status, Industry, User, Area, Period | This Month |
| **Deal** `/reports/deals` | Amount, Sub Amount, # deal | Lead, Customer, User, Area, Period, Deal Pipeline, Deal Pipeline Stage, Product, Product Category | This Month |
| **Quotation** `/reports/quotations` | Amount, Sub Amount, # of quotation | Lead, Customer, User, Area, Period, Product, Product Category | This Month |
| **Order** `/reports/orders` | Amount, Sub Amount, # of order | Customer, User, Area, Period, Product, Product Category | This Month |
| **Sales** `/reports/sales` | Sales Amount, Sub Amount, # of order | same as Order | This Month |
| **Payment** `/reports/payments` | Approved, Pending, Total | Customer, User, Area, Period, Status | This Month |
| **Expense** `/reports/expenses` | Total, Approved, Pending, Approved % | User, Expense Type, Allowance Type, Period, Status, Approved By | This Month |
| **Task** `/reports/tasks` | # task, # done, # overdue, Done % | Customer, Lead, Activity Type, Status, Area, Period, User | This Month |
| **Visit** `/reports/visits` | # visit, # productive visit, Productivity %, # unique customer | Customer, Lead, Area, Period, User | This Month |
| **Ageing** `/reports/ageing` | # customer, # never ordered | Customer, Area, Product, Product Category | *no Period chip* |
| **Product Summary** `/reports/summary/products` | Amount, Quantity, # of order | — plus tabs | **Today** |
| **Customer Outstanding** `/reports/summary/outstanding` | Order Amount, Outstanding, # of order | — plus tabs | **Last 365 Days** |

**Two things to know before quoting a report to a customer:**

- **Payment Reports has tabs** — Payment Reports / Collections / Customer Financials. Product
  Summary has Customer wise / Product wise / Product total; Customer Outstanding has Order wise /
  Customer wise / Area wise / User wise.
- **The default period is not the same on every report.** Product Summary opens on *Today* and
  Customer Outstanding on *Last 365 days*, while the other ten open on *This Month*. "My report
  is empty" is usually this.

**Two defects live here:** Task Reports' tiles count records the table refuses to show (F-008),
and the Ageing report's two tiles print no number at all (F-009).

---

## Sign-in and the way in

### `/login` — Sign in
**Gate:** none (public) · **VERIFIED IN BROWSER 2026-10-27**

Email, Password with a Show-password toggle, a "Forgot password?" link, and Sign in. On success
it lands on `/dashboard`.

### `/forgot-password`
**VERIFIED IN BROWSER 2026-10-27** — while signed in it redirects to `/follow-ups`. The
signed-out form itself still needs a pass.

### `/` — the app's own landing page
**VERIFIED IN BROWSER 2026-10-27** — "OZZO | CRM, Workforce & Field Sales in one platform", with
*Start your trial* and *See plans & pricing*. Served by this app at its root, separate from the
marketing site at ozzo.co.in. Signed-in users are not sent here.

### What the app treats as "home"
The sidebar logo links **`/follow-ups`**, not `/dashboard`. That is where a signed-in user lands
when a route bounces them.

---

## Dashboard

### `/dashboard` — Dashboard
**Gate:** none — base on every plan · **VERIFIED IN BROWSER 2026-10-27**

The post-login landing page, composed of one section per product line the plan owns. On CRM + SFA
all three render:

| Section | Tiles | Charts |
| --- | --- | --- |
| **CRM** | New Leads Today, Converted Customers, New Pipelines Today, Open Deals Value | New Customer Acquisition, Leads by Status, Leads by Source, Lead Journey, Deal Journey, Top 5 Users by Leads Assigned |
| **Workforce** | Active Field Agents, Visits Logged Today, Distance Tracked, Average Battery, Expenses Awaiting Approval, Leave Requests Pending | Live Agent Positions map, Customer Visits, New Customers, Productive vs Total Visits, Top 5 Field Agents |
| **Sales** | Orders Today, Sales This Month, Pending Dispatch, Today's Collection, Monthly Collection, Total Outstanding | Collection by Type, Collection by User, Order Value, Sales Value, Order vs Sales, Payment Collection, Orders by Status, Top 5 Salespeople, Top 5 Products, Top 5 Customers |

Also: section tabs (CRM / Workforce / Sales), a period switch on each analytics block (Daily /
Monthly / Quarterly / Yearly, opening on THIS MONTH), quick actions "New Customer" and "New
Deal", and a Recent Activity feed with a page-size control and "View all →".

Empty-state wording worth quoting: "No Active Agents — Agent positions appear here when field
staff punch in and start tracking."

**On a cold load the header reads "Company" and "User" for a moment** before the profile lands.
That is the remaining half of F-005; the Access Denied half was fixed on 2026-10-27.

### `/follow-ups` — My Activity
**VERIFIED IN BROWSER** — a filter bar over activities: SEARCH, USERS, TYPE, PERIOD, **STATUS
(defaults to `Undone`, not All)**, PRIORITY, Apply. Action: Schedule Activity.

**Support note:** the Status filter opens on *Undone*. "My completed activity is missing" is this
default, not lost data.

---

## CRM

### `/contacts` — Customers
**VERIFIED IN BROWSER** — 696 records. Columns: Company Name, Contact Person, Assigned Employee,
Status, Phone, Email, Latitude/Longitude, **Geo Map** (a MAP link per row), Created at,
Territory. Actions: Import, Add Customer.

### `/contacts/[id]` — Customer detail
**VERIFIED IN BROWSER 2026-10-27** — the screen most support calls land on.

- **Header:** company, contact person, phone, **Message** and **Edit**
- **Financial Summary:** Outstanding Balance · Available Credit against the limit · Payment
  Status with the credit terms ("Within Credit Terms · Terms: 15 days") · Total Closed Orders
  with Paid · Opening Balance, with the formula spelled out: *Opening + Closed Orders − Paid*
- **Customer Details** and **Address & Location**, including geo-tagged coordinates
- **Deals** and a **Timeline**

⚠️ **Carries F-014:** an "Other Details" block repeats thirteen of the same fields underneath,
every one showing `—`, while the real values sit filled in above. A customer reading that
concludes their data was lost.

### `/leads` — Leads
**VERIFIED IN BROWSER 2026-10-23 (001288)** — 0 records. Columns: Name, Lead Status, Lead Owner,
Lead Collaborator, Created at, Source, Contact no, Industry, Record Status, Lat/Long, Geo Map.
Actions: Import Leads, Add Lead.

### `/deals` and `/pipelines` — Deal Pipelines
**VERIFIED IN BROWSER 2026-10-27** — **the same screen at two URLs** (N-004). The sidebar links
`/pipelines`; `/deals` is the one people type.

Tiles: Total Deals, Pipeline Value, Avg Deal Size, Weighted Value, Won This Month, Lost This
Month. Columns: Deal #, Deal Title, Value, Stage, Customer, Contact No, Deal Owner, Deal
Collaborator, Created at, Record Status. Actions: Add Deal, Import.

### `/tasks` — Tasks
**Menu: none — no sidebar entry exists (F-002)** · **VERIFIED IN BROWSER**

A complete, working module with no way in from the menu. Reached by typing the URL or following a
task notification. Columns: Title, Status, Priority, Assigned To, Scheduled Date, Linked To,
Record Status. A "Hide Completed" toggle. Actions: Import, New Task.

### `/tasks/[id]` — Task detail
**VERIFIED IN BROWSER 2026-10-27** — status chips (Pending, Overdue, Medium Priority), the
scheduled date and time, the assignee's name, Edit Task, Description, **Checklist**,
**Attachments**, and **Comments & Activity** with a Post Comment box.

The assignee resolves to a name here — the raw-id problem (F-012) is confined to the create form.

### `/announcements` — Announcements
**VERIFIED IN BROWSER 2026-10-27** — 0 records on 001288, 2 on 001001. Columns: Title (with a
body preview), Target Audience, Link, Created On, Expiry Date, Status. Action: Create
Announcement.

**Support note:** Expiry and Status are different things. A row can read **Status = Active** and
**Expiry = Expired** at once — Active means "not deleted", not "currently showing".

---

## Catalogue

### `/products` — Products
**VERIFIED IN BROWSER 2026-10-27** — 25 records. Columns: Product (image thumb, name and
description), Category, Product Code, Price (shown per unit, e.g. "₹10/ Pcs"), Status. Action:
New Product.

### `/products/[id]` — Product detail
**VERIFIED IN BROWSER 2026-10-27** — header (name, Active badge, SKU, **Add Task**, Edit),
Product Details (Name, Product Code, Price, Status, Description), Other Details (Category, Unit),
and a Timeline split into PLANNED and PAST activity.

### `/catalog/categories` — Product Categories
**VERIFIED IN BROWSER 2026-10-27** — 5 records. Columns: Category Name, Level, Parent, Created
at, Status. **Carries its own setting above the table:** Number of Levels (1 / 2 / 3) with a
Level 1 Name and Save settings. Create is an **in-page dialog** (New Category) — there is no
`/new` route.

### `/catalog/units` — Units
**VERIFIED IN BROWSER 2026-10-27** — 5 records (Box, Case, Kilograms/Kg, Litre/Ltr, Pieces/Pcs).
Columns: Unit Name, Short Name, Created at, Status. Create is an in-page dialog.

### `/price-lists`, `/stock`
**VERIFIED IN BROWSER 2026-10-23 on account 001001** — Price List columns: Name, Blanket
discount, Product overrides, Customers, Status. Stock columns: Product, SKU, Opening, In, Out,
Closing, with a Low/out filter and an out-of-stock chip. Both modules are **off** on 001288.

---

## Sales

| Screen | Columns | Actions | Confirmed |
| --- | --- | --- | --- |
| **Quotation** `/quotations` | Quotation Number, Date, Quotation For, Amount, Status, Created By, Record Status | New Quotation | 2026-10-23 |
| **Order** `/orders` | Order #, Customer, Date, Items, Total, Status | Sync Health, Create Order | 2026-10-23 |
| **Dispatch** `/dispatches` | Dispatch #, Order #, Customer, Date, Items, Sub Amount, Order of | Create Dispatch | 2026-10-23 (001001) |
| **Pending Dispatch** `/pending-dispatch` | Order #, Customer, Date, Status, Ordered, Delivered, Difference | inline Dispatch per row | 2026-10-23 (001001) |
| **Payment** `/payments` | Payment #, Customer, Date, Type, Amount, Verified, Source, Status | New Payment | 2026-10-23 |
| **Expense** `/expenses` | Date, Employee, Type, Amount, Status, Proof, Record Status | New Expense | 2026-10-23 |

Order statuses seen live on 001001: **Pending, Approved, Part Dispatch, Cancelled**. Several
dispatches can belong to one order (part dispatch). The Expense list has status tabs: All /
Pending / Approved / Rejected.

### `/orders/sync-health` — Order Sync Health
**VERIFIED IN BROWSER 2026-10-27** · read-only. Two panels:

- **Orders needing review** — orders the system flagged. Empty state: "No orders are flagged for
  review. 🎉"
- **Pricing drift log** — "where an online client's total disagreed with the server on identical
  inputs — a signal the app's pricing mirror may have drifted from the database. **Money is
  unaffected (the server figure is used).**"

**This is the screen for any argument about an order total.**

---

## Field force and location tracking

### `/location-tracking/dashboard` — Live Feed
**VERIFIED IN BROWSER 2026-10-27** — a left rail listing all 21 field staff with an
Offline/online state, and a Leaflet map with **Map / Satellite** and **Tracked / Visits / First &
last** layer switches. Selecting a person shows battery %, KM travelled and a visit count.
Everyone Offline and 0 km on this tenant — nobody has punched in.

### `/location-tracking/health` — Tracking Health
**VERIFIED IN BROWSER 2026-10-27** — the support screen for "the app isn't tracking me". It
explains itself on the page: *"Expected" is how many locations the app should have recorded (time
on duty ÷ the configured interval); "Regular" is how many it actually did.* Manage Columns
reveals GPS off, switched off, critical, mock and accuracy detail. Filters: AGENT, FROM DATE, TO
DATE (default Today). Tiles include **Needs Attention**.

**The "Likely issue" column is the answer to most field-tracking support calls.**

### `/location-tracking/health/[userId]` — one agent, one day
**VERIFIED IN BROWSER 2026-10-27** — per-agent diagnostics. For an agent who never punched in it
answers the commonest complaint directly: *"No shift on this day — this agent didn't punch in, so
no location was expected."*

Minor: the page heading reads the literal word "Agent" rather than the employee's name.

### `/location-tracking/all-locations` — All Locations
**VERIFIED IN BROWSER 2026-10-27** — columns: View Map, User, User role, Date, Distance (km),
Duration, Battery level, Type, Latitude/Longitude, **Tracking gap**. Filter by date.

### `/location-tracking/visits` — Visits
**VERIFIED IN BROWSER 2026-10-27** — columns: Name, Contact Person, Check In, Check Out,
Duration, Image, Feedback Type, Feedback, Visited By, Check-in location, Check-out location.

⚠️ **Carries F-010:** no page heading and no empty-state line, so an empty list is
indistinguishable from a failed one.

### `/location-tracking/leaves` — Leave
**VERIFIED IN BROWSER 2026-10-27** — status tabs All / Pending / Approved / Rejected /
Cancelled. Action: Apply Leave. Columns: Leave No., Employee, Type, From, To, Days, Breakdown,
Reason, Status, Applied On.

### `/location-tracking/attendance` — User Attendance
**VERIFIED IN BROWSER 2026-10-23 (001001)** — header states the configured shift and grace:
*"Measured against the configured shift 10:00 AM – 7:00 PM with 15 min grace."* Four tabs: Punch
in / Users / Days / Monthly. Each row carries IN / OUT buttons.

### `/field-staff` — Field Staff
**No menu entry (F-004)** · **VERIFIED IN BROWSER 2026-10-23** — Active Sessions and Live Map,
both empty. Overlaps Location Tracking → Live Feed. Whether it is superseded is Q-003.

### `/location-tracking/track-report` — redirect
**VERIFIED IN BROWSER 2026-10-27** — redirects to `/location-tracking/health`. Track Report was
merged into Tracking Health. (Closes Q-004.)

---

## Route Management

Route Management has **no top-level menu entry** by design. Creation and approval live under Team
→ Employees → an employee → Routes tab; monitoring lives under Location Tracking → Route Monitor.
All four screens were verified on account **001001** on 2026-10-23; the module is off on 001288.

- **`/routes`** — tabs Active + Draft / Pending approval / Archived / All. Columns: Name, Primary
  Assignee, Status, Customers, Updated. Draft rows carry an inline Approve.
- **`/routes/planner`** — Month / Week / Today, a salesman picker and a status filter. Each day
  shows a route and rep count, route chips with their assignee, a "+ N more routes…" overflow.
  Actions: Bulk Assign, Create Assignment.
- **`/routes/approvals`** — Manager Inbox. Tabs Pending Approval / Approved / Rejected / All.
  Empty state: "Inbox Zero — All pending route approvals have been processed. Great job!"
- **`/routes/executions`** — Route Monitor. "Live field visibility — who started, who's running,
  who completed, who skipped. **Read-only; routes are run on the mobile app.**"

**Note:** a route in **Draft** is not the same as **pending approval**. On 001001, 11 routes
existed, three of them Draft with an Approve button, while the Manager Inbox correctly read Inbox
Zero.

---

## WhatsApp suite

**Upgraded from code-only to VERIFIED IN BROWSER on 2026-10-27.** The 2026-10-24 attempt failed
because the browser pane was hidden, which makes navigation hang — not because the screens were
unreachable.

All of these need the **CRM line** *and* the **`whatsapp` module toggle**.

### `/whatsapp/dashboard` — WhatsApp Dashboard
"Live analytics across conversations, broadcasts, and automations." Tiles: Active Conversations,
Messages Sent Today, each with a vs-yesterday line. Actions: New Broadcast, New Automation.
Charts: **Conversations Over Time** (daily volume by direction, 7 / 30 / 90 days, Incoming vs
Outgoing) and **Average First Response Time** (minutes to reply to a customer's first unreplied
message, by weekday, target 5m).

### `/inbox` — Shared inbox
With the integration unconfigured it renders a banner — *"WhatsApp® is not connected. Go to
Settings to connect your account."* — above an **All** filter and "No conversations found".

**It holds an open realtime connection, so the page never reports itself as finished loading.**
Read it as text; do not wait for a load event. That is expected, not a fault.

### `/broadcasts` — Broadcasts
🔴 **BROKEN — see F-016.** The page crashes on every load with React error #310 and shows "This
page couldn't load". Not tenant-specific. The cause is a `useMemo` sitting below two early
returns in `broadcasts/page.tsx`.

### `/broadcasts/new` — New Broadcast
**Works.** A four-step wizard: **1 Template → 2 Audience → 3 Personalize → 4 Send**. Step 1 is a
hard stop without an approved template: "No templates available. Create a template in Settings
first."

### `/automations` — Automations
"React automatically to WhatsApp® messages and to what happens in your business." Four
**quick-start templates**: Welcome Message, Out of Office, Lead Qualifier, Follow-up Reminder,
each with a one-line description. Empty state: "No automations yet — pick a template above or
create one from scratch."

### `/automations/module/new` — business-event automation
Not the same thing as the chat-flow builder. "Send a WhatsApp message automatically when
something happens in your business." Fields: Name, Module, Event (reads "Select a module first"
until a module is chosen), Action — **`send_whatsapp` only**, with the honest note that *SMS,
create activity and update field come later* — WhatsApp template, Send to, and a **Condition(s)**
rule builder (Field / Operator / Value / Relation with next rule).

Without an approved template it says: *"WhatsApp needs a Meta-approved template before an
automation can send. Create one in Settings → Templates."*

### `/automations/new` — chat-flow builder
A dark full-bleed **canvas** with one starting node, "New Message Received", and a top bar with
an Active toggle and Save Draft. **Judge this screen by screenshot only** — the nodes are drawn
on a canvas, so reading the page as text shows almost nothing.

### `/flows` — Flows (BETA)
"Build branching, button-driven WhatsApp conversations. Useful for menus, FAQs, and triage before
a human steps in." Empty state explains the idea well: *"Build your first conversation — a
welcome menu, an order lookup, an FAQ bot. Customers tap buttons; the bot routes them to the
right answer (or the right agent)."*

---

## Setup and administration

### `/settings` — Organization Settings
**VERIFIED IN BROWSER 2026-10-27** — "Which modules your organization uses, and how the shared
behaviour of orders, customers and the field app is configured." Discard / Save changes.

| Block | Contents |
| --- | --- |
| **Modules** | Enable WhatsApp Integration · Sale Quotation · Expense Tracking · Payment Collection · Dispatch · Pending Dispatch · Territory Master · Reporting Hierarchy · Can set routes for User |
| **Extra settings** | Enable GST · Enable HSN Code · Enable Multi Unit |
| **Prevent duplicate records** | Per-field unique ticks for Customer (Name, Customer Code, Contact Number) and Lead (Name, Email, Contact Number). **Contact Number is always on** — two customers in the same account can never share a phone number. Product keeps a single choice (Name or Product Code) |
| **Enable customer hierarchy** | Off: every order is a simple direct order. On: orders are classified primary/secondary from the customer's level |
| **Enable Geo-Fencing** | Controls whether a rep can start a visit away from the customer |

Every toggle carries plain-English help. The Multi Unit one is the model: *"Off: each product has
one unit. On: add conversion units (e.g. 1 BOX = 12 PCS); reps order in any unit while price and
stock stay in the base unit."*

The duplicate block carries a warning worth repeating to a customer before they switch it on:
*"Leads had no duplicate checking at all before now… Turning one on starts rejecting saves that
used to be allowed."*

### Settings sub-routes
| Route | What happens | Confirmed |
| --- | --- | --- |
| `/settings/templates` | Redirects to `/settings?tab=templates` → the WhatsApp Templates panel. Sync from Meta, New Template, "No templates yet" | 2026-10-27 ✓ |
| `/settings/document-templates` | 🔴 Redirects to `/settings?tab=document`, which renders the **Overview** panel, not Document Templates — **F-011** | 2026-10-27 |
| `/settings/templates/new` | Create WhatsApp Template (see below) | 2026-10-27 ✓ |
| `/settings/attendance-locations/new` | Add Attendance Location (see below) | 2026-10-27 ✓ |

### `/settings/templates/new` — Create WhatsApp Template
"Design a rich WhatsApp message template to submit for Meta verification." General Metadata
(Template Name — *lowercase, numbers and underscores only*; Category, default Marketing;
Language, default `en`), Message Components (optional Header, Body with a **0 / 1024** counter
and the hint to use `{{1}}`, `{{2}}` for dynamic customer variables, optional Footer), and a
**LIVE WHATSAPP PREVIEW** beside the form.

### `/settings/attendance-locations/new` — Add Attendance Location
"Where your team is allowed to punch in and out." Location Details (Name, Address, Status),
**Position & Radius** on a Leaflet map — click the map or drag the pin, Latitude and Longitude
required, allowed radius 50 m / 100 m / 250 m / 500 m / 1 km — and **Fencing** (Punch In only /
Punch Out only / Punch In and Punch Out).

Two pieces of on-screen guidance worth repeating to customers:

- *"The phone's GPS accuracy is added to the radius automatically (up to 100 m), so honest reps
  aren't wrongly blocked."*
- Fencing punch-out traps a rep who ends the day elsewhere — **choose "Punch In only" for field
  staff who finish in the field.**

### `/company-profile` — Company Profile
**VERIFIED IN BROWSER 2026-10-27** — a form, not a list. Logo upload (PNG/JPG/WebP/GIF, up to
2 MB), **Profile Info** (Name, Website, Registered Email, Registered Contact No, Contact Person
Name, GST Number) and **Address Info** (Address, Pincode, State, …). The State dropdown carries
the **GST state codes** — 01 Jammu and Kashmir through 37 Andhra Pradesh.

GST Number help: *"Printed on orders, quotations, dispatches and receipts when the template
includes the GST line."*

### `/getting-started` and `/getting-started/welcome` — Implementation Center
**VERIFIED IN BROWSER 2026-10-27** — the onboarding wizard. **13 steps**, each with a time
estimate, and a header carrying Score, Health, time remaining and a **Re-check** button, plus
*Skip to dashboard →*.

On 001288: Score 0%, Health 41%, ~47 min left, with tiles reading 799 territories, 2 roles, 21
employees, 25 products.

🔴 **Carries F-007, reproduced in the browser on a production build on 2026-10-27:** six health
tiles print the raw database key — `lead_count`, `deal_count`, `quotation_count`,
`product_count`, `price_list_count`, `order_count` — while Territories, Roles and Employees are
labelled properly. This is the first screen a new customer sees.

### `/import` and `/import/[module]` — Universal Import
**Hub VERIFIED IN BROWSER 2026-10-23 (001001); a module page 2026-10-27 (001288)** — the hub explains the flow once: *"each opens the same guided
flow: upload, map columns, preview, confirm."* A module page (e.g. `/import/contacts`) gives
**All imports**, the module heading, **Start import** and **Import history**.

⚠️ **The key is plural** — `contacts`, `products`, `product_categories`, `product_units`,
`leads`, `territories`, `tasks`, `price_lists`, `outstanding`, `stock`, `customer_assets` —
while custom fields use the **singular** (`/custom-fields/contact`). A mistyped singular URL does
not 404; it says *"This module import is coming soon"*, which reads like a missing feature
(N-005).

### `/custom-fields` and `/custom-fields/[module]` — Custom Fields
**VERIFIED IN BROWSER 2026-10-27** — `/custom-fields` redirects correctly to
`/custom-fields/contact`. (The blank page recorded on 2026-10-23 was the dev server — Q-007,
closed.)

Two columns: **Section** (drag to set priority, ADD SECTION) and **Fields** (drag to set
priority, ADD FIELD). Each field row shows its database id in brackets, its label, a
**Predefined** badge where it is a system field, and the Req / Table / Sort / Search / Active
switches. SAVE PRIORITY sits in the header.

**Predefined fields are locked** — a system field cannot be deactivated or have Required changed.

### `/team` → `/team/roles` — Employee Roles
**VERIFIED IN BROWSER 2026-10-27** — `/team` redirects to `/team/roles` (Q-005, closed).

Columns: Role Name, Description, Permissions, Created at. Action: New Role. On 001288: **Admin**
(ADMIN badge, "Full administrative access", permissions "All (Admin)") and **Sales Executive**
("Mobile-only field sales rep — sell, collect, visit and report from the app", **32**
permissions).

**This is the screen every "Ask an admin to grant it" message points at.**

### `/team/employees` — Employees
**VERIFIED IN BROWSER 2026-10-27** — 21 records. Columns: Employee (name, email and employee
code), Employee Role, Holiday List, Status. Action: Add Employee.

It loads for the owner with no Access Denied window — **the F-005 fix confirmed in the browser.**

### `/team/employees/[id]` — Employee detail
**VERIFIED IN BROWSER 2026-10-27** — tabs **Details** and **Territory Assignment**. Profile
Picture, Profile (Name, Employee Code, Employee Role, Status), Login Details, Contact Details,
and a **Holiday List** block that explains it decides the employee's weekly offs and holidays,
that leave on those days is not counted, and that the attendance page judges them against this
calendar.

Minor: the Login Details email is rendered title-cased — `Testplayconsole@Gmail.Com` — while the
header shows it correctly (F-015).

### `/territories` — Territory Master
**VERIFIED IN BROWSER 2026-10-23, re-confirmed 2026-10-27**

799 territories on 001288, described on screen as the "single source of truth for customer
geography". Tabs: **Manage territories** and **Hierarchy & assignment**. Controls: Export,
Import, Add Territory, search, and a "Show archived (0)" toggle. Rows render like
`India (IN) · Country · seed`.

It carries a **backfill helper** — "Link old customer locations to this list" — which reports
that 696 customers still have a country/state/city typed the old way, matches each to a territory
by name, and marks the uncertain ones "needs review". The screen states it is safe to click more
than once.

**The Access Denied panel recorded here on 2026-10-23 was F-005 and is fixed** (commit `9b0a358`,
2026-10-27).

### `/subscription` — Subscription
**VERIFIED IN BROWSER 2026-10-23** — read-only summary of what the tenant has bought: **Unique
Customer ID** (the number a customer quotes to support), **Your Plan**, **Subscription Duration**
(start, latest renewal, expiry) and **User Limit Detail** ("You have created 21 out of 25 allowed
users").

**The fastest screen for answering "what plan is this customer on?"**

---

## The create forms

Every form in this table was opened on 2026-10-27 on a production build.

| Form | Shape |
| --- | --- |
| **Add New Lead** `/leads/new` | Primary Details (Business/Lead Name\*, Contact Person\*, Phone, **WhatsApp Number\*** with a "Same as Phone Number" tick, Email), Lead Status & Source, Address Details with the Territory cascade (Country → State → City), optional GPS with decimal-degree examples |
| **Add New Customer** `/contacts/new` | As above plus **Also Assigned To** (multi-select — "everyone here gets full access… reports and targets still credit one person"), Assign Employee, Customer Code, GST Number ("first two digits are the GST state code"), **Financial Settings** (Credit Limit, Credit Days, Opening Balance) and **Pricing** (Price List, defaulting to "Catalogue price") |
| **Add New Deal** `/deals/new` | Deal For = Customer or Lead, the party picker, Pipeline Stage (default New), a product grid (PRODUCT, UNIT, QTY, PRICE, TAX %, TOTAL) with Subtotal / Tax / Total Amount, Expected Close Date, Notes |
| **Create New Quotation** `/quotations/new` | Quotation For = Customer or Lead, Date\*, Valid Until, the same product grid, and **Terms & Conditions** with a template picker |
| **Add New Order** `/orders/new` | "Create a new sales order with live pricing and discounts." Customer\*, Date\*, a wider grid (PRODUCT, UNIT, QTY, PRICE, RATE INCL. TAX, LINE TOTAL INCL., DISCOUNT, TAX, LINE TOTAL) and a Sub-total / Tax / Total summary |
| **Create Dispatch** `/dispatches/new` | Customer\*, Order\*, Dispatch Code, Invoice No., Invoice Date, Transport Contact No., LR Date, Date\*. Product Details reads "Select an order to load its items" |
| **New Payment** `/payments/new` | Customer\*, Amount\*, Payment Type\*, Payment Date\*, Reference Number, Notes, optional receipt or cheque attachment |
| **Submit New Expense** `/expenses/new` | Expense Type\*, Date\*, Amount\*, Remarks, Proof Attachment (receipt photo or PDF) |
| **Add New Employee** `/team/employees/new` | Profile Picture, Profile (Name\*, Employee Code, Employee Role\*, Status\*), **Login Details** (Email\*, Password\*, Re-Password\*), Contact Details, Assigned Area cascade |
| **Announcement** `/announcements/new` | Title\*, Expiry Date, External Link, Employee (default All Users), Employee Role (default All Roles), Content\*, optional file. **No page heading** — it opens straight on "Basic Details" |

### Two create forms are broken

- 🔴 **`/tasks/new` (F-012)** — opened by its own URL, a bookmark, a refresh, or a task
  notification, **all fourteen dropdown lists stay empty for the life of the page** and Assigned
  To shows a raw database id. Reached by clicking **New Task** on the Tasks list it is perfect.
- 🔴 **`/products/new` (F-013)** — opening the URL directly throws the **account owner** back to
  `/products`. Clicking **New Product** on the list works.

**The workaround for both is the same, and it is worth telling a customer:** reach a create form
by clicking the button on its list screen, not by typing or bookmarking the URL.

---

## What has not been opened

Four routes are outstanding: `/print/list`, `/print/report`, `/print/quote` and
`/settings/document-templates/new`. Everything else that is not in this file is blocked for a
reason stated in [test-matrix.md](test-matrix.md) — 29 founder-only `/admin` pages, and the rest
needing a record that tenant 001288 does not have (no orders, quotations, payments, dispatches,
expenses, leave records or visits).

**To finish the catalogue, the next pass needs a seeded demo tenant with transactional data**,
which would also settle Q-008 — whether the other eleven reports count outside their period the
way Task Reports does.
