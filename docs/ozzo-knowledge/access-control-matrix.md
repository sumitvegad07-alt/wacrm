# Access control — who can see what, and why

The answer to the most common support question there is: *"Why can my admin see this and my sales
rep can't?"*

**Label:** VERIFIED IN CODE, 2026-10-27, against `src/lib/plans/catalog.ts`,
`src/lib/plans/surface-gates.ts`, `src/lib/auth/roles.ts`, `src/lib/auth/rbac.ts`,
`src/lib/auth/permissions-registry.ts`, `src/components/settings/settings-sections.ts` and the
`account_has_line` database function. Browser-confirmed parts are marked.

The rules below are read from the code and the database. A non-owner's experience follows from
them directly: a user sees exactly what their rights allow and nothing more, so the rules are the
answer. Where a rule is enforced only in one place, this file says so.

---

## The gates

A screen appears only when **every** gate passes. They are independent, and nothing on screen
tells the customer which one stopped them.

| # | Gate | Set by | Granularity | Changed by |
| --- | --- | --- | --- | --- |
| **0** | **Which app they may sign in to** — web portal, mobile, or both | The tenant's admin | The whole app | Team → Employee Roles, and the employee record |
| 1 | **Plan line** — did they buy it? | You, when you sell the plan | Whole product line | A plan change only |
| 2 | **Module toggle** — did the admin switch it on? | The tenant's own admin | One module | Settings → Organization Settings |
| 3 | **Account role** — owner / admin / agent / viewer | Whoever invited the user | The whole account | Team |
| 4 | **Employee-role permission** — one of 198 rights | The tenant's admin | One action on one module | Team → Employee Roles |

Then, separately: **data scope** decides *which records* they see on a screen they can already
open. That is gate 5 in practice, and it is the one that produces "my list is empty" rather than
"I can't find the menu".

Underneath all of it, **the database is the real ceiling.** RLS policies re-check the plan line
(`account_has_line`), membership (`is_account_member`) and the permission (`has_permission`) on
every read and write. The four gates above are the navigation layer — they stop a user wandering
into a screen that cannot work, with a reason. They are not what keeps data safe.

### Which gate fired — the diagnostic order

Ask these in order; the first "no" is your answer.

0. **Can they sign in to the web portal at all?** If they see "Web access disabled", that is
   gate 0 — nothing below it has been reached.
1. **Is it missing for *every* user in the account?** → gate 1 or 2. Check Subscription for the
   plan, then Settings → Organization Settings for the toggle.
2. **Is it missing for *one* user?** → gate 3 or 4. Check their account role first, then
   Team → Employee Roles.
3. **Can they open the screen but it looks empty?** → data scope, or a filter default. See
   `troubleshooting.md`.
4. **Did they get bounced to the dashboard with no message?** → gate 1 or 2 (F-001 — the redirect
   is silent). One exception: `/products/new` bounces for a different reason entirely (F-013).

---

## Gate 0 — which app they can sign in to at all

Before any screen is gated, a user is gated out of **the whole web portal** or **the whole mobile
app**. This is the first thing to check when someone says "I can't get in" — it is not a password
problem and not a licence problem.

Two rights, set in the roles editor's **Login Access** section:

| Right | Means |
| --- | --- |
| `web_access` | May sign in to the web portal |
| `mobile_access` | May sign in to the Android app |

**A new role is created with both switched ON.**

### Two independent switches control web access

A member is blocked from the web portal when **either** of these says no:

1. **The per-employee toggle** — `profiles.web_access`, a *Web Portal Access* switch on the
   employee record itself (Team → the employee). It defaults to on.
2. **The role's `web_access` permission** — and this is only evaluated when the employee actually
   has a business role assigned.

So an admin can take web access away from **one person** without touching their role, or from
**everyone on a role** at once. Both paths lead to the same locked screen.

### The owner can never be locked out

Owners are exempt by design, so an account cannot lock itself out of its own portal.

### What the blocked user sees

Not an error and not a blank page — a specific card:

> **Web access disabled**
> Your account does not have access to the web portal. Please use the mobile app, or ask your
> administrator to enable Web Portal Access for your role.
> *[Sign out]*

**That is the exact wording a customer will quote back to you.** When they do, the answer is
Team → Employee Roles → Login Access, or the Web Portal Access switch on their employee record.

**This is the normal setup for field staff.** On the Play Console test tenant, the 20 sales
executives are marked *App only* and only the admin uses the web — that is the intended shape of
a field-sales account, not a misconfiguration.

⚠️ **Web access is enforced in the browser only.** The code notes that a server-side check is
still a future hardening pass. The user is stopped at the shell, but the data itself is protected
by RLS and by the gates below, not by this one. Treat it as a UX control, not a security boundary.

---

## Gate 1 — the plan lines

There are **four product lines** and **eight sellable plans**. A plan is a combination of lines.

**SFA and FSM both always include WFA.** That is the single most misread thing in the model: a
customer on plain SFA has every WFA screen.

| Plan | CRM | WFA | SFA | FSM | ₹/user/month |
| --- | :---: | :---: | :---: | :---: | --- |
| CRM | ✓ | | | | 100 |
| WFA | | ✓ | | | 150 |
| CRM + WFA | ✓ | ✓ | | | 200 |
| SFA | | ✓ | ✓ | | 300 |
| CRM + SFA | ✓ | ✓ | ✓ | | 400 |
| FSM | | ✓ | | ✓ | *500 — placeholder* |
| CRM + FSM | ✓ | ✓ | | ✓ | *600 — placeholder* |
| SFA + FSM | | ✓ | ✓ | ✓ | *800 — placeholder* |

The three FSM prices are marked in the code as **not founder-approved — do not publish them**.

Prices are the annual base. Quarterly is +40%, half-yearly +20%, yearly is the base.

### Legacy plans

Values like `Free`, `Basic`, `Pro`, `Enterprise` and `Premium` predate the line model. Both the
app and the database treat any unrecognised plan as **full access to CRM, WFA and SFA — but not
FSM.**

That exclusion is deliberate: the FSM line was invented after those tenants signed up, so it was
never part of their "full access", and granting it would switch the unfinished `service` module
on for every legacy tenant.

**So "the founder's own account can see more" is not a special case** — it is a legacy plan
behaving exactly as designed.

### There is no Trial plan

A paid trial is a real plan with `subscription_expires_at` set to the trial end date. New signups
default to **CRM**.

---

## Gate 2 — the twelve module toggles

The tenant's own admin switches these at **Settings → Organization Settings**. A module can only
be switched on if its line is owned — the server clamps the saved value to the plan, so a CRM
tenant cannot turn on Dispatch by any route.

| Module key | Line that owns it | Ships on when the plan is applied? |
| --- | --- | --- |
| `whatsapp` | CRM | ✓ on |
| `quotation` | CRM | ✓ on |
| `expense` | WFA | ✓ on |
| `territory` | WFA | ✓ on |
| `reporting_hierarchy` | WFA | **off** — "Available Soon", ships off |
| `route` | **SFA** | **off** — Beat Planning is optional; free-visit mode is the default |
| `dispatch` | SFA | ✓ on |
| `pending_dispatch` | SFA | ✓ on |
| `payment` | SFA | ✓ on |
| `scheme` | SFA | **off** — opt-in from Catalogue Settings |
| `stock` | SFA | **off** — opt-in from Catalogue Settings |
| `service` | FSM | ✓ on |

**Route Management is sold with SFA, not WFA** (founder's ruling, 2026-09-26). A WFA or CRM + WFA
account cannot have it.

**Four modules ship off even when the plan allows them** — Route, Reporting Hierarchy, Scheme and
Stock. A customer on CRM + SFA asking "where is Stock?" usually needs the toggle, not a new plan.

---

## Gate 1 + 2 by screen — the route gates

Read longest-prefix-first, so a specific page beats the section it sits in. **Any path not in
this table is a base feature available on every plan.**

### CRM

| Path | Needs |
| --- | --- |
| `/inbox`, `/whatsapp`, `/broadcasts`, `/automations`, `/flows` | CRM + `whatsapp` |
| `/leads`, `/pipelines`, `/deals` | CRM |
| `/quotations` | CRM + `quotation` |
| `/reports/leads`, `/reports/deals` | CRM |
| `/reports/quotations` | CRM + `quotation` |

### Catalogue — CRM **or** SFA

`/products` and `/catalog` need **either** line, never WFA alone: a WFA-only tenant has no
quotations and no orders to spend a catalogue on.

### SFA

| Path | Needs |
| --- | --- |
| `/orders`, `/price-lists` | SFA |
| `/payments` | SFA + `payment` |
| `/dispatches`, `/dispatch` | SFA + `dispatch` |
| `/pending-dispatch` | SFA + `pending_dispatch` |
| `/routes`, `/location-tracking/executions` | SFA + `route` |
| `/schemes` | SFA + `scheme` |
| `/stock` | SFA + `stock` |
| `/reports/orders`, `/reports/sales`, `/reports/ageing`, `/reports/summary/*` | SFA |
| `/reports/payments` | SFA + `payment` |
| `/reports/stock` | SFA + `stock` |

### WFA

| Path | Needs |
| --- | --- |
| `/expenses`, `/reports/expenses` | WFA + `expense` |
| `/location-tracking/*` (everything else) | WFA |
| `/reports/visits`, `/reports/dsr` | WFA |

**Two exceptions sit inside `/location-tracking` and are base features on every plan:**
`/location-tracking/attendance` and `/location-tracking/leaves`. Attendance, Leave and Holiday
Management is sold in every column, CRM included. They are listed before the section gate for
exactly that reason.

### FSM

`/service/*` needs the FSM line. **No tenant currently owns it**, and a legacy plan explicitly
does not.

### Base features — no plan gate at all

Dashboard, Customers, Tasks, Follow-ups / My Activity, Announcements, Territories, Team, Settings,
Subscription, Company Profile, Getting Started, Import (contacts and tasks), Attendance, Leave.

---

## The import wizards and custom-field editors

These are gated separately, because they are addressed by a path segment rather than a menu item.
Both lists used to be ungated — that was a real plan leak reachable by typing the URL.

| Import module | Needs |
| --- | --- |
| `products`, `product_categories`, `product_units` | CRM or SFA |
| `leads` | CRM |
| `orders`, `outstanding`, `price_lists` | SFA |
| `stock` | SFA + `stock` |
| `territories` | WFA + `territory` |
| `customer_assets` | FSM |
| `contacts`, `tasks` | **base — every plan** |

| Custom-field module | Needs |
| --- | --- |
| `product` | CRM or SFA |
| `quotation` | CRM + `quotation` |
| `lead`, `deal` | CRM |
| `order` | SFA |
| `dispatch` | SFA + `dispatch` |
| `customer_visit` | WFA |
| `lead_visit` | **CRM *and* WFA** — a lead visit is a visit (WFA) against a lead (CRM); neither line alone can produce one |
| `expense` | WFA + `expense` |
| `user`, `contact`, `task` | **base — every plan** |

⚠️ **Import keys are plural, custom-field keys are singular** (N-005). `/import/contact` is not an
error page — it says "coming soon".

---

## Gate 3 — the four account roles

Mirrors the `account_role_enum` Postgres type, and the same ordinal is used by the
`is_account_member(account_id, min_role)` SQL helper, so the app and RLS agree.

| Role | Rank | What it means |
| --- | :---: | --- |
| **owner** | 4 | The account holder |
| **admin** | 3 | Full administrative access |
| **agent** | 2 | A normal working user |
| **viewer** | 1 | Read-only |

### Owner and admin bypass gate 4 entirely

```
hasPermission: (key) => {
  if (isOwner || isAdmin) return true;
  return hasPermission(permissions, key);
}
```

The same is true of data scope: an owner or admin resolves to scope `all`.

**They do not bypass gate 1.** An owner on a CRM plan still cannot reach the Order screens — the
surface gate has no owner override, deliberately.

**Two consequences for support:**

- Testing a permission problem while signed in as the owner proves nothing. Everything passes.
- "It works for me but not for my rep" from a customer's admin is expected, not a fault.

---

## Gate 4 — the employee-role permissions

**198 permission keys in 30 groups**, stored as a JSON map on the employee role and checked by
both the app and the database.

The groups: CRM · DEALS · CATALOGUE · QUOTATIONS · DISPATCH · EXPENSES · STOCK · SCHEMES ·
PAYMENTS · CUSTOMERS · DATA_ACCESS · TASKS · LEAVE · VISITS · IMPLEMENTATION · MOBILE · FIELD ·
FIELD_RULES · ROUTES · WHATSAPP · REPORTS · MASTERS · SETTINGS · TEAM · ACCESS · ADMIN · IMPORT ·
ASSISTANT · NOTIFICATIONS · SERVICE_ASSETS · SERVICE_SETTINGS.

### Four rules that decide whether a key resolves

1. **`{"all": true}` is a full bypass.** The Admin role carries it — this is why the Roles screen
   shows its permissions as "All (Admin)" rather than a number.
2. **`true` and `"true"` both count.** UI-saved keys store the boolean; SQL backfills and the
   Postgres `has_permission()` function store the string. Both are treated as granted so the
   client matches RLS exactly.
3. **`create_x` and `add_x` are aliases of each other.** Creation rights were `add_<module>`
   before the move to `create_<module>`, and roles in the wild still carry either spelling.
   Installed mobile builds check the legacy keys and cannot be updated retroactively, so both
   must keep resolving.
4. **A missing key is a "no".** There is no inheritance between groups.

### Where a permission is actually enforced

| Layer | What it does |
| --- | --- |
| **Sidebar** | Hides the nav row |
| **Route guard** | Blocks the page |
| **Page gate** | Renders an Access Denied panel |
| **RLS** | Refuses the row — `has_permission(uid, account_id, 'create_deals')` sits inside the policy |

A permission that exists in the registry but is not referenced anywhere gates nothing. Two such
keys were removed in August 2026 for that reason.

---

## Gate 5 — data scope: which records, not which screen

A user who can open a screen may still see only some of its rows.

| Scope | Sees |
| --- | --- |
| `own` | Only their own records — **this is the default when nothing is set** |
| `team` | Their team |
| `department` | Their department |
| `company` | The whole account |
| `all` | Everything (owner / admin / `{"all":true}`) |

Scope is stored per module as `<module>_scope`.

### Directional visibility, and the hierarchy switch

Two separate rights widen what a user sees along the reporting tree:

- **`view_child_data`** — also see subordinates' (downline) records
- **`view_parent_data`** — also see managers' (upline) records

**Scoping is switched off entirely when Reporting Hierarchy is off.** Without a reporting tree
there is no parent/child concept, so visibility stays account-wide. This is what keeps a company
that never turned hierarchy on from suddenly dropping every user to own-only.

**So turning Reporting Hierarchy ON can make data disappear for your customer's reps** — not
because anything broke, but because scoping starts applying. Warn them before they switch it on.
(The toggle ships off; see gate 2.)

### Which tables the app scopes, and which the database scopes

This distinction matters when a list looks wrong:

| Scoped in the app *and* the database | Scoped **only** by the database |
| --- | --- |
| `orders` (`user_id`) · `deals` · `site_visits` (`user_id`) · `expenses` (`employee_id`) | `contacts` · `leads` · `payments` |

The second group is deliberately left alone: their RLS ORs the directional path alongside
**territory** and **collaborator** visibility, so a client-side filter there would subtract rows
the database legitimately returned. They stay RLS-authoritative.

During the load window, scoping **fails open** to account-wide — the RLS layer still scopes the
actual rows, so nothing leaks.

---

## The settings sections

24 sections, each with its own gate and its own permission. The `?tab=` values are deep-linkable,
so each one is gated individually; they used to render for anyone who could reach `/settings`.

| Section | Rail group | Needs (plan) | Needs (permission) |
| --- | --- | --- | --- |
| Overview / Organization Settings | top / workspace | — | `manage_org` |
| Appearance | Account | — | **none — personal** |
| Notifications | Account | — | **none — personal** |
| Change Password | hidden | — | **none — personal** |
| Whatsapp | Workspace | CRM + `whatsapp` | `manage_whatsapp_settings` |
| Knowledge Base | hidden | CRM + `whatsapp` | `view_ai_assistant` |
| Templates | hidden | CRM + `whatsapp` | `view_templates` |
| Deals | Workspace | CRM | `edit_pipelines` |
| Leads Settings | Workspace | CRM | `edit_lead_sources` |
| Tags | Workspace | — | `manage_tags` |
| Template *(documents)* | Workspace | — | `edit_document_templates` |
| Currency | hidden | — | `manage_org` |
| Task Settings | Workspace | — | `edit_task_types` |
| Leave Settings | Workspace | — | `edit_leave_types` |
| Orders Settings | hidden | SFA | `manage_order_settings` |
| Payments | Workspace | SFA + `payment` | `edit_payment_types` |
| Route Settings | Workspace | SFA + `route` | `manage_route_settings` |
| Catalogue Settings | Workspace | CRM or SFA | `edit_tax_slabs` |
| Expense Settings | Workspace | WFA + `expense` | `edit_expense_types` |
| Territory | Workspace | WFA + `territory` | `edit_territories` |
| Attendance Locations | Workspace | WFA | `edit_attendance_locations` |
| Team | hidden | — | `manage_employees` |
| API Settings | Workspace | — | `manage_api_keys` |

**Catalogue Settings carries the Scheme and Stock opt-ins**, plus tax slabs and discount rules —
so "where do I switch Stock on?" is Catalogue Settings, not Organization Settings.

**Section ids are not always what the label says.** The `deals` section is **Currency**; the deal
pipelines live under `deal_pipelines`. Only three `?tab=` aliases exist — `tags` and
`custom-fields` both resolve to Fields, and `deals` resolves to the pipelines. Everything else
falls back to Overview, which is the cause of F-011.

---

## Rules enforced on the phone, not on the web

Five keys are stored and edited on the web but enforced **inside the Android app**. The web app
renders them; only the mobile build makes them real.

| Key | Effect on the phone |
| --- | --- |
| `order_without_checkin` | May take an order without checking in to the customer |
| `payment_without_checkin` | May collect a payment without checking in |
| `visit_without_punchin` | May start a visit without punching in for the day |
| `punch_selfie_required` | Must take a selfie to punch in |
| `odometer_photo_required` | Must photograph the odometer |

⚠️ **Setting one of these changes nothing until the rep's app is on a build that reads it.**
Nothing on mobile has been verified in this project.

---

## Two traps worth knowing before you answer a question

### `module:` on a nav item is a permission, not a module toggle (N-001)

The two look identical in the code and mean different things. Read N-001 in
[known-issues.md](known-issues.md) before concluding "the module is off".

### A plan-blocked URL bounces silently (F-001)

The user is redirected to the dashboard with **no explanation at all**. They will describe it as
"the link doesn't work" or "it logged me out". Nothing on screen distinguishes a plan gate from a
module toggle, which is why the diagnostic order at the top of this file matters.

---

## What is still unproven

| Question | Status |
| --- | --- |
| Does a scoped list behave as described? | **Unverified** — tenant 001288 has Reporting Hierarchy off, so scoping never engaged. The rule is read from the code |
| Do the mobile field rules work? | **Unverified** — nothing mobile has been checked in this project |
| Is web access enforced on the server? | **No.** The code says so: the check lives in the browser shell, and a server-side check is a future hardening pass |
| Are there other gates that redirect during the loading window? | **Open — Q-009.** F-013 found one that the F-005 fix missed; no sweep has been done |

**A non-owner pass is deliberately not on this list.** A user sees exactly what their rights
allow: a sales rep with no web right cannot open the web portal at all, and an HR role without
order rights has no order screens. The rules above are the answer, so the knowledge base records
the rules rather than re-deriving them one login at a time.
