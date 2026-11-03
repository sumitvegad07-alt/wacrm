# Application overview — how OZZO is put together

The shape of the product, in the words you would use on a call. Read this once; the rest of the
knowledge base assumes it.

**Label:** VERIFIED IN CODE, 2026-10-27, from `wacrm-web/PROJECT.md`, the plan catalogue, and the
production database.

---

## What OZZO is

**One system that runs a field sales business**, sold as four product lines that can be bought
separately or together:

| Line | What it covers |
| --- | --- |
| **CRM** | Leads, deals, quotations, customers, WhatsApp |
| **WFA** — Workforce Automation | Attendance, visits, expenses, location tracking, territories |
| **SFA** — Sales Force Automation | Orders, dispatch, payments, stock, price lists, routes |
| **FSM** — Field Service Management | Assets, jobs, AMC, service invoicing — **built but not sold yet** |

**SFA and FSM both always include WFA.** That is the rule people most often get wrong.

It is **multi-tenant**: every customer is an *account*, every account's data is separated at the
database level, and one deployment serves all of them. A fix ships to everyone at once.

---

## The three pieces a customer touches

| Piece | What it is | Who uses it |
| --- | --- | --- |
| **The web portal** — `app.ozzo.co.in` | The manager's dashboard. Next.js | Owners, admins, office staff |
| **The Android app** — *OZZO SALES* on Google Play | The field app. React Native / Expo | Sales reps, field staff |
| **The marketing site** — `ozzo.co.in` | Public site, pricing, lead capture | Prospects |

The Android app is **live on Google Play** as *OZZO SALES* (`com.wacrm.fieldforce`). iOS is
planned, not built.

**Most field staff never see the web portal**, and that is the intended setup — their role has
mobile access and not web access. See gate 0 in
[access-control-matrix.md](access-control-matrix.md).

---

## What sits behind both

**One Supabase project** — Postgres, Auth, Storage, Realtime and Row Level Security — shared by
the web portal and the Android app.

- **The database is in Mumbai.** There is one production project and **no staging database**.
- **Row Level Security is the real security boundary.** Every read and write is re-checked
  against the account, the plan line and the user's permissions by the database itself. The app's
  own gates are a navigation layer on top.
- **Realtime** keeps the web portal and the phones in step: a permission change or a new record
  reaches the other side without a refresh.
- Email goes out through **Resend**; the web portal is hosted on **Vercel** and deploys from
  `main`.

### What this means on a support call

- **"Is it a web problem or an app problem?"** is usually the wrong question — they share one
  database. If the data is wrong in one, it is wrong in both.
- **A fix is global.** Changes apply to every tenant unless deliberately scoped to one.
- **The app works offline.** The Android app queues what a rep does with no signal and syncs it
  later, which is why a record can appear hours after it was created.

---

## The words OZZO uses, and the traps in them

| Word | What it means here | The trap |
| --- | --- | --- |
| **Account** | One customer company (a tenant) | Not a user, and not a login |
| **Customer** | The account's own customer | Stored in `contacts` — there is no "customers" table |
| **Customer ID** | The tenant number, e.g. `001288` | This is what a customer quotes to support |
| **Employee** | A user inside an account | Carries both an *account role* and an *employee role* |
| **Account role** | owner / admin / agent / viewer | Owner and admin bypass permissions |
| **Employee role** | The permission set, e.g. "Sales Executive" | This is what Team → Employee Roles edits |
| **Plan line** | CRM / WFA / SFA / FSM | What was bought. Only a plan change alters it |
| **Module** | One of 12 switches the admin controls | Can only be on if its line is owned |
| **Tax** | The rate on a product, from a tax slab | **Never call it GST** — GST is a separate setting |
| **Visit** | A check-in at a customer or lead | "Productive" means it produced an order |
| **Sales** | Dispatched, not ordered | Order value and sales value are different numbers |
| **Route / Beat** | A planned round of customers | Sold with SFA, not WFA |

---

## How a user gets to a screen

Five things are checked, in this order. The first "no" wins, and the user is rarely told which
one it was.

1. **Can they sign in to this app at all?** — web access / mobile access
2. **Does the account's plan include the line?**
3. **Has the admin switched the module on?**
4. **Does their account role or employee role allow it?**
5. **Which records may they see?** — data scope

All five are set out in [access-control-matrix.md](access-control-matrix.md), with the
diagnostic order for telling them apart.

---

## How an account comes to exist

1. A prospect signs up, or you create the account. **Signup links can carry a plan** —
   `/signup?plan=…` sets the account's plan and its default modules. An unknown plan gets CRM.
2. The plan decides which **lines** are on, and the **module defaults** are applied — every
   allowed module on, except Route, Reporting Hierarchy, Scheme and Stock, which ship off.
3. The account gets its **Customer ID** and a set of master-data defaults.
4. The owner works through **Getting Started**, which is a configured checklist, not a
   hard-coded one. See [setup-guides.md](setup-guides.md).
5. A **trial is not a separate plan** — it is a real plan with an expiry date. Expiry warnings
   appear in the header only within 15 days of the date.

---

## The two repositories, and why it matters to you

| Repository | What it is |
| --- | --- |
| `wacrm-web` | The Next.js web portal — and the one that holds the migrations, so the database schema lives here |
| `wacrm-mobile` | The React Native / Expo Android app |

They share the database, so **a schema change in one affects the other**. The practical
consequence for support: *the web and the app can be on different versions of the same feature.*
A fix that is live on the web is not on a rep's phone until a new build is released and they
install it.

**This is the single most common reason "it works for my manager but not on my phone".**

---

## What is deliberately not covered here

- **FSM / Service** — built to Phase 1, sold to nobody, and no tenant owns the line.
- **The founder-only `/admin` tools** — 29 routes for running the business (billing, proposals,
  renewals, revenue tools). Not part of what a customer sees.
- **The mobile app's own screens** — nothing mobile has been verified in this project.
