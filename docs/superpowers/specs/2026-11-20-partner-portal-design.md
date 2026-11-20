# OZZO Partner Portal — design

**Date:** 2026-11-20
**Status:** approved in brainstorming; implementation plan not yet written
**Domain:** `partner.ozzo.co.in`
**Code:** new repo + folder `C:\Wacrm\ozzo-partner` (sibling of `wacrm-web`, `ozzo-dms`, `ozzo-site`)

## Why

`/admin` — the super-admin portal — has become two unrelated products wearing one
sidebar. Thirteen links are platform operations (tenant health, data browser, view-as,
audit, recovery); seven more are **OZZO's own sales business** (price calculator,
invoices, renewals, proposals, forecast, lead discovery, WhatsApp sender). Those seven
are already hidden behind `isFounderEmail`, which is the tell: they were never tenant
operations, and they have nowhere else to live.

(The eighth founder-only link, **Data Retention**, stays in `/admin`. It purges old
tenant tracking and log data — platform housekeeping, not sales.)

At the same time the founder wants to employ sales staff to sell OZZO, give them
leads, and watch what they do with them. Those people must not be superadmins, must
not see tenant data, and must not appear in any tenant's employee dropdown.

The Partner Portal is the home for both: OZZO's own sales operation, with its own
staff, its own leads, and the founder's business modules moved out of `/admin`.

## Decisions taken (and who took them)

Every one of these was decided by the founder during brainstorming, not assumed:

1. **A complete, separate web app** — not a route group inside `wacrm-web`, not OZZO
   as a tenant of its own CRM. Own tables for leads, customers, tasks and staff.
   **Web only — no mobile app.**
2. **Copy the existing screen code** rather than write new screens. Explicitly
   sanctioned: "you can simply copy the code, you don't need to create new lines".
3. **The six moved modules keep their live data and are removed from `/admin`.**
   Not duplicated, not restarted empty. One set of invoices, one set of renewals.
4. **A Customer is a business that bought OZZO, linked to its real `accounts` row**,
   so invoices, renewals and proposals line up with the customer record.
5. **Full roles system**, like the CRM: arbitrary roles, per-module rights, reporting
   manager, enforced in the database.
6. **Complaints & Suggestions is customer-facing** — staff log what a customer told
   them. Not an internal staff suggestion box.
7. **WhatsApp Sender moves too** (it belongs beside Lead Discovery), and
   **harvested prospects can be pushed into Leads in one click.**

## Architecture

### The app

A Next.js App Router app, same major versions as `wacrm-web`, built the way
`ozzo-dms` was: own private repo, own Vercel project, own domain. Dev port **3200**
(`wacrm-web` 3000, `ozzo-dms` 3100).

The design system (`components/ui`, `globals.css`, tokens, the `PageLayout` /
`PageHeader` / `SettingsPanel` family, the table framework) is copied from
`wacrm-web` so the portal is visually indistinguishable from `/admin`.
`ozzo-dms/app/design-system-parity.test.ts` is the precedent for keeping it that way.

### The database

The **same** Supabase project (Mumbai, `ltigfpywdbfilsagtpyd`). This is not a
preference — it is forced by decision 3: `platform_invoices`, `platform_proposals`,
`platform_subscriptions` and the `re_discovery_*` tables already live there and must
stay live.

### Identity — and why partner staff are NOT `profiles`

A partner employee is an `auth.users` row plus a `partner_employees` row. They get
**no `profiles` row**.

This is the same reasoning `ozzo-dms/README.md` records for distributors, applied in
the other direction. `profiles` means "an employee of a tenant account": 107 web
files and 56 database functions read it that way, and they feed employee dropdowns,
headcounts, incentive calculations and `account_id` RLS. An OZZO salesperson is an
employee of *OZZO*, not of a tenant, and OZZO is not a tenant in its own CRM. Giving
them a `profiles` row means every one of those places must start asking "ours, or a
tenant's?" — and the first place that forgets puts an OZZO salesperson into a
customer's team list.

Consequences, both of them desirable:

- A partner employee **cannot** sign into `app.ozzo.co.in` — no `profiles` row, so
  the dashboard layout has nothing to load.
- A tenant user **cannot** sign into `partner.ozzo.co.in` — no `partner_employees`
  row, so the portal's gate rejects them.

The founder signs in with his existing auth user; he gets a `partner_employees` row
with the Super Admin role. Same email, same password, no second identity.

### The privileged key

The portal holds `service_role` **server-side only** (on Vercel the variable is
named `service_role` — see `lib/supabase/service-role-key.ts` in `wacrm-web`). It
needs it for two things:

1. Creating staff logins (`auth.admin.createUser`).
2. Reading `platform_*`, which has RLS enabled with **no policies at all** — by
   design, so nothing but a server can read it.

This mirrors `wacrm-web/src/lib/auth/superadmin.ts` exactly: verify the caller on
their own RLS-scoped session, check their rights, *then* use the service client.

A test must fail the build if the key appears in any client-reachable file —
`ozzo-dms/lib/supabase/no-privileged-key.test.ts` inverted (that app asserts the key
is absent entirely; here it must be absent from everything except
`lib/auth/partner.ts` and `app/api/**`).

## Data model

### New tables — all prefixed `partner_`, all with RLS

```
partner_roles             name, description, permissions jsonb, data_scope,
                          is_system
partner_employees         user_id -> auth.users, full_name, email, phone,
                          role_id, manager_id, designation,
                          status, joined_on
partner_lead_statuses     name, colour, sort_order, is_active
partner_lead_sources      name, sort_order, is_active
partner_industries        name, sort_order, is_active
partner_leads             name, company, contact_person, phone, email,
                          status, source, industry, owner_id, est_value,
                          expected_close, next_follow_up,
                          address/area/city/state/country/pincode, notes,
                          discovery_lead_id -> re_discovery_leads,
                          converted_customer_id, converted_at, record_status
partner_customers         business_name, account_id -> accounts (nullable),
                          contact_person, phone, email, city, state, gstin,
                          plan, billing_term, owner_id, became_customer_on,
                          source_lead_id -> partner_leads, notes, record_status
partner_tasks             kind (Task/Call/Visit/Meeting/Follow up/Note),
                          subject, detail, due_date, due_time, priority,
                          status (Undone/Done), completed_at, assignee_id,
                          lead_id, customer_id
partner_tickets           ticket_no, kind (complaint/suggestion), customer_id,
                          lead_id, raised_by_name, raised_by_phone, title,
                          detail, category, priority, status, assignee_id,
                          logged_by_id, raised_on, resolution, resolved_at,
                          closed_at
partner_ticket_notes      ticket_id, note, author_id, created_at
```

Every table carries `created_at`, `updated_at`, `created_by`. `record_status`
(`active` / `inactive`) is the soft-delete convention already used by CRM leads and
contacts — copied, not reinvented.

`partner_customers.account_id` is nullable (a customer may be signed before their
tenant is provisioned) and unique when present (one portal customer per account).

### Database helpers

```
partner_me()                -> the caller's partner_employees.id, or null
partner_has_right(key)      -> boolean. Inactive staff denied, then
                               permissions ->> 'all' = 'true', else
                               permissions ->> key = 'true', else the
                               prefix_* wildcard — the same four rules, in the
                               same order, as the CRM's has_permission()
partner_scope_ids()         -> setof partner_employees.id the caller may see:
                               'own'  -> just themselves
                               'team' -> themselves + everyone below them,
                                         by recursive walk of reporting_manager_id
                               'all'  -> every active employee
```

Plus a `BEFORE INSERT OR UPDATE OF manager_id` trigger on `partner_employees` that
rejects a change which would create a loop — a copy of
`public.prevent_manager_cycle()` from `supabase/migrations/106_reporting_hierarchy.sql`,
including its self-reference check and its depth cap. The bug it prevents is an
infinite recursion inside `partner_scope_ids()`.

**Migrations for these tables live in `wacrm-web/supabase/migrations`**, with a
matching `wacrm-web/docs/RUN-THIS-SQL-partner-*.md` to paste into the Supabase SQL
editor. One database, one migration history — and it is the precedent the DMS portal
already set. (The Supabase CLI is still linked to the stale Singapore project, so
`db push` is not the route; pasting is.)

### Reused tables — no schema change, read through server routes only

```
platform_proposals                 Sales Proposals
platform_invoices                  Invoices
platform_invoice_settings          Invoice numbering / GST / branding
platform_subscriptions             Renewals
accounts                           the real company accounts a Customer links to
re_discovery_runs/queries/leads    Lead Discovery
re_outreach_*, re_suppressions     WhatsApp Sender
```

## Rights model

`partner_roles.permissions` is a JSON **object** of `key -> true`, with
`{"all": true}` for Super Admin — byte-for-byte the shape of
`employee_roles.permissions`, which is what lets the Roles screen and
`has_permission()`'s resolution rules copy across unchanged. The registry is
**trimmed to this portal's own modules**: listing rights for Orders, Stock, Routes or
Attendance would be noise.

```
dashboard    view_dashboard
leads        view_ create_ edit_ delete_ convert_ assign_ import_ export_ leads
customers    view_ create_ edit_ delete_ import_ export_ customers
activity     view_ create_ edit_ delete_ activities, view_team_activities
employees    view_employees, manage_employees
roles        view_roles, manage_roles
proposals    view_ create_ edit_ delete_ proposals
invoices     view_ create_ edit_ invoices, manage_invoice_settings
renewals     view_renewals, renew_subscription
calculator   view_calculator
forecast     view_forecast
discovery    view_discovery, run_discovery, push_discovery_to_leads
outreach     view_outreach, send_outreach
tickets      view_ create_ edit_ delete_ tickets, assign_tickets, resolve_tickets
masters      manage_masters
settings     manage_settings
```

Seeded roles (all editable; only Super Admin is `is_system`):

| Role | Scope | Roughly |
|---|---|---|
| Super Admin | all | `{"all": true}` |
| Sales Manager | team | leads + customers + activity in full, proposals view/create, calculator, renewals view, discovery view + push, tickets view/create/assign, employees view |
| Sales Executive | own | leads view/create/edit/convert, customers view/create/edit, activity in full, proposals view, calculator, tickets view/create |
| Telecaller | own | leads view/create/edit, activity in full, tickets create |

Note what the default grants do **not** include: Invoices, Forecast, Renew and Send.
Those start as Super Admin only.

### Three enforcement rules that are not negotiable

These are each a bug this product has already shipped once:

1. **Rights are enforced at the database, not in the menu.** Every `partner_*`
   policy is written in terms of `partner_has_right()` and `partner_scope_ids()`.
   Hiding a sidebar link while the row still fetches is the exact shape of
   `rbac-not-enforced-at-data-layer`.
2. **The dashboard scopes by hierarchy.** Every tile counts
   `owner_id IN (SELECT partner_scope_ids())`. A dashboard that totals the company
   for an `own`-scope executive is a leak, and
   `dashboard-hierarchy-scoping-requirement` exists because of it.
3. **The moved modules are gated in the route, before the service client.**
   `requirePartnerRight('view_invoices')` then `serviceClient()`, never the reverse.

## Modules

### Copied from the CRM

| Module | Source | Notes on the copy |
|---|---|---|
| Employees | `app/(dashboard)/team/employees` | Add/edit/deactivate, role, reporting manager; **plus** login creation, which the CRM does elsewhere |
| Employee Roles | `app/(dashboard)/team/roles` | Same screen, partner rights registry, plus the data-scope selector |
| Leads | `app/(dashboard)/leads` | Full table framework: filter row, Manage Columns, saved views, search, import, export, A4/A5 print, soft delete, re-activate |
| Customers | `app/(dashboard)/contacts` | Reshaped to a business; adds the `accounts` link and a panel showing that account's invoices, renewal date and proposals |
| My Activity | `app/(dashboard)/follow-ups` | Same screen and the same `TaskForm`, against partner leads/customers |

The table framework (filter row, Manage Columns, saved views, print) travels with
these screens. It is the reason the portal will feel like `/admin` rather than like a
different product.

### Settings — small, but it has to exist

Not in the founder's list, because it is plumbing rather than a module: one Settings
screen holding the three master lists (lead statuses with colours, lead sources,
industries), the ticket categories, and the invoice settings that move across from
`/admin/invoice-settings`. It is what `manage_masters` and `manage_settings` govern,
and without it the master lists are only editable by migration.

### Moved from `/admin` — same data, new home

| Module | Routes to move | Tables |
|---|---|---|
| Sales Proposals | `admin/proposals/**`, `api/admin/proposals/**`, **`print/proposal/[id]`** | `platform_proposals` |
| Invoices | `admin/invoices/**`, `admin/invoice-settings`, `api/admin/invoices/**`, `api/admin/invoice-settings`, **`print/invoice/[id]`** | `platform_invoices`, `platform_invoice_settings` |
| Renewals | `admin/renewals`, `api/admin/renewals/**` | `platform_subscriptions` |
| Price Calculator | `admin/calculator` | none (pure, over `lib/plans`) |
| Business Forecast | `admin/forecast` | reads accounts / invoices |
| Lead Discovery | `admin/revenue/discover`, `api/admin/revenue/discover/**` | `re_discovery_*` |
| WhatsApp Sender | `admin/revenue/outreach`, `api/admin/revenue/outreach/**` | `re_outreach_*`, `re_suppressions` |

The two print routes are easy to miss and would break PDF output if left behind.

`requireFounder()` becomes `requirePartnerRight(key)` in the moved API routes. The
founder keeps access because Super Admin holds every right — but access now comes
from a role, not from an email address, which is what lets him delegate invoicing to
a staff member later without making them a superadmin.

**Removal from `/admin` is part of the same phase as the move**, not a later tidy-up.
Leaving both means two homes for one invoice list. His existing `/admin/invoices`
bookmarks will 404 — he needs telling, once, with the new URLs.

### Purpose-built: Dashboard

The CRM dashboard composes plan-based sections (`CrmSection`, `WorkforceSection`,
`SalesSection`) counting orders, dispatches, visits and attendance. Copied here it
would render a page of zeroes. Same look, OZZO's own numbers:

leads by status · new leads this month · leads converted · business won this month ·
renewals due in 30 days · outstanding payments · open complaints · my activity due
today · team leaderboard (leads, conversions, value per person).

All of it through `partner_scope_ids()`.

### New: Complaints & Suggestions

One module, one list, `kind` of `complaint` or `suggestion`, logged by staff on
behalf of a customer or a lead.

The two kinds have **different lifecycles**, because they are not the same thing:

```
complaint    New -> In Progress -> Waiting on customer -> Resolved -> Closed
suggestion   New -> Under Review -> Planned -> Done -> Declined
```

Enforced by a trigger that checks `status` against `kind`, so a suggestion can never
land in "Waiting on customer". Moving a complaint to Resolved requires `resolution`
text — a closed complaint with no record of what was done is worthless three weeks
later.

Each ticket carries a dated note trail (`partner_ticket_notes`), and the list shows
**days open** so nothing rots quietly. `ticket_no` is a per-kind sequence
(`CMP-0001`, `SUG-0001`) assigned by a unique index plus retry on `23505` — the same
approach `lib/invoices/number.ts` already uses, for the same reason.

### Lead Discovery → Leads

Tick rows in the discovery results, choose an owner, push. Each becomes a
`partner_leads` row with `source = 'Lead Discovery'` and `discovery_lead_id` set for
provenance. **Duplicates are skipped by phone number** against existing
`partner_leads`, and the result reports how many were created and how many skipped.
Gated by `push_discovery_to_leads`.

## Out of scope for v1

Deliberately excluded, each with a reason rather than a shrug:

- **Mobile app** — the founder ruled it out explicitly.
- **Custom fields** — the engine exists for tenants who need their own columns; OZZO
  controls this portal's schema directly.
- **Lead geo-tagging and the map** — built for field reps checking in at a shop.
- **Reports engine** — `execute_report` is patched in place in the live database and
  is not reproducible from any repo file (`report-engine-is-patched-in-place`).
  Copying it is not a copy job. The Dashboard covers v1's reporting need.
- **Territory masters, broadcasts, automations, realtime sync.**

None of these blocks a later addition.

## Risks

1. **Copied code diverges from the CRM.** A fix to the Leads table in `wacrm-web`
   will not reach the portal. This is the accepted cost of decision 1.
   *Mitigation:* keep file paths, component names and prop shapes identical to the
   originals, and record every copied file with its source commit in
   `ozzo-partner/COPIED-FROM.md`, so porting a CRM fix is a diff rather than an
   archaeology exercise.
2. **Two apps, one `platform_*` dataset, during phase 3.** Between deploying the
   portal's invoices and deleting `/admin`'s, both can write. Phase 3 is not done
   until the `/admin` routes are deleted — in the same push.
3. **The service-role key in a second app.** Contained by the no-leak test and by
   the route-level right check preceding every service client call.
4. **Staff email addresses.** Creating a login needs a real, unique email per
   employee. If the staff have no `@ozzo.co.in` mailbox, their personal email works
   — it only identifies the login.

## Phases

Each phase ends deployed, usable, and committed to `main` (the project pushes
straight to `main`; Vercel deploys `main`).

**This spec covers five phases, which is more than one implementation plan should
carry.** Each phase gets its own plan, written when that phase starts — beginning
with Phase 1. Writing all five up front would be guessing at phases 4 and 5 before
phase 1 has taught us anything.

**Phase 1 — Foundation.** Repo, Vercel project, `partner.ozzo.co.in`, design system,
login, the gate, `partner_roles` + `partner_employees` + helpers + RLS + cycle
trigger, Employees and Employee Roles screens, login creation, seeded roles, founder
seeded as Super Admin.
*Done when:* the founder signs in at `partner.ozzo.co.in`, creates a Sales Executive,
that person signs in, sees only what the role allows, and cannot sign into
`app.ozzo.co.in`.

**Phase 2 — Leads, Customers, My Activity.** Plus the three master lists and the
table framework.
*Done when:* a lead can be created, filtered, imported, exported, printed, converted
to a customer, and that customer shows its linked account's invoices and renewal
date; an executive sees only their own rows, their manager sees both, and both facts
hold against the database and not only the screen.

**Phase 3 — Move the six, plus WhatsApp Sender.** Including the two print routes and
the `requireFounder` → `requirePartnerRight` swap. `/admin` routes and nav links
deleted in the same push.
*Done when:* every existing invoice, proposal and renewal is visible in the portal, a
PDF prints correctly, and `/admin` no longer lists or serves any of them.

**Phase 4 — Complaints & Suggestions.** Tables, both lifecycles, the note trail,
days-open, numbering.
*Done when:* a complaint can be logged against a customer, assigned, noted, resolved
with resolution text, and closed; and a suggestion cannot enter a complaint-only
status.

**Phase 5 — Dashboard.** All tiles, all hierarchy-scoped.
*Done when:* the founder's tiles total the company, an executive's tiles total only
their own work, and the numbers agree with the module lists behind them.
