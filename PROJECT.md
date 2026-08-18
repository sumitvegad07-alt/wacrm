# WACRM Master Project Documentation & Knowledge Base

*This document serves as the single source of truth for the WACRM project, including both Web and Mobile architecture, database schemas, API conventions, and AI coding rules.*

---



# PART 1: WEB APPLICATION RULES & GUIDELINES

@AGENTS.md

# CLAUDE.md — WACRM Web (wacrm-web)

This file loads at the start of every session. It is the source of truth for how this project is
built and how you must work in it. Read it fully before writing any code.

Note the `@AGENTS.md` import above: this repo runs **Next.js 16**, which has breaking changes from
older versions. Do not assume App Router conventions you remember — check
`node_modules/next/dist/docs/` when unsure.

## What this project is

WACRM = multi-tenant B2B SaaS: CRM + WhatsApp CRM + Field Force Tracking. This repo (`wacrm-web`)
is the **Next.js admin web app**. The Android field app is a separate repo (`wacrm-mobile`,
React Native / Expo). Backend is **Supabase (Postgres + Auth + Storage + Realtime + RLS)** —
shared by both repos. A schema change here affects mobile, and vice versa.

## Tech stack (do not deviate without asking)

- **Next.js 16.2.6**, React 19.2.4, App Router (`src/app/`), TypeScript strict mode
- Supabase via `@supabase/ssr` ^0.10.3 + `@supabase/supabase-js` ^2.107.0
  - Browser/client components: `@/lib/supabase/client` → `createClient()`
  - Server components / route handlers: `@/lib/supabase/server`
- UI: Tailwind + shadcn/ui components under `@/components/ui/*`, `sonner` for toasts,
  `lucide-react` for icons
- **Edge middleware lives in `src/proxy.ts` and exports `proxy()`** — NOT `src/middleware.ts`
  exporting `middleware()`. This is the Next.js 16 convention. Do not "restore" middleware.ts.
- Tests: **vitest**, configured in `vitest.config.ts` to match **`src/**/*.test.ts(x)` only**.
  Files named `*.spec.ts` are NOT picked up by `npm test`.

Scripts: `npm run dev` · `npm run build` · `npm run typecheck` (`tsc --noEmit`) ·
`npm run lint` · `npm test` (`vitest run`)

## Absolute rules

1. **No fabricated stubs, mock services, or placeholder implementations presented as working code.**
   If something is not built, say so plainly and leave it unbuilt. A hollow shell that looks
   finished is worse than an honest "not built yet." This repo previously accumulated an entire
   fake "DDD" Order layer — empty repositories, invented entity fields, a service full of
   hardcoded mock lookups — which cost real time to untangle. Do not recreate that pattern.
2. **NEVER generate test, benchmark, validation, performance, or go/no-go reports for work you
   did not actually run.** Do not write files that assert `passed: true` without executing a real
   check. Do not write Markdown reports containing numbers you did not measure. If you ran
   something, paste its real output. If you did not run it, say you did not run it. This repo
   previously contained twelve such fabricated reports and fifteen generators that produced them.
3. **No `any` without a justifying comment.** TypeScript is strict. `Record<string, any>` for
   database rows is the most common offender here — type the shape instead.
4. **Multi-tenant: every query must be scoped by `account_id` and respect RLS.** Get `accountId`
   from `useAuth()` (client) or the session (server). RLS is enforced in Postgres via
   `is_account_member(account_id)` / `is_account_member(account_id, 'admin')`, but never rely on
   RLS alone — always filter explicitly. Realtime subscriptions must filter by `account_id` too.
5. **Reuse before create; extend before replace.** Search for an existing component, hook, or
   helper first. `@/components/ui/*`, `@/hooks/use-auth`, `@/lib/currency`, `@/lib/date-filters`,
   and the `@/components/ui/data-table` family already cover most needs.
6. **Report real command output.** Run `npm run typecheck` and `npm run build` after changes and
   paste what they actually printed — never claim a clean build you did not run.
7. **Never generate record numbers client-side** when the database already assigns them. See the
   Order schema below.

## Live code vs. dead code (read this before "improving" anything)

This repo contains a large parallel architecture that **nothing in the UI uses**. Verified by
import search:

| Path | Status |
|---|---|
| `src/app/**`, `src/components/**` (except providers) | **LIVE** — the real application |
| `src/hooks/use-auth`, `src/lib/supabase/*`, `src/lib/currency`, `src/lib/date-filters` | **LIVE** |
| `src/lib/domain/**`, `src/lib/application/**`, `src/lib/repositories/**`, `src/lib/runtime/**`, `src/lib/presentation/**` | **NOT used by any page or component** |
| `src/hooks/features/*` (`useContacts`, `useLeads`, `useAccounts`, …) | **NOT used by any page or component** |
| `src/components/providers/ApplicationProvider.tsx` | **Never mounted in any layout** |

The live pages talk to Supabase **directly** via `createClient()`. That is the working pattern in
this repo — follow it. Do not wire new features through the unused DDD layers, and do not assume
those layers work just because they compile. `@nozbe/watermelondb` and `src/lib/runtime` are part
of that unused stack; the web app does not use offline storage.

If you think a piece of dead code should be removed, propose it — do not delete it silently.

## Database — real schema (verified against production)

Multi-tenant. `account_id` on almost every table. RLS via `is_account_member(account_id, role)`.

### Customers live in `contacts`

There is no `customers` table. A customer is a row in `contacts`.

- The **company/firm name is the primary identifier** (`contacts.company`); `contacts.name` is the
  contact *person*. The lead-conversion RPC `convert_lead_to_customer` maps
  `lead.name → contact.company` and `lead.contact_person → contact.name`.
- `contacts.hierarchy_level` (integer, nullable) holds the customer's distribution tier. It is
  meaningful only when hierarchy is enabled, and its values map by **position** into
  `accounts.settings.order_settings.levels` — a JSON array of `{ position, name, color }`
  configured in Settings → Order. Level 1 is the top of the chain.
- **`leads` has NO `company` column.** Lead fields are `name`, `contact_person`, `whatsapp`,
  `email`, `source`, `status`, `industry`, `address`, `city`, `state`, `country`,
  `latitude`, `longitude`, `is_converted`, `converted_contact_id`, `collaborator_id`.
  Selecting `company` from `leads` throws Postgres error `42703`.

### Orders

Tables: `orders`, `order_items`, `order_statuses`, `order_dispatches`, `dispatch_items`,
`order_custom_values`. Defined in `supabase/migrations/068_orders_module.sql`.

- **Order and dispatch numbers are assigned server-side by triggers** —
  `trg_set_order_number` → `ORD-0001`, `trg_set_dispatch_number` → `DSP-0001`, both drawing from
  `account_sequences`. **Never generate these client-side.** Insert without the number field and
  let the trigger fill it.
- **`orders.status` is free TEXT holding the status *name*, not a foreign key** to
  `order_statuses.id`. As of migration 086 it is governed by a **state machine** (see "Order
  status lifecycle" below), not the `order_statuses` config rows — those still drive the list
  filter options but not the legal transitions. Keep this in mind before changing status handling.
- **`orders.classification`** (`'direct' | 'primary' | 'secondary'`, CHECK-constrained, defaults
  to `'direct'`) is currently **written by nothing** — no application code and no trigger sets it.
  Every order is `'direct'` today. The hierarchy feature is configured in Settings and rendered as
  a badge, but nothing computes the value in between. Do not assume it is populated.
- **An order can link to `contact_id`, `lead_id`, OR `site_visit_id`** (all nullable). Current UI
  only resolves contact and lead; `site_visit_id` is stored and indexed but never joined, so
  visit-originated orders display as "Unknown".
- `order_items` carries `tax_rate`, `tax_amount`, `sub_total` and `total`. The current detail page
  ignores tax.
- **Order creation/editing UI exists**: `src/components/orders/order-form.tsx` (create + edit,
  edit via `update_order`), the list at `orders/page.tsx`, and the detail view at
  `orders/[id]/page.tsx`. Orders are also created from the mobile field app.
- **Order detail layout** follows the house module pattern (see the lead detail page): a header
  card + a two-column body with **Details / Dispatches / Summary tabs on the left** and the shared
  `<Timeline>` on the **right** (never stack the timeline full-width at the bottom). There is no
  reusable `Tabs` component; the order page uses a small inline tab switcher.
- **`/print/order/[id]`** is the print/PDF template, mirroring `/print/quotation/[id]`. It is also
  the source the **mobile** app renders to a PDF for sharing (`PdfService`). Its header pulls
  `accounts.business_name/phone/gst_number` if those columns exist (blank otherwise).
- **Order activity logging**: `create_order`/`update_order` do NOT log, so the client logs
  `order_created` / `order_edited` via `logModuleActivity` (`order-form.tsx`); the detail view logs
  `order_dispatched` when a dispatch is recorded; `update_order_status` logs `order_status_changed`
  server-side. Orders created before this logging existed have no backfilled history.
- **GOTCHA — never embed the acting user on `module_activities`.** `module_activities.user_id` FKs
  **`auth.users`, not `profiles`**, so `select('*, user:profiles!module_activities_user_id_fkey(...)')`
  fails and returns NO rows — silently hiding the whole timeline. Fetch activities plainly, then
  enrich with a separate `profiles` query keyed by `user_id` (see the lead + order detail pages).
- **Tasks can link to an order**: `tasks.order_id` (nullable FK → orders, ON DELETE SET NULL;
  migration 087). `TaskForm` exposes it via the "Order" option in "Linked To"; the order detail's
  `<Timeline>` pre-selects the current order and shows tasks linked to it.

### Dispatch module (migration 088)

- **First-class module** (not just an order sub-panel): list `/dispatches`, detail
  `/dispatches/[id]`, create/edit via `<DispatchForm>` at `/dispatches/new` (accepts
  `?orderId=`) and `/dispatches/[id]/edit`, print at `/print/dispatch/[id]`, sidebar entry under
  CRM. The order detail's "Create Dispatch" routes to `/dispatches/new?orderId=` (the old inline
  dialog is gone) and dispatch rows link to the dispatch detail.
- **A dispatch belongs to ONE order.** Lines are that order's items **capped at remaining qty**;
  **prices are inherited from the order line, read-only** (dispatch_items has no pricing columns).
  `order_dispatches` gained `dispatch_code/invoice_no/invoice_date/lr_no/lr_date/
  transport_contact_no` (migration 088).
- **Timeline/tasks/logs**: `'dispatch'` is in the `<Timeline>` union; `tasks.dispatch_id` links
  tasks to a dispatch (TaskForm "Dispatch" option); create/edit log `dispatch_created` /
  `dispatch_edited` to `module_activities` (module_name `'dispatch'`). Same auth.users-embed
  gotcha applies — enrich activities via a separate profiles query.
- **Status is derived from delivered-vs-ordered** (migration 089): a trigger
  `sync_order_dispatch_status` on **`dispatch_items`** (INSERT/UPDATE/DELETE) recomputes the order
  — none delivered → `Approved`, some but not all items fully shipped → **`Part Dispatch`**, all
  fully shipped → `Dispatched`. It runs under `app.order_status_system` (permission-exempt) but the
  enforce trigger still validates the transition, so `order_status_transition_allowed` whitelists
  the new pairs (Approved→Part Dispatch, Part Dispatch→Dispatched/Approved/Cancelled/Rejected,
  Dispatched→Part Dispatch/Approved). The old `trg_lock_order_on_dispatch` on `order_dispatches`
  was dropped (it fired before line items existed). `locked_at` is still set once anything ships.
  `'Part Dispatch'` is a first-class status string (badge maps on web + mobile).
- **Dispatch events are mirrored onto the order timeline**: create/edit log to both
  `module_name='dispatch'` and `module_name='order'` (with `details.dispatch_id` +
  `dispatch_number`); the shared `<Timeline>` renders any activity carrying `details.dispatch_id`
  as a link to the dispatch **view** (`/dispatches/<id>`).
- **Mobile parity**: the mobile order detail has Details/Dispatches/Summary tabs; a read-only
  mobile dispatch detail (`app/dispatch/[id].tsx`) with PDF share exists.
- **Pending Dispatch** (`/pending-dispatch`, own menu item): lists orders whose status is
  `Approved` or `Part Dispatch` (status is the source of truth for "not fully dispatched") with
  Ordered/Delivered/Difference totals, search/filter, a per-row Dispatch action, and row-click to
  the order.
- **Order statuses are no longer configurable**: the Statuses tab was removed from Order Settings
  (only Hierarchy remains) and the orders-list status filter uses a fixed status list. The
  `order_statuses` table still exists but nothing reads it for the lifecycle.
- **Still unresolved: mobile PDF share (order + dispatch) points at the stale `wacrm.vercel.app`**
  — needs the real production domain wired as a config value.

### Order status lifecycle (migration 086, applied to prod)

- **State machine** (defined in SQL, enforced two ways): `Pending → Approved | Rejected |
  Cancelled`; `Approved → Dispatched (auto only) | Rejected | Cancelled`; `Dispatched`,
  `Rejected`, `Cancelled` are terminal. Legacy `'Placed'` rows were migrated to `'Pending'`.
- **`update_order_status(p_order_id, p_new_status)`** (SECURITY INVOKER) is the only supported
  path from the app: it checks `has_permission(..., 'manage_order_status')` (→ 42501), validates
  the transition (→ 23514 check_violation), updates, and logs `module_activities` with action
  `'order_status_changed'` + a message. The web detail view calls this RPC; **never write
  `orders.status` directly** (the list page's old direct-write dropdown was removed).
- **Trigger backstop** `enforce_order_status_transition` rejects illegal *and* unpermitted raw
  writes too, so a client that bypasses the RPC still can't cheat. System transitions set
  `app.order_status_system='1'` (transaction-scoped) to exempt themselves.
- **Dispatch auto-advances status**: `lock_order_on_dispatch` sets `status='Dispatched'` +
  `locked_at` on the first dispatch (exempt via the system flag). So "Create Dispatch" is the only
  way to reach Dispatched — the detail view shows that button only when `status='Approved'`, and
  there is no manual "Dispatched" transition button.
- **`has_permission(p_user_id, p_account_id, p_key)`** (SECURITY DEFINER) is the SQL mirror of the
  client `hasPermission`: owner/admin/superadmin bypass, else `employee_roles.permissions->>key`,
  with `action_*` wildcard support. Reuse it for any server-side permission gate.
- **`manage_order_status`** is a permission key in the roles editor (`team/roles/page.tsx`).

### Site visits are polymorphic

`site_visits` carries **both** a legacy `contact_id` (real FK → `contacts`) **and** a polymorphic
pair `target_type` / `target_id` (no FK, no CHECK). `target_type` values in production are the
capitalised strings `'Customer'` and `'Lead'`.

**PostgREST cannot embed the polymorphic side** — `site_visits` has no foreign key to `leads`, so
`.select('*, leads(name)')` fails. Resolve lead targets with a **separate query** keyed by
`target_id`. `src/app/(dashboard)/location-tracking/visits/page.tsx` does this correctly; copy it.

### Pricing (Orders Phase 1, applied 22 Jul 2026 — verified against production)

- **`tax_slabs`** (`id`, `account_id`, `name`, `rate`, `is_default`, `position`) — account-scoped
  configurable rates, same lookup pattern as `order_statuses`. Call it **tax**, never GST.
- **`product_categories`** (`id`, `account_id`, `name`, `level`, `parent_id`) — Configurable up to 3 levels tree hierarchy (names defined in `accounts.settings.product_settings.level_X_name`).
- **`product_units`** (`id`, `account_id`, `name`, `short_name`) — Configurable unit settings.
- **`products`** has NO `tax_rate` column and never did. The rate comes from
  `products.tax_slab_id → tax_slabs.rate`. FK `products_tax_slab_id_fkey` exists, so PostgREST
  can embed `tax_slabs(rate)`. It also contains `category_id` and `unit_id` linking to their respective configurable tables.
- `products.min_price` — hard floor; no stack of discounts may cross it. NULL = no floor.
- `order_items` gained `catalogue_price`, `price_list_price`, `scheme_discount_amount`,
  `discount_type`, `discount_value`, `discount_amount`, `order_discount_share`,
  `is_scheme_goods`, `scheme_id`. `orders` gained `order_discount_type/value`,
  `discount_total`, `pricing_status`, `expected_total`, `pricing_variance`, `locked_at`.
- **`price_lists`, `price_list_items`, `schemes`, `scheme_slabs`, `scheme_products`,
  `scheme_customers` exist but nothing reads them yet** (Phases 3 and 4).
- **`calculate_order_pricing()` is the single source of truth for order money.** Sequence is
  FIXED, not configurable: catalogue → price list → scheme → salesman discount → price floor.
  A configurable order would mean every order must store the whole active configuration or its
  price could never be explained later. Do not reintroduce configurable ordering.
- **Quoted price wins.** When the server disagrees with what a salesman promised, it records its
  own figure in `expected_total`/`pricing_variance` and sets `pricing_status='review'` for an
  admin to judge. It never overwrites the promised price.
- Whole-order discounts are allocated **pro-rata across lines** (`order_discount_share`), not
  held at the header, so each line's tax reduces correctly.
- `src/lib/pricing/` holds an **advisory** TypeScript mirror for live totals and offline entry.
  It is not authoritative. `fixtures.ts` pins it to the SQL; `sql-parity.md` records the last
  verified run. Change one side and you must change and re-verify the other.

### Pricing (Orders Phase 2, applied 24 Jul 2026 — verified against production + REST)

- **⚠️ pg_safeupdate landmine — read before writing any RPC that mutates.** Supabase runs
  `pg_safeupdate` on the PostgREST/`authenticated` connection: **any UPDATE or DELETE without a
  WHERE clause is rejected** (`"DELETE requires a WHERE clause"`, SQLSTATE 21000). It is NOT active
  for the superuser/service role, so a function with an unqualified DELETE/UPDATE passes every SQL
  and dry-run test yet fails the moment a real browser calls it via REST. `calculate_order_pricing`
  hit exactly this (unqualified `DELETE`/`UPDATE` on its temp table) — invisible until the order
  form became its first REST caller. Fix: qualify with `WHERE true`. **Always test a mutating RPC
  through the real endpoint (`curl .../rest/v1/rpc/<fn>` with the anon key → expect 200, not 400),
  not just SQL.** Audit any new function for unqualified writes.
- **`create_order` / `update_order` RPCs** write header + items in one transaction, priced through
  `calculate_order_pricing`. `create_order` is idempotent via an EXPLICIT existence check — NOT
  `ON CONFLICT` (that fires the order-number trigger and burns a number on every retry). Deleted
  customer/product on an offline sync are DETACHED (ref→NULL) + `pricing_status='review'`, never
  rejected. `update_order` is blocked once `orders.locked_at` is set (first dispatch, via trigger
  `trg_lock_order_on_dispatch`).
- **Tax inclusive/exclusive is stored PER LINE:** `order_items.tax_mode` ('exclusive' default |
  'inclusive'), carried on each line in `p_lines` like `locked_price`. An edited order keeps old
  lines on their original basis and prices only new lines on the current one — a single
  order-level value can't represent a mixed order. Account default: `order_settings.tax_mode`.
  Exclusive: price is pre-tax, tax added on top. Inclusive: price contains the tax, backed out as
  `net = price/(1+rate)`, `tax = total − net` (penny-perfect so it reconciles to the displayed
  inclusive price). In both, stored `sub_total`=net, `tax_amount`=tax, `total`=tax-inclusive total.
  `engine_version` is now 2. Each line's output also carries `rate_incl_unit` (per-unit rate with
  tax, in the price's own basis) for the order-form display columns.
- **Per-line amount discount is PER UNIT** (`value × quantity`, capped at the line), consistent
  with percentage. The **whole-order** amount discount stays ONE amount across the order (not per
  unit).
- **Two independent discount settings, both freely changeable, NOT locked or stored per order**
  (unlike tax mode): `order_settings.discount_mode` = off|item|order|both (SCOPE — where a discount
  applies) and `order_settings.discount_value_type` = percent|amount|both (TYPE — how it's
  entered). The order form renders only the enabled input(s); 'both' shows a %/₹ toggle that's
  mutually exclusive (picking one clears the other), per-line and whole-order. Changing these only
  governs FUTURE orders — past orders already stored fixed values.
- **Order permissions:** flat keys `add_orders`, `edit_orders`, `apply_order_discount` in the roles
  editor. Creation is UI-gated + RLS-tenancy, not RPC-permission-gated (consistent with the app).
- **Classification** (computed in `calculate_order_pricing`, stored on `orders.classification`):
  hierarchy off → direct; on + level 1 → primary; on + level >1 → secondary; on + NO level →
  direct ("not known yet", deliberately not secondary).
- **The TS mirror is now at engine v2 (done 26 Jul 2026 — prerequisite satisfied).**
  `src/lib/pricing/calculateOrderPricing.ts` now has the inclusive-tax branch + `rate_incl_unit`
  + per-line `taxMode`, matching the SQL (083/084) exactly, and `engine_version` is 2. Five
  inclusive fixtures were added and the whole 20-case suite was re-verified against production
  (rolled back) — SQL and TS agree field-for-field; see `src/lib/pricing/sql-parity.md`
  (26 Jul 2026 section). The inclusive floor check compares against the **inclusive** per-unit
  price (effective unit derived from the native amount, not the net) — mirror that if you touch
  it. Web is unaffected either way (it calls the SQL RPC live, not the mirror).
- **Order Sync Health page (built 26 Jul 2026):** `src/app/(dashboard)/orders/sync-health/page.tsx`
  — a read-only, **admin/owner-only** monitor reached from a "Sync Health" button on the Orders
  page header (shown only to admins). It lists orders flagged `pricing_status='review'` (with their
  `pricing_variance` reasons) and the `pricing_drift_log`. **It only shows SERVER-SIDE signals** —
  orders that reached the DB. Orders permanently stuck unsynced on a rep's phone live in that
  device's local queue and are NOT visible here; reporting those up to the server is a logged
  follow-up ("Report mobile dead-letters to server"), which will need a new table + prod migration.
- **Order editing (Phase 3 Step 1, built 26 Jul 2026):** `order-form.tsx` gained an edit mode
  (`orderId` prop) reached from an **Edit** action on the Orders list, gated on `edit_orders`
  (create still gates `add_orders`; discounts `apply_order_discount`). Key `update_order` facts
  (verified from the SQL, migration 083):
  - `update_order` now takes an optional **`p_contact_id`** (migration 085, applied 26 Jul 2026).
    Passing it changes/re-attaches the customer through the RPC: it runs the **same dispatch-lock
    check** AND **validates the customer belongs to the order's account**, inside the one
    transaction, before pricing recomputes classification. NULL = leave the customer unchanged. The
    edit UIs pass the selected `contactId` on every save — one audited path, no direct write.
    ⚠️ **Why the migration existed:** the earlier direct `orders.contact_id` write bypassed the
    lock (RLS `orders_update` is only `is_account_member(account_id)` — no `locked_at` check, no
    trigger) and didn't validate the new contact's account. Do NOT reintroduce a direct write.
    Migration 085 also DROPs the old 4-arg `update_order` (overloads make PostgREST ambiguous).
  - It does **not** auto-preserve existing line prices — it passes `p_lines` to
    `calculate_order_pricing`, which honors a per-line `locked_price` only if the client sends one.
    So the edit form loads each existing line and sends its stored `price_list_price` as
    `locked_price` + its stored `tax_mode`; new/re-attached lines omit `locked_price` → current
    catalogue price (founder's re-attach decision).
  - `locked_at` (set on first dispatch) makes `update_order` reject the WHOLE edit
    (`RAISE … ERRCODE 'check_violation'` = 23514) — no partial post-dispatch edit. The form shows a
    read-only "dispatched" message instead of a form.
  - Only one review path: a floor-breaching edit sets `pricing_status='review'`. The form blocks
    save on a floor breach (like create), so from the UI an online edit is succeed-or-reject.

**APPLIED IN PRODUCTION — `076_customer_level_enforcement.sql` (verified live 26 Jul 2026,
correcting the earlier "NOT YET APPLIED" note).** Live now: trigger
`trg_enforce_contact_hierarchy_level` (BEFORE INSERT OR UPDATE on `contacts`) raises
`check_violation` when `order_settings.hierarchy_enabled = true` AND `hierarchy_level IS NULL`,
and `convert_lead_to_customer` is the two-arg `(p_lead_id uuid, p_hierarchy_level integer DEFAULT
NULL)`. ⚠️ **The warned trap is now LIVE:** on the primary account hierarchy is ON and 6 of 8
contacts have a NULL level, so those 6 are **un-editable from either app** until a customer-level
picker exists on the contact forms (web AND mobile). That picker is a product decision, not yet
made — do not add it silently. Reads/pricing don't trip the trigger; only saving a null-level
contact does.

### Other tables

`leads` (+ `lead_sources`, `lead_statuses`, `lead_industries`, `lead_notes`, `lead_custom_values`),
`tasks`, `module_activities` (generic audit feed keyed by `module_name` + `record_id`, powers
timelines), `products`, `quotations`, `expenses`, `geofences`, `tracking_sessions`,
`location_pings`, `profiles`, `accounts`, `custom_fields` (shared across modules via
`module_name`), `account_sequences`.

### Settings Hub & Account Configuration (Applied 27–28 Jul 2026 — verified against live UI)

- **Flat "All Settings" Hub (`/settings`)**:
  - Replaced the legacy scrolling sidebar/tabbed menu with a responsive 10-tile grid (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6`) in `settings-overview.tsx`.
  - **Profile Settings** (`/settings?tab=profile`): Consolidated Personal Information (avatar, display name, email), **Appearance mode** (`AppearancePanel`: light/dark/system theme), and **Default currency** (`DealsSettings`) into one unified page.
  - **Standardized Settings Names**:
    1. `Profile Settings` (Personal Info + Appearance + Currency)
    2. `Custom fields & tags` (`FieldsAndTagsPanel`)
    3. `Leads Settings` (`LeadsSettings`)
    4. `Task Settings` (`TasksSettings`)
    5. `Orders Settings` (`OrdersSettings`)
    6. `Catalogue Settings` (`PricingSchemesSettings`)
    7. `Expense Settings` (`ExpenseTypesSettings`)
    8. `API Settings` (`ApiKeysSettings`)
    9. `Security` (`SecurityPanel`)
    10. `Audit Log` (`AuditLogPanel`)
  - **Removed from Settings Hub**: Knowledge Base (AI), Templates, and Team are removed from the account settings hub (managed under their respective main menu modules or dedicated routes).

### Universal Custom Fields (Applied 26–27 Jul 2026 — migration `096` & `097`)

- **Section Grouping & Display Priority (`096_custom_fields_sections_priority.sql`)**: `custom_fields` supports `section_name` (e.g. `'Basic Information'`, `'Technical Details'`) and `priority` (integer ordering).
- **All-Modules Custom Values (`097_all_modules_custom_values.sql`)**: Universal custom fields architecture implemented across all core CRM entities (`lead`, `contact`, `product`, `quotation`, `order`, `dispatch`, `task`, `expense`, `employee`).

### Dynamic Table Columns & Required Field Enforcement (Applied 28–29 Jul 2026)

- **Centralized Admin Schema Governance (Admin vs Developer Rule)**: Admin Settings (`/settings` → Custom Fields) is the **exclusive** authority for defining custom fields. Module pages (`contacts`, `leads`, etc.) no longer display inline "+ New Field" modal creation buttons. Admins alone govern:
  - **Required (`is_required`)**: Whether users MUST provide a value before saving a record.
  - **Show in Table (`show_in_table`)**: Whether a column for this field is dynamically added to the module's main data table.
  - **Sortable (`is_sortable`)**: Whether the dynamically added table column allows ascending/descending sorting.
  - **Filterable (`is_filterable`)**: Whether global search matches against this field's value.
- **Dynamic Table Column Injection (`appendCustomFieldColumns`)**: `src/lib/custom-fields.ts` exports `appendCustomFieldColumns(columns, customFields, data)`. Every module's data table (`Contacts`, `Leads`, `Products`, `Pipelines/Deals`, etc.) invokes this to dynamically append columns where `show_in_table = true` with proper formatting and sorting.
- **Required Field Enforcement (`validateRequiredCustomFields`)**:
  - `CustomFieldsSectionRenderer` automatically renders a red asterisk (`*`) next to field labels when `field.is_required = true`.
  - Client-side validation (`validateRequiredCustomFields(customFields, customValues)` in `src/lib/custom-fields.ts`) is executed inside `handleSubmit` / `handleSave` across **all** modules (`Contacts`, `Leads`, `Quotations`, `Tasks`, `Expenses`, `Deals`, `Orders`, `Dispatches`, `Products`). If any required active field is empty, submission is blocked with a descriptive sonner error toast.

### Global UI Design System & Spacing Guidelines (Web)

- **Full Screen Width for Forms & Panels (`w-full`)**: Do NOT use narrow wrappers (`max-w-2xl`, `max-w-xl`) or constrained centered containers on create, edit, view, or settings screens. All main screens and settings forms must use full screen width (`w-full` / `max-w-[95vw]`).
- **Multi-Column Responsive Grids**: To prevent empty/wasted white space on the right-hand side of large desktop monitors, arrange form fields, settings toggles, and metadata panels in responsive multi-column grids (`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-6` or `gap-8`).
- **Dropdowns: why some opened UP and some DOWN.** `SelectContent` used to default
  `alignItemWithTrigger` to `true`, which positions the popup so the SELECTED ITEM sits over
  the trigger — for a value low down a long list the popup opens upwards over the field. The
  default is now `false` (plain dropdown below the trigger) and `align` is `"start"`. Changed
  globally in `src/components/ui/select.tsx`; pass `alignItemWithTrigger` explicitly if a menu
  ever wants the old behaviour.
- **Native `<select>` is the other half of that inconsistency.** A native select renders a
  BROWSER dropdown: it opens whichever way the browser chooses, cannot be styled, and has no
  search. ~50 remain across ~20 files (automation-builder 10, monthly-planner 6, product-form 5,
  deal-form 3, custom-fields-manager 3, …). Convert to the house `<Select>` — or
  `<SearchableSelect>` when the list can grow past ~20 rows (employees, customers, products).
  `<AsyncSearchSelect>` exists for lists in the thousands.
- **A page's TITLE comes from the route map in `src/components/layout/header.tsx`, not from
  `<PageHeader>`.** `PageHeader` deliberately `return null`s when it has no `actions`, `badge`
  or `breadcrumbs` — a title+subtitle alone renders nothing at all. A new page with no entry in
  that map falls back to its parent prefix, which is why the Leaves page showed only "Location
  Tracking". Add `"/module/sub": "Title"` there.
- **`<DialogContent>` has a `size` prop that defaults to `"sm"` (`sm:max-w-sm`).** Because that
  is a RESPONSIVE variant, tailwind-merge does not treat it as conflicting with a base
  `max-w-[1400px]`, so hand-rolled width classes are silently ignored above 640px. Use
  `size="full"` for a genuinely wide dialog, or the house form width `sm:max-w-3xl`
  (`lead-form.tsx`, `contact-form.tsx`) — note the `sm:` prefix is what makes it win.
- **Detail views are PAGES, not dialogs.** Order, Lead and now Leave all use
  `<module>/[id]/page.tsx` with a header, a two-column body, and the shared `<Timeline>` on the
  right. A dialog has nowhere to put tasks or history.
- **Base UI `<Select>` renders the raw VALUE unless you pass `items`.** `Select.Value` does NOT
  derive a label from the `<SelectItem>` children. Give `Select.Root` an `items` map
  (`Record<value, label>`, e.g. `Object.fromEntries(rows.map(r => [r.id, r.name]))`) whenever the
  value differs from what should be shown, or the trigger displays a bare uuid / enum key. Shipped
  broken once on the leave form (employee picker showed a uuid, weightage showed "quarter").
  `expense-types-settings.tsx` has the working precedent. Known remaining wart: the Expense
  allowance-type select shows "REGULAR"/"TRAVELLING" for the same reason.
- **Adding a Settings panel takes THREE registrations, not two.** `settings-sections.ts`
  (SETTINGS_SECTIONS + SECTION_META) and the `panel` map in `settings/page.tsx` only make
  `/settings?tab=<id>` *reachable*. Nothing navigates there: the Settings menu is a hardcoded list
  inside `src/components/layout/sidebar.tsx`. Miss that third step and the panel exists but is
  invisible — which is exactly what happened with Leave Settings.
- **Base UI / Next.js Hydration & Button Nesting Rule**: When using `@base-ui/react` components such as `DialogTrigger`, use the `render={<Button />}` prop pattern instead of `asChild` wrapping a `<button>` or `<Button>` child. Using `asChild` with an inner button causes an HTML `<button> cannot be a descendant of <button>` validation error and React 19 hydration mismatch.

### Territory Master (migrations 101–105, applied to prod 2026-07-31 — verified)

New foundational geography module (dependency for future Route Management). Replaces the flat
`contacts.country/state/city/area` text columns with a configurable per-account hierarchy.
Surfaced under **Settings → Territory** (a full-width `TerritoryManager` with a "Manage
territories" tree tab + "Hierarchy & assignment" config tab) — NOT the main sidebar.

- **Config reuses the `accounts.settings` jsonb pattern** (like `order_settings`):
  `accounts.settings.territory_settings = { levels: [{position,name,enabled}] (1–5), assignment_mode: 'area_wise'|'direct' }`.
  Default: Country/State/City enabled, Area/Sub Area disabled, mode **`area_wise`** (founder
  change; the client normalizers + the `territory_assign_employee_areas` coalesce fallback all
  default area_wise — migration 105). **Seed is India-only** (not the full ISO country list —
  founder change): `seed-data.generated.ts` ships `SEED_COUNTRIES=[India]`.
- **`territories`** — adjacency list (`parent_id` self-FK), `level int` (= the enabled level
  position), `status` enum(`active|inactive|archived`), `is_seed_data`, `deleted_at` (soft
  archive). Unique **partial** index `(account_id, coalesce(parent_id,'0…'), lower(name)) WHERE
  deleted_at IS NULL` → duplicate names rejected under the same parent, allowed under different
  parents, reusable after archiving. `set_updated_at` trigger uses `update_updated_at_column()`.
- **`employee_area_assignments`** — `(employee_id→profiles.id, territory_id→territories.id)`,
  unique `(employee_id, territory_id)`.
- **`contacts` gained `territory_id` (nullable FK, ON DELETE RESTRICT) + `needs_territory_review`
  boolean.** The legacy `country/state/city/area` columns are **kept but deprecated** (NOT
  dropped) — hidden from the Customer form + list when the Territory module is on.
- **RLS**: select = `is_account_member(account_id)`; writes = `is_account_member(account_id,'admin')`;
  assignments select = admin OR `employee_id IN (select id from profiles where user_id=auth.uid())`.
  ⚠️ the spec's `employee_id = auth.uid()` was wrong for this schema (employee_id is profiles.id,
  not the auth user id) — translated in the policy.
- **RPCs (all SECURITY DEFINER, admin-gated, WHERE-qualified for pg_safeupdate, return jsonb):**
  `territory_archive(id,force)` (subtree soft-delete, blocks on attached contacts/assignments
  unless force), `territory_restore(id)` (blocks if parent archived), `territory_delete(id)`
  (hard delete only if childless+unattached), `territory_assign_employee_areas(employee_id,
  ids[])` (**area-wise: rejects a 2nd employee on a taken area** — founder decision Q1),
  `territory_update_settings(account_id,levels,mode,confirm)` (**disabling a level with data
  archives it, requires confirmation** — Q2), `territory_migrate_contact_geo(account_id)`
  (idempotent, **case/space-insensitive** name match, unmatched → `needs_territory_review`, never
  auto-creates territories — Q3), `territory_bulk_seed(account_id,countries,states,districts)`
  (idempotent seed). **Seed is India-only** (founder decision 2026-07-31): only India is
  preloaded as a country + its 28 states/8 UTs + 762 LGD-current districts; the full ISO 3166-1
  list stays in the pinned `supabase/seed-data/territory-seed.json` for reference but is NOT
  seeded (`generate-territory-seed.mjs` hard-codes `SEED_COUNTRIES=[India]`). Admins add other
  countries manually via the tree. Shipped as the dynamically imported generated
  `src/lib/territories/seed-data.generated.ts` (Q4).
- **Module toggle**: `territory` key added to `accounts.module_settings` (Module Settings page)
  + `ModuleSettings` type + `/api/account/module-settings` `CONFIGURABLE_MODULES`. Defaults `true`.
- **Surfaced under Settings → Territory, NOT the main sidebar** (founder decision): the settings
  section renders `<TerritoryManager />` (an inline "Manage territories" tree tab + "Hierarchy &
  assignment" config tab). The `/territories` route still exists for deep-linking but has no menu
  entry. `settings-overview.tsx` has the tile; `settings-sections.ts` registers the `territories`
  section.
- **Employee Area Assignment** (`employee-area-assignment.tsx`) has a search box and **cascade
  selection**: checking a parent selects its whole subtree (parent shows indeterminate on partial).
- **Client data layer**: `src/lib/territories/api.ts` (direct-Supabase reads + RPC wrappers;
  `getTerritoryRows` paginates past the 1000-row cap — the seed alone is 1047). Page:
  `src/app/(dashboard)/territories/page.tsx`; tree `components/territories/territory-tree.tsx`;
  CSV import `territory-import-dialog.tsx` (hand-rolled `parseCsv`, no papaparse); employee
  assignment `employee-area-assignment.tsx`; contact cascade `territory-picker.tsx`.
- **Not offline on mobile** — read-only cache only (see CLAUDE mobile.md).

### Leave Management v1 (migrations `20260817170000_leave_management` + `20260817170500_leave_working_days_backfill`, applied to prod 2026-08-17 — verified)

Spec: `docs/engineering/specifications/leave-management-v1.md`. Rollback:
`supabase/migrations/ROLLBACK-leave-management.md`. Built by Claude Code, not Antigravity.

**Tables (all RLS-enabled, `account_id`, `update_updated_at_column` triggers):**
- `leave_types` — admin-configured, `status` Active/Inactive (defaults **Active** on insert),
  `color`. Unique on `(account_id, lower(name))` so "Casual Leave" and "casual leave" cannot
  coexist. `ON DELETE RESTRICT` from `leaves`, so a used type must be deactivated, not deleted.
- `holidays` — **SUPERSEDED the same day by holiday lists (see the section above)**: a holiday now
  belongs to a `holiday_list_id`, not to the account. **No recurring flag on purpose**: Diwali/
  Holi/Eid move every year and a recurring rule would silently generate wrong dates.
- `leaves` — the request header. `leave_number` `LV-YYYY-NNNNNN` via `account_sequences.leave_seq`
  + `trg_set_leave_number` (copied from the payment numbering — **never generate client-side**).
  Format is `LV-000001`; the year was dropped by `20260817180000`.
  `reason` is `NOT NULL` with a non-blank CHECK: the mandatory-reason rule lives in the DB, not in
  three separate forms (the payment `require_*` lesson). `applied_by` distinguishes self-service
  from admin-on-behalf; `is_backdated` marks a past-date entry.
- `leave_days` — **one row per calendar day**, carrying `weightage`
  (`full|first_half|second_half|quarter`), `day_value` (1/0.5/0.5/0.25) and a **denormalised**
  `account_id`/`employee_id`/`status`. That denormalisation is deliberate: the attendance page asks
  "who is on leave on this date" for a whole month and answers it with one index hit and no join,
  and RLS is checked without a subquery into `leaves`.
- **The overlap guard is a partial unique index**, not app logic:
  `UNIQUE (employee_id, leave_date) WHERE status IN ('Pending','Approved')`. Rejected and Cancelled
  rows are kept for the record and stop reserving the date.
- `status` on `leave_days` is mirrored from the parent by `sync_leave_days_status()`
  (**SECURITY DEFINER** — the parent update was already authorised; re-deriving it per child row
  would mean an approving manager also needed write rights on `leave_days`).

**RPCs (all SECURITY INVOKER, WHERE-qualified for pg_safeupdate):** `create_leave_request`,
`update_leave_status`, `update_leave_request`. Plus helpers `account_working_days`,
`leave_eligible_dates`, `leave_day_value`, `leave_status_transition_allowed`, `write_leave_days`.
- **Why RPCs at all** when the rest of the app inserts directly: four rules cannot live in a form —
  the past-date restriction, expanding a range into day rows, the overlap message, and the audit
  entry. Mobile writes to tables directly, so a validation that exists only in React does not exist.
- `create_leave_request` **recomputes the eligible dates server-side and rejects a mismatch**, so a
  stale client holding an old holiday list cannot book a holiday as leave. It is also idempotent on
  a client-supplied `p_leave_id` (a replay returns the same row and burns no leave number).
- Transitions: `Pending → Approved|Rejected|Cancelled`, `Approved → Cancelled`. Nothing else.
- **Approver = admin OR `approve_leaves` OR `is_in_downline(caller, employee)`** — reuses migration
  106's traversal, no new recursion. A non-admin **cannot approve their own leave**; an owner/admin
  can, because a single-admin account would otherwise deadlock, and the log records
  `self_approved: true`.
- Audit trail reuses **`module_activities`** (`module_name = 'leave'`) — no new table. Actions:
  `leave_applied` / `leave_approved` / `leave_rejected` / `leave_cancelled` / `leave_edited`.
  ⚠️ `module_activities.user_id` FKs **auth.users, not profiles** — the same embed trap as orders;
  fetch plainly and enrich with a separate profiles query (`src/lib/leave/api.ts` does this).

**Permission keys** (flat, owner/admin bypass via `has_permission`): `view_leaves`, `manage_leaves`
(apply on behalf / backdate / edit others), `approve_leaves`. **Enforced server-side in the RPCs**,
not UI-only — deliberately stricter than the rest of the app, because approving your own leave is
exactly the action a hidden button does not protect. Not yet in the roles editor UI.

**Web surfaces:** Settings → **Leave Settings** (`leave-types-settings.tsx`: types + the holiday
calendar); Organisation Settings gained **Working Days**; Location Tracking → **Leaves**
(`location-tracking/leaves/page.tsx` — DataTable, status tabs, apply/edit dialog, detail sheet with
the full history and Approve/Reject/Edit/Cancel). Client layer: `src/lib/leave/api.ts`.

**Attendance integration (`src/lib/location/attendance-status.ts` — shared code, 132 location tests):**
- New statuses `on_leave` / `holiday` / `weekly_off`, new flag `worked_on_leave`.
- **Only APPROVED leave is ever passed in.** A pending request must not turn a red Absent green.
- No sessions + full-day leave → **On Leave**. No sessions + PART-day leave → still **Absent**, with
  the leave as a second badge — the other half was owed and nobody turned up; calling that On Leave
  would hide a real no-show.
- Part-day leave **moves the goalposts rather than removing them**: first-half leave shifts the
  expected start to the shift midpoint, second-half shifts the expected end back, and expected
  minutes scale by `1 - day_value`. So a 13:30 arrival on first-half leave is no longer Late Start,
  but a 15:00 arrival still is. A quarter day carries **no position** (there is no "which quarter"),
  so it reduces the hours owed and suppresses Early Leaving rather than guessing.
- A shift worked on a **holiday or weekly off is not judged at all** — there is no shift that day,
  so Late/Early/Short would be measured against a window that does not apply.
- A holiday **wins over leave** approved before it was declared (edge case: an admin adds a holiday
  later). The approved leave record is left untouched rather than silently rewritten.
- Monthly tab: `leave` and `holidays` were **hardcoded `0`** and are now real; `absent` is
  `workingDays − present − leaveDays`, floored at 0 and rounded (half days sum in 0.5 steps).

**🔴 Fixed a real pre-existing bug: the working week was hardcoded Monday–Friday**
(`location-tracking/attendance/page.tsx`, `getWorkingDays` skipped `getDay() 0 and 6`). For the
six-day companies this product sells to that understated Total Days by ~4/month and overstated
presence. It now reads `accounts.settings.tracking_settings.working_days` (int array, 0=Sun…6=Sat,
**default Mon–Sat**), normalised by `normalizeTrackingSettings` and counted by the new
`src/lib/location/working-days.ts`. **This changes numbers already on screen.** A zero-day week is
refused in both the normaliser and the Settings toggle — it would make every date a weekly off and
wipe out every Absent and every leave day at once.

**⚠️ Migration bug found by verification, worth remembering:**
`jsonb_set(settings, '{tracking_settings,working_days}', …, create_missing => true)` only creates
the **final** key — it cannot create a missing intermediate object, so 15 of 17 accounts were
silently skipped. The fix (`20260817170500`) merges with `||` at each level. **Never assume
`jsonb_set` will build a nested path.**

**Mobile:** `app/leaves/index.tsx` (list, search by leave number + type, filters on from/to date,
weightage, type, status), `app/leaves/new.tsx` (apply), `app/leaves/[id].tsx` (detail + withdraw),
Menu tab entry, and `app/punch.tsx` gained an "Apply for leave" secondary action plus an
approved-leave warning before punching in. Service: `src/services/LeaveService.ts`.
- **Applying is ONLINE ONLY and deliberately NOT wired into SyncEngine.** The overlap check can only
  run server-side; a queued request that syncs days later and is then rejected leaves the rep
  believing they are approved and not turning up. Leave is planned work, not an urgent capture like
  a punch-out. READS are cache-first (AsyncStorage, last-known-good), so the list and the type
  picker still paint with no signal — only the write is gated, with `showAppDialog` (never a toast:
  an error that fades is an error the rep does not see).
- The punch-in leave check **fails open**: an error or a timeout lets the punch proceed. Blocking
  attendance because a leave lookup failed would be far worse than a missing warning.

**Deliberately NOT built (v1):** leave balances / quotas / accrual / carry-forward; paid-vs-unpaid;
notifications (WhatsApp is blocked anyway — zero approved templates, 10 of 13 profiles have no
phone); multi-level approval; two different leave types on the same day (blocked by the overlap
index); offline apply; a leave report in the generic report engine.

**Correction to this document:** the updated-at trigger function in this repo is
`update_updated_at_column()`, **not `set_updated_at()`** as stated elsewhere here.

### Holiday Lists — weekly offs and holidays are PER EMPLOYEE (migration `20260817180000_holiday_lists`, applied to prod 2026-08-17)

Supersedes the single account-wide holiday calendar and the single account-wide working week that
`20260817170000_leave_management` shipped hours earlier. **Reason (founder):** a company's field
staff and its office staff routinely have different weekly offs AND different holidays. One
company-wide week could not express that.

- **`holiday_lists`** — `name` (unique per account, case-insensitive), `weekly_offs INT[]`
  (the days OFF, 0=Sun…6=Sat, default `{0}`), `is_default`. CHECK refuses a seven-day weekend
  (it would make every date a weekly off and wipe out every absence and every leave day at once);
  partial unique index enforces exactly one default per account.
- **`holidays.holiday_list_id`** (NOT NULL, cascade) — a holiday belongs to a list, not an account.
  The old `(account_id, holiday_date)` unique became `(holiday_list_id, holiday_date)`.
- **`profiles.holiday_list_id`** (nullable) — NULL means "follow the account's default list", so a
  new employee always has a calendar and nothing needs backfilling when a list is added.
- **Resolution lives in SQL:** `employee_holiday_list(profile_id)` and
  `employee_working_days(profile_id)` (0..6 minus the list's weekly offs).
  `leave_eligible_dates` was DROPPED and recreated taking an **employee id**, not an account id —
  same signature, so it was dropped deliberately rather than silently rebound. `write_leave_days`
  passes the employee through. `account_working_days()` is gone.
- **Verified in a rolled-back transaction (10/10):** an unassigned employee follows the default;
  an assigned one gets their list's week; a colleague is unaffected; the SAME date range yields
  different eligible days for two employees on different lists; a rep whose list works Sundays can
  book a Sunday while their own Tuesday off is refused; seven-day weekend and two-defaults both
  rejected by constraints.
- **Web:** `holiday-lists-manager.tsx` — full-width list panel (add / clone-with-holidays /
  rename / delete / make-default), weekday "Set Weekend" chooser, month calendar with
  prev/next/today, click any date to name a holiday, and an assign-to-employees dialog.
  Reached via Settings → Leave Settings → **Holiday Lists** tab.
  `resolveEmployeeCalendars(accountId)` in `src/lib/leave/api.ts` returns every employee's
  working days + holidays in a fixed number of queries — the attendance page needs a whole month
  of employees and must never go one-query-per-person.
- **`computeAttendanceDay` gained an optional `workingDays` input** that overrides
  `settings.working_days`, so the engine stays pure while each employee is judged against their
  own week.
- **The Working Days control was REMOVED from Organisation Settings** (it had shipped hours
  earlier) — two places setting the same thing would silently disagree with the lists. The card
  now points at Holiday Lists. `accounts.settings.tracking_settings.working_days` is still read
  and written back **verbatim** as the last-resort fallback; the settings save deliberately
  preserves whatever was loaded rather than writing a default.
- **Mobile:** `fetchWorkingDays(accountId, employeeId)` / `fetchHolidays(accountId, employeeId)`
  resolve the rep's own list. Their AsyncStorage caches key on the **employee**, not the account —
  on a shared handset two reps must not inherit each other's weekly offs.
- **Leave numbers dropped the year** (founder decision): `LV-000001`, not `LV-2026-000001`.

### Reporting Hierarchy (migration 106, applied to prod 2026-07-31 — verified)

Who-reports-to-whom, reusing the pre-existing (previously empty, **undocumented**)
`profiles.manager_id` self-FK. Foundation for Route Management + "Team" data scope.

- **`profiles.manager_id`** (uuid, self-FK, `ON DELETE SET NULL`) = Reporting Manager — was
  already in the schema, unreferenced in code, 0 populated. Reused directly (no new column for it).
- **New: `profiles.default_approver_id`** (uuid, self-FK, `ON DELETE SET NULL`) — optional
  explicit approver.
- **Module toggle** `reporting_hierarchy` in `accounts.module_settings` — **defaults OFF**
  (unlike the others, which default on). The normalizers in `use-auth.tsx` and
  `/api/account/module-settings` special-case it to `false` when the key is absent. Backfilled
  on existing accounts by migration 106.
- **4 SECURITY DEFINER functions** (the single source of truth for chain-walking; used by RLS
  later): `get_reporting_chain(id)` (managers upward, nearest→top), `get_all_reports(id)`
  (direct+indirect reports downward), `is_in_downline(mgr,target)` (RLS-friendly bool),
  `get_approver(id)` (**default_approver → first ACTIVE manager up the chain → NULL**; skips
  inactive per founder Q2). All grant EXECUTE to authenticated only.
- **Cycle prevention:** `prevent_manager_cycle()` + trigger `trg_prevent_manager_cycle`
  `BEFORE INSERT OR UPDATE OF manager_id ON profiles` — SECURITY DEFINER (can't be defeated by
  RLS visibility), raises `check_violation` (23514) on direct or indirect loops. Enforced at the
  DB, not just the UI.
- **Web**: module card in `module-settings.tsx`; a **Reporting** card on the Employee Master
  Details tab (`components/reporting/employee-reporting.tsx`, view-first + Edit) with manager +
  default-approver pickers; client wrappers in `src/lib/reporting/api.ts`
  (`updateEmployeeReporting` maps 23514 → friendly "cycle" result). The expense detail shows a
  **display-only** "Suggested approver" line when the module is on and the expense is Pending —
  **any admin can still approve** (founder Q1 = suggestion, NOT enforced; no expenses RLS change).
- **Scope note:** `rbac.ts` already defines `DataScope` incl. `"team"` and the roles editor
  offers it, but `getDataScope()` is consumed by **zero** query pages today — "team" is currently
  unenforced. This pass ships the primitives (`get_all_reports`/`is_in_downline`); wiring `team →
  get_all_reports` into each module's queries is a deliberate separate per-module step.
- **`department`/`designation` are NOT dormant** (spec claimed they were): they have live
  Employee Master fields and `designation` drives expense rate tiers (`expense-form.tsx`). Left
  untouched, but the "dormant" premise is wrong.
- Mobile: read-only "who approves my expense" only (see CLAUDE mobile.md).

### Employee role model — unified (2026-07-31)

There is now **one** role concept in the UI: the **Employee Role** (`employee_roles`, granular
`permissions` jsonb). The old separate "System Account Role" dropdown was removed from all
employee create/edit screens.

- **`account_role`** (owner/admin/agent/viewer) is still the **security primitive** — every RLS
  check (`is_account_member(account_id,'admin')`) and `useAuth` gate depends on it. It is NOT
  removed; it is now **derived, not hand-picked**: on create/edit, an Employee Role whose
  `permissions.all === true` sets `account_role='admin'`, otherwise `'agent'`. The account
  **Owner** is never demoted (`account_role='owner'` is preserved).
- Employee creation posts to **`/api/team/employees`** (service-role, creates the auth user +
  upserts the profile with the derived `account_role`). The old `new/page.tsx` posted to a
  **non-existent** `/api/admin/employees/create` — that was broken and is now fixed.
- `team/roles/page.tsx` no longer hard-locks a role named "Admin" — all roles are fully
  renameable/editable/deletable. The **Full Access** toggle (`permissions.all`) is what makes a
  role's members admins.
- **Designation removed** from employee UI (column kept, dormant). Expense rate tiers now key on
  **`expense_rate_tiers.employee_role_id`** (already existed) instead of `designation`
  (`expense-types-settings.tsx` + `expense-form.tsx`).
- Reporting Manager is an **inline field** on the Employee edit form (governed by the page's
  global Edit), not a separate card. (The `EmployeeReporting` card component was removed;
  `lib/reporting/api.ts` remains for `getApprover`/`getApproverProfile` used by the expense page.)
- UI terminology is "Employee", not "User" (DB table stays `profiles`; identifiers unchanged).

### Area/owner-based visibility (migration 107, applied to prod 2026-08-01 — LIVE RLS change)

Field employees now see only records they own or that fall in their assigned area(s).
**This changed live SELECT RLS on `contacts` and `leads`** — test before touching again.

- **`leads.territory_id`** added (nullable FK → territories). The web lead form
  (`lead-form.tsx`) now has a Territory (Area) picker, gated on the territory module.
  `contacts.territory_id` already existed. (Mobile lead form does NOT yet have the picker —
  follow-up.)
- **`employee_area_territory_ids(user_id) → uuid[]`** (SECURITY DEFINER): the user's assigned
  territories expanded to their full subtree (a City assignment covers its Areas/Sub-Areas).
- **`contacts_select` / `leads_select` RLS** now:
  `is_account_member(account_id) AND ( is_account_member(account_id,'admin') OR user_id=auth.uid()
  [OR owner_id/collaborators for leads] OR territory_id = ANY(employee_area_territory_ids(auth.uid())) )`.
  Owner/admin unaffected (see all). Verified live: on the primary account the owner sees all 10
  contacts; the "Sales Executive" agent (Rajkot) sees only the 1 Rajkot contact.
- **Blast radius:** every non-admin member across ALL accounts is now limited to own+area
  (previously saw all account records). Intended. A role that should see everything = give it
  Full Access (→ admin). `scope: team/company/all` is still not separately wired — only
  admin-vs-not + area/own today.
- Applies everywhere automatically (mobile lists, web lists, visit picker) because it's RLS.

### Route Management — Phase 1 DATABASE (migrations 108–112, applied to prod 2026-08-02 — verified)

Beat/Route management. **Module toggle `accounts.module_settings.route` defaults OFF** — when off,
zero route enforcement and free-visit mode is unchanged (verified: route RPCs raise "Route Management
is not enabled"; normal `site_visits` inserts still work). Depends on Territory Master + Reporting
Hierarchy. Spec: `docs/engineering/specifications/route-management.md` (Rev 3). **Phase 2 (web UI) not
built yet.**

- **Tables** (all RLS-enabled, `account_id`, `update_updated_at_column` triggers):
  - `routes` — `primary_assignee_id`(profiles.id, NOT "owner"), `status`
    (draft/pending_approval/active/rejected/archived), `created_by`(auth.uid()), `archived_at`,
    **`version`**(optimistic concurrency). RLS: admins see all; others see routes they created / are
    primary assignee of / are planner-assigned to. Edit/delete = admin or creator/assignee.
  - `route_customers` — `sequence`, `archived_at` (mirrors route archive). `UNIQUE(route_id,contact_id)`
    + **partial `UNIQUE(account_id,contact_id) WHERE archived_at IS NULL`** = one customer, one active route.
  - `route_plan_assignments` — the weekly Planner (salesman×ISO-weekday→route). Partial
    `UNIQUE(account_id,assignee_id,day_of_week) WHERE end_date IS NULL AND is_active` (leaves room for
    future temporary date-bounded reassignment). `assignee_id`=profiles.id.
  - `route_schedules` — DORMANT (future non-weekly patterns); no UI reads it.
  - `route_executions` (`user_id`=auth.uid(), `tracking_session_id`, unique per route/user/day) +
    `route_execution_stops` (`planned_sequence` NULLABLE = unplanned mid-round stop, `actual_sequence`,
    `site_visit_id`, `skip_reason`). Field-owned RLS (admin or own).
  - `site_visits` gained nullable **`route_execution_id`** (FK) — a completed stop CREATES a site_visit
    linked back (reuses GPS/photo/feedback). ⚠️ `site_visits.check_in_method` CHECK allows only
    `geofence_auto|manual|qr_scan` — route stops write `'manual'`.
- **All writes go through RPCs** (SECURITY INVOKER, WHERE-qualified for pg_safeupdate, idempotent via
  client ids, log to `module_activities` with typed `details`, authenticated-only — grants must
  `revoke from PUBLIC` not just anon, see migration 112). Authoring: `route_upsert`(+ `p_expected_version`
  concurrency), `route_import_customers`/`route_add_customers` (skip ineligible), `route_remove_customer`,
  `route_reorder_customers`, `route_update_status` (state machine + archive/restore), `route_clone`
  (**header only — customers not copied, one-customer-one-route makes it impossible**),
  `route_planner_set`/`_clear`/`_move` (move is atomic). Execution: `route_execution_start`
  (**client-authoritative `p_stops`** — server does not re-derive), `route_stop_add`,
  `route_stop_complete` (creates+links site_visit, validates contact exists), `route_stop_skip`,
  `route_execution_complete` (blocks pending stops unless `route_settings.execution.allow_complete_with_pending`).
  Reads: **`get_route_for(assignee,date)`** (single "today's route" resolver — future calendar/leave hook),
  `route_health(route_id)` (non-blocking score+warnings, gated by `view_routes`).
- **The single customer-eligibility rule** = `_route_contact_eligible()` (contact in-account + in the
  primary assignee's `employee_area_territory_ids`); used by upsert/import/add.
- **Config** in `accounts.settings.route_settings` (execution.skip_allowed/skip_reason_mandatory/
  out_of_sequence_allowed/allow_complete_with_pending, capacity.{max_customers,enforcement warn|block},
  validation.warn_*, approval_mode none|manager|admin). Backfilled on all accounts.
- **Permission keys** (granular, flat, owner/admin bypass via `has_permission`) not yet in the roles
  editor UI (Phase 2): view/add/edit/delete/clone/assign/approve/archive_routes,
  add/remove/reorder_route_customers, manage_route_schedule, execute_route, skip_route_stop,
  modify_route_sequence.
- **Engineering mandate:** the web UI must NEVER write route tables directly — always call these RPCs;
  no route business rule may live only in React.

## Conventions

- Route pages: `src/app/(dashboard)/<module>/page.tsx`, detail at `<module>/[id]/page.tsx`
- Components: kebab-case files exporting PascalCase components (`orders-settings.tsx` →
  `OrdersSettings`)
- Settings panels: `src/components/settings/*-settings.tsx`, registered in
  `src/app/(dashboard)/settings/page.tsx` and `settings-sections.ts`
- Sidebar nav: `src/components/layout/sidebar.tsx`, each item carrying an RBAC `module` key.
  Note `/orders` and `/quotations` currently share the key `"orders"` and cannot be permissioned
  separately.
- Money is rendered with `formatCurrency(value, defaultCurrency)` from `@/lib/currency`

## Workflow expectations

- **Use plan mode for any non-trivial task.** Show your plan and wait for approval before
  implementing.
- **STOP AND ASK** rather than assume when: the spec does not cover a case, existing code
  conflicts with the plan, you would add a dependency or a new pattern, or you would touch shared
  code affecting other features.
- **Verify against the real database before trusting a schema assumption.** Several bugs here came
  from code selecting columns that do not exist. If you can query production, query it.
- After changes run `npm run typecheck`, and `npm run build` for anything routing-related. Report
  the actual output.
- **Commit working states promptly.** The real Order module sat uncommitted and untracked for
  days, one accidental delete away from being lost.

## STANDING RULES — do these automatically, without being asked

### 1. Commit and push whenever work is verified clean

As soon as a piece of work is complete AND verified (`npm run typecheck` passes with no NEW
errors, or `npm run build` succeeds), commit it immediately with a clear message. Do not wait to
be told. Then push.

- This repo's remote is `origin` → `github.com/sumitvegad07-alt/wacrm` (branch `main`).
  Verified 22 Jul 2026 — two commits had been sitting unpushed and laptop-only.
- If no remote is configured, say so plainly and ask the founder to set one up. Never let
  "committed" imply "backed up" when the work exists only on one machine.
- Never use `git push --force` or rewrite history without explicit permission.
- If the working tree contains unrelated uncommitted changes, commit ONLY your own files and say
  clearly what you left untouched — unless the founder explicitly asks for a bulk checkpoint.
- Before a first push to any new remote, check that no secrets are tracked (`.env*` must be
  ignored; only `.env.local.example` is intentionally committed here).

### 2. Keep this CLAUDE.md up to date yourself

This file is a living document and you own it. Update it as part of your work, not as a separate
request:

- When you discover a schema fact, a broken assumption, a dead code path, or a gotcha that would
  mislead a future session — add it.
- When something documented here turns out to be **wrong or stale**, correct it.
- When you fix something listed as known debt, update or remove that entry.
- Only record things you have **actually verified** — from real code, a real query, or real
  command output. Never add a claim you inferred or assumed.
- At the end of a session, briefly tell the founder what you changed here and why.
- Commit CLAUDE.md changes along with the work (see rule 1).


# PART 2: MOBILE APPLICATION RULES & GUIDELINES

# CLAUDE.md — WACRM Mobile (wacrm-mobile)

This file loads at the start of every Claude Code session. It is the source of truth for how
this project is built and how you must work in it. Read it fully before writing any code.

## What this project is

WACRM = multi-tenant B2B SaaS: WhatsApp CRM + Field Force Tracking. This repo (`wacrm-mobile`)
is the **React Native / Expo mobile app** (Android now, iOS planned). The web admin is a
separate repo (`wacrm-web`, Next.js). Backend is **Supabase (Postgres + Auth + Storage +
Realtime + RLS)** — shared by both.

## Tech stack (do not deviate without asking)

- Expo ~57, React Native 0.86, Expo Router (file-based routing under `app/`), TypeScript strict
- Local: `@react-native-async-storage/async-storage` (NO SQLite/WatermelonDB on mobile —
  WatermelonDB exists only in the web repo; do not assume it here)
- Backend calls: `@supabase/supabase-js`
- UUIDs: `expo-crypto` `Crypto.randomUUID()` — the ONLY UUID method; never add another lib
  or a Math.random polyfill
- Navigation: **Tabs is the primary shell** (`app/(tabs)/`). A `(drawer)` group still exists
  for some secondary screens reached via the Menu tab, but Tabs is the entry point
  (`app/index.tsx` → `/(tabs)/home`). Drawer uses `expo-router/drawer`, NOT
  `@react-navigation/drawer` (that import breaks on SDK 56+).

## Absolute rules (violating these is how the app has broken before)

1. **Never send an empty string `''` to a uuid column.** Send `null`. This exact bug
   ("invalid input syntax for type uuid: ''") broke Lead saving. Optional uuid FKs
   (`converted_contact_id`, `collaborator_id`, `user_id`, etc.) must be `null` when empty.
2. **All data writes go through `SyncEngine.enqueueMutation`** (`src/core/SyncEngine/`), never
   a direct `supabase.from().insert()` in a screen. This is what makes the app work offline.
   The **only** correct reference is `app/visit/select-contact.tsx` (client `Crypto.randomUUID()`
   → `enqueueMutation` with a correct `result.type` check). Do NOT use Contacts create/edit as
   a reference (it has placeholder-UUID and `result.isSuccess` bugs), and do NOT use
   `src/services/VisitService.ts` — it is orphaned (zero imports) and broken (passes
   `dto.targetId` as the entity id, omits `id`/`account_id`/`user_id` despite `account_id`
   being NOT NULL, writes `photo_url` when the real column is `visit_photo_url`, and its
   `findAll`/`findById`/`search` are empty stubs).
   — mirror those.
3. **Offline-first is mandatory.** Every create/edit must work in Airplane Mode: optimistic
   local success, queued, synced on reconnect. Use client-generated `Crypto.randomUUID()` so
   offline records have stable IDs that survive sync. Test mentally: "what happens if the user
   taps this with zero signal?"
4. **No `any` without a justifying comment.** TypeScript strict. Run `npx tsc --noEmit` and
   report the real result — never claim a clean compile you didn't run.
5. **Multi-tenant: every query respects `account_id` + RLS.** Realtime subscriptions must
   filter by `account_id`.
6. **Reuse before create; extend before replace.** Search for an existing component/service/
   hook first. Don't rebuild what exists.
7. **Never run `npm audit fix` / `npm audit fix --force`** — it previously downgraded the
   whole Expo SDK and broke the project. Use `npx expo install` for dependencies (keeps SDK 57
   compatibility).
8. **Do not report placeholder/"stub" code as complete.** If something is a placeholder, say
   so plainly. A hollow shell that looks done is worse than an honest "not built yet."

## Database — real schema (verified against production)

Multi-tenant, `account_id` on almost every table, RLS via `is_account_member(account_id, role)`.

**Leads:**
- `leads`: `id` (uuid auto), `account_id` (req), `user_id` (nullable uuid), `name` (req),
  `source` (text, default 'organic'), `status` (text, default 'new'), `industry`, `address`,
  `whatsapp`, `email`, `is_converted` (bool), `converted_contact_id` (nullable uuid),
  `city`, `state`, `country`, `latitude` (numeric), `longitude` (numeric), `contact_person`,
  `collaborator_id` (nullable uuid), `created_at`, `updated_at`
- Dropdown source tables (load these; do NOT use free-text or hardcode): `lead_sources`,
  `lead_statuses`, `lead_industries` — each has `id`, `account_id`, `name`, `color`.
  Real values: sources = Google Ads/Meta Ads/Reference/Sign up; statuses = New/Hot/Qualified/
  Follow-up/Contact in future/Disqualified; industries = SAAS/E-commerece[sic]/Healthcare
- `lead_notes`, `lead_tags`, `lead_custom_values`, `lead_custom_values`

**Field Force:**
- `tracking_sessions`: `id` (uuid, client-generatable), `account_id`, `user_id`, `started_at`,
  `ended_at`, `device_id`, `end_reason`, punch/odometer photo + reading columns
- `location_pings`: **`id` is `bigint identity` (server-assigned) — NOT uuid, never
  client-generate this one**; `account_id`, `session_id`, `user_id`, `lat`, `lng`,
  `accuracy_m`, `speed_mps`, `battery_pct`, `recorded_at` (set at capture time), `received_at`
- `site_visits`: `id` (uuid), `account_id`, `user_id`, `contact_id`, `task_id`, `geofence_id`,
  check_in/out times + coords, `notes`, `visit_photo_url`, `feedback_type`, `feedback_text`
- `expenses`, `expense_types`, `employee_devices` (status enum: pending/active/rejected/
  inactive — scopes by `profile_id`, NOT account_id), `geofences`

**Tasks/Activities:**
- `tasks`: has real FKs incl. `lead_id`, `contact_id`, `deal_id`, `assigned_user_id`,
  `account_id` — link a task to a lead via `lead_id`
- `module_activities`: generic audit feed (`module_name` + `record_id`) — powers timelines

**RPCs:** `compute_daily_distance(user_id, date)` (Haversine over pings — note: no accuracy
filtering, a known gap); `set_updated_at`, `redeem_invitation`.

## Offline sync — current real state

`SyncEngine` (`src/core/SyncEngine/`, `SyncQueue.ts` → AsyncStorage, `ConflictResolver.ts`)
IS functional. `enqueueMutation`/`defaultProcessFn` are fully generic across module names (no
per-module allowlist) — so `leads` and `contacts` already flow through the same path as
`site_visits`/`activities`/`tracking_sessions`.

**`NetworkMonitor` is now REAL** (corrected 22 Jul 2026 — this entry previously said it was a
stub with `isOnline` hardcoded `true`, which is no longer true). `src/core/SyncEngine/
NetworkMonitor.ts` uses `@react-native-community/netinfo`, treats `isInternetReachable !== false`
as online, and notifies listeners on change. Verified by reading the file. On-device
reconnect→auto-flush behaviour has NOT been re-verified by anyone since; treat the wiring as
present but test it before depending on it.

**`SyncEngine.enqueueMutation` is SINGLE-TABLE only.** It does
`supabase.from(module).insert(payload)` — it cannot write a parent and its children (an order
plus its line items) atomically. For multi-table transactions use `enqueueRpc` (below).

**`SyncEngine.enqueueRpc` (built 26 Jul 2026, Orders Phase 2 Step 0).** Queues (or, when online,
runs immediately) a Postgres function call: `enqueueRpc(rpcFn, rpcArgs, clientId, { module? })`.
Idempotency is the CALLER's job — pass a stable client-generated id inside `rpcArgs` (e.g.
`p_order_id`); `create_order` checks existence before inserting, so a retried flush never
duplicates an order or burns an order number. Online it tries once so the caller gets the real
result (order number); a PERMANENT rejection is returned as `Result.validation` and NOT queued;
a transient failure falls back to the queue like `enqueueMutation`. Offline it queues optimistically
(`Result.offline`). `SyncOperation` gained an optional `kind` field (`'mutation'` | `'rpc'`);
items without it are treated as mutations, so existing flows are untouched.

**Dead-letter handling.** The old `RetryHandler` silently skipped an op forever once it hit
`MAX_RETRIES` (5) — the cause of stuck, invisible punch-in/out actions. SyncEngine now gives up
VISIBLY: after 5 transient failures, or immediately on a permanent rejection, the op is moved to
a persisted dead-letter store (`@wacrm_sync_deadletter`) instead of dropped. Transient vs
permanent is classified in `index.ts` (`isPermanentRpcError`): network/transport = transient
(retry); a Postgres SQLSTATE = permanent (except serialization/deadlock/connection codes).
Dead-letters are queryable via `syncEngine.getDeadLetterQueue()` / `subscribeDeadLetter()` and
recoverable via `retryDeadLetter(id)` / `dismissDeadLetter(id)`.

> **CORRECTED 2026-08-09.** This section previously said "Legacy mutation ops keep their exact
> old behaviour (skip-after-5)" and that the punch-in/out bug was NOT fixed. Both statements are
> now out of date: `RetryHandler` dead-letters **mutations as well as RPCs**, and the punch
> sync bug was fixed (the root cause was `enqueueMutation` always queueing when the op carried
> file uploads, so a punch never flushed until something else triggered a flush). See the
> 2026-08-07 → 2026-08-10 section below.

**Dead-letter UI (built 26 Jul 2026).** `src/components/ui/SyncFailureBanner.tsx` is a persistent
floating banner mounted once in `app/_layout.tsx`; it subscribes to the dead-letter store and,
when anything is stuck, links to `app/sync/failed.tsx` (the Failed Syncs screen: plain-language
reason, last error, Retry = re-queue with a fresh budget + flush, Dismiss = discard, confirmed).
This is device-local only. Reporting dead-letters up to the server for admin visibility is a
separate follow-up (see the web Order Sync Health note).

## Territory Master — mobile (read-only, built 2026-07-31)

Territory Master (the configurable country/state/city/area hierarchy + employee area
assignment) is **web/admin configuration data**. Mobile is deliberately **read-only** and
**NOT wired into SyncEngine** — a field rep never creates/edits the tree, they only read it.

- `src/services/TerritoryService.ts` — `fetchTerritories(accountId)` (read-only, paginated past
  the 1000-row cap), `getCachedTerritories`, `territoryPath`. **Cache-first, last-known-good in
  AsyncStorage** (`wacrm_territories_<accountId>`); the cache is overwritten **only on a
  successful fetch**, mirroring `useOrderHierarchy` — a bad network never blanks the tree.
- `src/hooks/useTerritory.ts` — paints from cache, refreshes on mount (app open); exposes
  `rows/config/getName/getPath/lastSyncedAt`. Used by `app/contact/[id].tsx` for the customer's
  territory badge.
- **Schema**: `contacts.territory_id` (nullable) is the leaf-level territory; the legacy
  `country/state/city/area` columns are deprecated (kept, not dropped). Config lives in
  `accounts.settings.territory_settings` (`{levels:[{position,name,enabled}], assignment_mode}`).
- ⚠️ **Spec Section 6 premise correction:** it justified "read-only" by claiming SyncEngine
  "only covers site_visits and timeline activities". That is **inaccurate** — this repo's
  `enqueueMutation`/`defaultProcessFn` are generic across module names (see the Offline sync
  section above). The read-only decision stands on its own merits (no field mutation use case),
  independent of that wrong premise. Do NOT add a sync/mutation queue for territories.

## Reporting Hierarchy — mobile (read-only, built 2026-07-31)

Who-approves-my-expense, read-only. Reporting Hierarchy (reporting manager + default approver
per employee) is web/admin config; mobile only reads the resolved approver — **NOT wired into
SyncEngine**.

- `src/services/ReportingService.ts` — `resolveApprover(employeeId)` (calls the `get_approver`
  RPC: default_approver → first active manager up the chain → null; cache-first in AsyncStorage
  `wacrm_approver_<id>`), `getCachedApprover`, `isReportingEnabled(accountId)` (reads
  `accounts.module_settings.reporting_hierarchy`).
- `src/hooks/useApprover.ts` — cache-first, refreshes on mount; used by `app/expense/[id].tsx`
  to show an **Approver** row on a Pending expense (falls back to "Any admin" when unresolved).
- Suggestion only — mobile never restricts who approves (matches web; founder Q1).

## Permission gating (RBAC) — mobile (2026-08-01)

Granular `employee_roles.permissions` keys are enforced **in the UI on mobile** — the DB RLS
only gates at the role level (e.g. `contacts_insert` = `is_account_member(account_id,'agent')`),
so a granular right like `add_contacts` is blocked **only** by hiding/guarding the UI. Gate every
action entry point, or a revoked right does nothing.

- **`canCreate` fix (`lib/auth-context.tsx`):** roles store creation rights inconsistently —
  `add_leads`/`add_contacts`/`add_orders` but `create_task`. `canCreate(m)` now checks BOTH
  `create_${m}` **and** `add_${m}`, so `PermissionWrapper action="create"` honours `add_*`. (This
  was why removing "Add Customer" didn't stop anyone — `canCreate('contacts')` looked for
  `create_contacts` which never exists.)
- **Gated this pass** (owner/admin bypass all via `hasPermission`):
  - Customers: add FAB (`(tabs)/contacts.tsx`) + `contact/new.tsx` screen guard = `add_contacts`;
    edit button (`contact/[id].tsx`) + `contact/edit/[id].tsx` guard = `edit_contacts`. (No
    delete action exists on mobile.)
  - Leads: add FAB (`(tabs)/leads.tsx`) = `add_leads`; edit button (`leads/[id].tsx`) =
    `edit_leads`. Create/edit screens already wrapped in `PermissionWrapper`.
  - Orders: "New Order" button (`(drawer)/orders.tsx`) = `add_orders`. `order/new` already guards
    `add_orders`, `order/[id]`/edit guard `edit_orders` + `apply_order_discount`.
  - Tasks already fully gated (`create_task`/`edit_task`/`delete_task`).
- **Verified on-device 2026-08-01:** with `add_contacts` off for "Sales Executive", the Customers
  "+" FAB disappears while the Leads "+" (=`add_leads`) stays.
- **Still NOT enforced (known gaps):** the Menu tab (`(tabs)/menu.tsx`) lists ALL modules
  regardless of `view_*` — visibility, not actions; expense granular perms aren't in the web roles
  editor at all (the flat keys it edits are leads/contacts/orders/tasks/mobile). `scope: own/team`
  is not query-filtered — record visibility instead comes from the contacts/leads area RLS (see
  the web handbook's "Area/owner-based visibility").

## Known bug spotted (not fixed) — location_pings client id (2026-08-01)
Device logs show repeated `Online mutation failed for location_pings … cannot insert a
non-DEFAULT value into column "id" … GENERATED ALWAYS`. Something inserts `location_pings` with a
**client-generated `id`**, but that column is a `bigint` identity (server-assigned) — matches the
long-standing warning in this file. Pings fail online and fall to the queue. Find the insert
(likely `app/punch.tsx` / background task via `src/utils/uuid.ts`) and stop sending `id`.

## Orders module — mobile (Phase 2 Step 1, built 26 Jul 2026)

- **Create screen: `app/order/new.tsx`.** Mirrors the web order form. Customer + product picker
  (`Select`), per-line and whole-order discounts gated by `accounts.settings.order_settings`
  (`discount_mode` scope, `discount_value_type` type), inclusive/exclusive tax, strikethrough,
  price-floor block. Reached from the Orders drawer screen (`app/(drawer)/orders.tsx`, now a
  New-Order CTA + recent-orders list) and from an active **Customer** site visit
  (`app/visit/[id].tsx` → prefills `contactId` + `siteVisitId`). Lead visits don't get the
  button (an order needs a real `contact_id`).
- **Pricing is LOCAL.** Unlike web (which calls the RPC for its preview), this screen prices with
  the copied mirror in `src/lib/pricing/` so it works with zero signal. That mirror is a VERBATIM
  copy of the web source of truth — never edit it independently (see its header).
- **Quoted price always wins.** Every save calls
  `syncEngine.enqueueRpc('create_order', { …, p_source: 'offline_sync', p_client_breakdown: <local breakdown> }, orderId)`.
  Online it returns the order number; offline it queues (number assigned server-side on sync);
  a permanent rejection surfaces via `showAppDialog`. The order id is client-generated so retries
  are idempotent.
- **Permission key is `add_orders`** (flat, matching web) — NOT `create_orders`. Do not gate order
  creation with `PermissionWrapper action="create"` (that checks `create_orders`).
- **Currency** comes from `accounts.default_currency` (INR on the primary account), NOT from
  account settings JSON and NOT from `useAuth` (mobile's auth context doesn't expose it).

### Order editing — mobile (Phase 3 Step 1, built 26 Jul 2026)

- **`app/order/edit/[id].tsx`** — edit an existing order. Mirrors `order/new.tsx` (pickers,
  local pricing preview, theming) but is a **separate screen, not a shared component** — the create
  screen was under active device test, so it wasn't refactored. **Consolidating create+edit into
  one shared component is recommended follow-up.**
- **ONLINE-ONLY by design — deliberately NOT wired into `enqueueRpc`.** No connection at open or
  save shows a clear message; it never queues an edit. (Only order *creation* is offline-capable.)
- Saves via `supabase.rpc('update_order', …, p_contact_id)`. Migration 085 (26 Jul 2026) added
  `p_contact_id` to update_order — it applies the customer change inside the RPC with the same
  dispatch-lock check + a same-account validation (no more direct `orders.contact_id` write, which
  bypassed the lock). Always pass the selected `contactId`; NULL means "unchanged".
- Existing lines send their stored `price_list_price` as `locked_price` + stored `tax_mode` (keep
  agreed price/basis); new & re-attached lines omit `locked_price` → current price. Detached
  product/customer are re-attachable. Dispatched (`locked_at`) → read-only. Gated on `edit_orders`.
- Entry point: synced Orders-list rows (those with an order number) open the edit screen. A
  not-yet-synced order has no server row to edit.

### Order-flow UX overhaul (26 Jul 2026)

- **Shared catalogue picker `src/components/orders/ProductPicker.tsx`** — used by BOTH create and
  edit. One card per product (image [products.image, migration 029; placeholder when null],
  `[sku] name`, unit price, inline quantity, running line total), search + filter (filter =
  All/Only-added), per-line discount **only when `apply_order_discount` is granted**. It ONLY
  manages the caller's `lines: PickerLine[]`; ALL pricing/floor/quoted/locked_price/tax_mode/submit
  logic stays in the screens. Existing edit lines keep locked_price + tax_mode; a deleted product
  shows as a "removed — replace" card (re-attach prices at the new product's current rate).
  Model change: one line per product (no duplicate-product lines).
- **Create flow is now stepped** in `order/new.tsx`: pick customer + quantities (ProductPicker) →
  **Review** step (line items, whole-order discount, notes, totals) → **Create**. Review is a step
  within the one screen (not a separate route) to keep order state intact. The `enqueueRpc`
  create_order call is unchanged — it just fires from the review step's button now. **Edit has NO
  review** — Save Changes straight from the picker (founder's call).
- **Visit screen (`app/visit/[id].tsx`) action tiles** — `ORDER_TILES` array (extensible) renders a
  horizontal tile row on active Customer visits: **Place New Order** functional (→ `/order/new`
  prefilled), Add Dispatch / Collect Payment / Update Stock as inert **"Coming soon"** placeholders.
  Plus a **real** location indicator (live `getCurrentLocation()` fix → "Location active · ±Xm" /
  "Location off"; no exported background-tracking accessor exists, so this uses the live fix).

**Correct reference pattern for client-generated UUID + offline create (verified by reading
code):** `app/visit/select-contact.tsx` (lines ~18, 114-127) — it does `Crypto.randomUUID()`
client-side, puts it in the payload as `id`, then `enqueueMutation('site_visits','CREATE',
visitId, payload)`. **Mirror THIS, not Contacts.** Contacts create/edit (`app/contact/new.tsx`,
`app/contact/edit/[id].tsx`) actually have the same `temp-${Date.now()}` placeholder-UUID bug
and a `result.isSuccess`/`isOffline` bug (Result<T> only has `.type`) — do NOT copy Contacts.
Note: Lead's existing create/update writes already do the `result.type` check correctly, so
Lead is the better reference for *that* part.

**Known landmines found in code (avoid / clean up, don't wire up):**
- `src/dal/mappers/LeadMapper.ts:66` hardcodes `account_id: ''` — the exact empty-string-into-
  uuid bug. Unused today (only reachable via the orphaned form path below). Do not activate.
- Orphaned duplicate Lead implementation: `app/crm/[module]/form.tsx → LeadModule.ts →
  LeadService.ts → SupabaseLeadRepository.ts`. Nothing routes to it, but it's duplicate logic
  that bypasses SyncEngine (`SupabaseLeadRepository` calls `supabase.from('leads')` directly).
  **When rebuilding Leads, build on the active `app/leads/*` screens, NOT this orphaned path —
  and consider deleting the orphaned path to prevent confusion.**
- `src/utils/uuid.ts` is a hand-rolled `Math.random()` UUID polyfill, still used by
  `app/punch.tsx` for tracking_sessions/location_pings — a real violation of the
  "no Math.random polyfill" rule. Outside Lead scope, but tracked: should be swapped to
  `Crypto.randomUUID()`.

## Naming conventions

Components PascalCase `.tsx` (`EntityCard.tsx`); hooks camelCase `use*.ts` (`useLeadCollection.ts`);
services/repositories PascalCase `.ts` (`LeadService.ts`, `SupabaseLeadRepository.ts`);
Server Actions (web) camelCase from `"use server"` files.

## Known pre-existing debt (updated 22 Jul 2026 — verify before trusting)

**TypeScript errors app-wide: 1** (was ~63; the `colors.brand.*` and Contacts `Result<any>`
issues have since been fixed). The single remaining error is in `src/components/ui/Search.tsx`
(a `TextStyle` vs `ViewStyle` mismatch). **If you see more than 1 error, the extras are
probably new — do not dismiss them as pre-existing.** Re-run `npx tsc --noEmit` to confirm the
current baseline rather than trusting this number blindly.

## Workflow expectations

- Use **plan mode** (Shift+Tab) for any non-trivial task. Show your plan and wait for approval
  before implementing. Describe your approach first.
- **STOP AND ASK** rather than assume when: the spec doesn't cover a case, existing code
  conflicts with the plan, you'd introduce a new dependency/pattern, or you'd change shared
  code affecting other features.
- After changes, run `npx tsc --noEmit` and report the real output. If a full build is needed,
  `.\gradlew assembleDebug` from `android/`.
- Commit working states to git promptly (a git-revert once silently undid uncommitted
  dependency installs and cost hours — commit after each confirmed-good step).

## Schema facts the docs previously missed (verified live — trust these)

- **`leads` has NO `company` column.** Assuming it does is the exact bug that broke two mobile
  files. Lead display name is `name` (business/lead name); person is `contact_person`.
- **`site_visits` is polymorphic:** it carries legacy `contact_id` (real FK) AND
  `target_type`/`target_id` (no FK, no CHECK constraint) added by migration
  `066_polymorphic_visits.sql`. **There is no FK from `site_visits` to `leads`** — PostgREST
  cannot embed `leads(name)`; you must do a separate lookup keyed by `target_id`. The web page
  `location-tracking/visits/page.tsx` does this correctly — copy that pattern.
  Live data: 25 visits, 22 `target_type='Customer'` (21 also carry legacy `contact_id`), 3
  `target_type='Lead'` (capitalised values).
- **Check-in dual-writes `contact_id`** (added 22 Jul 2026, `app/visit/select-contact.tsx`).
  When `target_type === 'Customer'` the visit payload sets `contact_id` as well as
  `target_type`/`target_id`, because the web admin still resolves customer names through its
  `contacts(name)` embed on that column. `contact_id` is a **real FK to `contacts`**, so it must
  stay `null` for Lead targets — writing a lead id there would be rejected. This dual-write is
  deliberate and temporary; remove it only once web is fully polymorphic.
- **`contacts` DOES have a `company` column; `leads` does NOT.** Don't let the two confuse you.
  In the visit screens the display field is named `subtitle` precisely because it holds
  `contacts.company` for a customer but `leads.contact_person` for a lead.
- **Orders:** `orders`, `order_items`, `order_statuses`, `order_dispatches`,
  `order_custom_values`, `dispatch_items`. Order/dispatch numbering is server-side via triggers
  `trg_set_order_number` / `trg_set_dispatch_number` (ORD-0001 / DSP-0001) — never generate
  these client-side. `orders.status` is free text holding the status *name* (not an FK to
  `order_statuses`) but is governed by a **state machine** as of web migration 086 (Pending →
  Approved/Rejected/Cancelled; Approved → Dispatched(auto)/Rejected/Cancelled; Dispatched/
  Rejected/Cancelled terminal). Status is managed on the **web** only (`update_order_status` RPC +
  `manage_order_status` permission); the mobile detail screen shows status **read-only**.
  `orders.classification` is currently written by nothing. `orders` can link to `contact_id`,
  `lead_id`, or `site_visit_id`.
- **Order screens:** list `app/(drawer)/orders.tsx` → detail `app/order/[id].tsx` (read-only:
  items, status badge, notes, activity timeline; Edit button gated on `edit_orders` and hidden when
  `locked_at` is set; header **Share** button → PDF) → edit `app/order/edit/[id].tsx` (online-only).
  Create is `app/order/new.tsx`.
- **Share** on the order detail uses `PdfService.generateAndShareFromUrl` against the web
  `/print/order/<id>` template (same path quotations use) → renders a PDF and opens the OS share
  sheet. The print template must be **deployed** to the print host for this to work.
- **Order timeline events** are logged to `module_activities` with lowercase snake_case actions
  (`order_created`, `order_edited`, plus web's `order_status_changed`) — see the `ACTION_ALIASES`
  map in `src/services/TimelineService.ts`. Creation/edit events are logged client-side (the
  `create_order`/`update_order` RPCs do NOT log them). The detail screen reads the feed via the
  generic `src/services/ModuleTimelineService.ts` (`fetch(moduleName, recordId)`), not the
  lead-specific `LeadTimelineService`.
- **Customers are `contacts`** (no separate customers table). Customer level is
  `contacts.hierarchy_level` (integer), mapping to `position` in
  `accounts.settings.order_settings.levels`.

## Pricing schema (applied 22 Jul 2026 — Orders Phase 1, verified against production)

- **`tax_slabs`** (`id`, `account_id`, `name`, `rate`, `is_default`, `position`) — account-scoped
  configurable tax rates. Call it **tax**, never GST: this must work outside India.
- **`products` has NO `tax_rate` column.** It never did. The rate comes from
  `products.tax_slab_id → tax_slabs.rate`. `src/components/core/LineItemsEditor.tsx` used to
  select `products.tax_rate` and failed with Postgres `42703`, so its product list was silently
  always empty — fixed 22 Jul 2026. The FK `products_tax_slab_id_fkey` exists, so PostgREST
  **can** embed `tax_slabs(rate)` (verified). Contrast with `site_visits`→`leads`, which has no
  FK and cannot be embedded.
- `products.min_price` — hard price floor; no discount stack may cross it. NULL = no floor.
- `order_items` gained `catalogue_price`, `price_list_price`, `scheme_discount_amount`,
  `discount_type`, `discount_value`, `discount_amount`, `order_discount_share`,
  `is_scheme_goods`, `scheme_id`. The first four exist so a salesman can show "standard ₹100,
  your rate ₹90, ₹10 more from me" rather than one opaque number.
- `orders` gained `order_discount_type/value`, `discount_total`, `pricing_status`
  (`provisional|confirmed|review`), `expected_total`, `pricing_variance`, `locked_at`.
- **`price_lists`, `price_list_items`, `schemes`, `scheme_slabs`, `scheme_products`,
  `scheme_customers` exist but NOTHING reads them yet** (Phases 3 and 4). Do not assume behaviour
  behind them.
- **`calculate_order_pricing(account, contact, lines, order_discount, as_of)`** is the single
  source of truth for order money. Sequence is FIXED, not configurable: catalogue → price list →
  scheme → salesman discount → price floor. Price-list and scheme steps currently pass through
  unchanged and are labelled as such in the SQL.
- **Quoted price wins.** When the server recalculates and disagrees with what a salesman
  promised, it stores its own figure in `expected_total`/`pricing_variance` and flags
  `pricing_status='review'`. It must NEVER overwrite the price the customer was given.
- A TypeScript **advisory** mirror lives in `wacrm-web/src/lib/pricing/`. It exists only because
  suggestions and offline order entry cannot call the database. It is not authoritative. Both
  sides are pinned by a shared fixture suite; see `sql-parity.md` there.

**APPLIED IN PRODUCTION — migration `076_customer_level_enforcement.sql` (verified live
26 Jul 2026, correcting the earlier "NOT YET APPLIED" note here).** It is live: the function
`enforce_contact_hierarchy_level` and trigger `trg_enforce_contact_hierarchy_level` (BEFORE
INSERT OR UPDATE on `contacts`) both exist, and `convert_lead_to_customer` now has the
two-argument signature `(p_lead_id uuid, p_hierarchy_level integer DEFAULT NULL)`. The trigger
raises (`check_violation`) whenever the account has `order_settings.hierarchy_enabled = true`
AND `NEW.hierarchy_level IS NULL`.

⚠️ **The trap this note used to warn about is now LIVE.** On the primary account
(`30501611-…`) hierarchy IS enabled and **6 of 8 contacts have a NULL `hierarchy_level`** — any
edit-save of those 6 will be rejected by the trigger unless the save also sets a level. **The
mobile (and web) contact edit forms have no level picker yet**, so those customers are currently
un-editable from either app. Fixing this needs a customer-level picker on the contact forms on
both platforms (a product decision, not yet made — do not build it silently). Until then, be
aware order flows that touch a customer are fine (reads/pricing don't trip the trigger), but
editing a null-level customer is not.

**Pre-existing fragility (migration 070, not introduced by Phase 1):** `contacts.user_id` is
NOT NULL and `convert_lead_to_customer` sets it via `COALESCE(lead.user_id, auth.uid())`. One
live unconverted lead has a NULL `user_id`. In the app `auth.uid()` covers it, so this is safe
today — but a conversion run without an auth context will fail on that lead. Left as-is.

## Anti-pattern warning — fabricated work exists in this codebase

Prior agent sessions produced (a) a fake "DDD" layer for Orders describing columns that don't
exist, with empty repository methods, and (b) **fabricated test reports** — a spec file that
asserts nothing but writes `passed: true` Markdown reports, plus twelve such reports in
`validation-reports/`. Never generate reports, benchmarks, or "validation" documents for work
you did not actually execute and verify. If you cannot run something, say so plainly.


## STANDING RULES — do these automatically, without being asked

### 1. Commit and push whenever work is verified clean
As soon as a piece of work is complete AND verified (typecheck passes with no NEW errors, or a
build succeeds), commit it immediately with a clear message. Do not wait to be told. Then push
to the remote.

- If no git remote is configured, say so plainly and ask the founder to set one up — do not
  silently skip the push and imply the work is backed up when it only exists on this laptop.
- **Remote (configured 22 Jul 2026):** `origin` → `github.com/sumitvegad07-alt/wacrm-mobile`
  (private), tracking branch **`master`** — note the sibling `wacrm-web` repo uses `main`
  (`origin` → `github.com/sumitvegad07-alt/wacrm`). Don't assume the branch name is the same in
  both repos. Verified by fresh clone: 8 commits, 196 files, identical to local.
- Before the first push to a new remote, confirm no secrets are tracked. See the audit below.

## Secrets audit (performed 22 Jul 2026 — full history, not just working tree)

**Result: clean. No service-role key, and no credential file has ever been committed.**

- Searched every file ever added across all 7 commits (`git log --all --diff-filter=A`): **zero**
  `.env`, keystore, `.pem`, `.jks`, or `google-services.json` files have ever existed in history.
- **The app uses the Supabase ANON key, which is correct.** `lib/supabase.ts` hardcodes
  `supabaseUrl` + `supabaseAnonKey`; the JWT payload decodes to
  `{"iss":"supabase","ref":"gxurqwpfvfktmreqmzqb","role":"anon",...}`. The anon key is designed
  to ship in clients and is protected by RLS. **No `service_role` string appears anywhere in the
  repo or its history.** If you ever see `"role":"service_role"` in a client file, stop
  immediately — that key bypasses RLS entirely.
- **RLS verified enabled on every table** in the `public` schema, so the anon key is properly
  constrained. Three tables have RLS on but **zero policies** —
  `automation_pending_executions`, `deal_custom_values`, `task_custom_values`. That fails
  *closed* (nobody can read/write them from a client), so it is not a security hole, but those
  tables are unusable from the app until policies are added. Worth knowing if a feature
  touching deal or task custom fields ever appears broken.
- **One third-party key is hardcoded:** `ORS_API_KEY` in `lib/map-service.ts` (OpenRouteService).
  Not a Supabase credential and not an RLS concern, but it is a real quota-bearing key. Any key
  shipped in a mobile app can be extracted from the APK, so treat it as public and rely on
  provider-side restrictions/quota rather than secrecy. Rotate it if abuse appears.
- `.gitignore` previously covered only `.env*.local`, missing a plain `.env`. Extended
  22 Jul 2026 to cover `.env`, `.env.*`, service-account JSON, and Firebase config files.
- Never use `git push --force` or rewrite history without explicit permission.
- If there are unrelated uncommitted changes in the working tree, commit ONLY your own files
  and say clearly what you left untouched.
- Context: real product files (the web Order pages, `app/visits.tsx`) were discovered to have
  **never been committed** — existing only on one hard drive with no backup. That must not
  happen again.

### 2. Keep this CLAUDE.md up to date yourself
This file is a living document and you own it. Update it as part of your work, not as a
separate request:

- When you discover a schema fact, a broken assumption, a dead code path, or a gotcha that
  would mislead a future session — add it.
- When something documented here turns out to be **wrong or stale**, correct it. (This has
  already happened: the doc named a broken orphaned file as the "working reference," and
  stated a TypeScript error baseline that was off by a factor of 60.)
- When you fix something the doc lists as known debt, update or remove that entry.
- Only record things you have **actually verified** — from real code, a real query, or real
  command output. Never add a claim you inferred or assumed.
- At the end of a session, briefly tell the founder what you changed in this file and why, so
  it can be mirrored into the separate product handbook maintained elsewhere.
- Commit CLAUDE.md changes along with the work (see rule 1).

## UI primitives — AppDialog and AppToast (built 23 Jul 2026)

Replaced all 55 native `Alert.alert`/`Alert.prompt` calls app-wide (54 alerts across 15 files,
1 prompt) with two glass-styled primitives, matching the look already proven in
`app/punch.tsx`'s hand-built success modal rather than inventing a new one:

- **`src/components/ui/AppDialog.tsx`** — `showAppDialog(title, message?, buttons?, options?)`
  and `showAppPrompt(title, message?, buttons?, defaultValue?)`. Use for errors and anything
  requiring a confirm/cancel choice — **tap required, never auto-dismisses**.
- **`src/components/ui/AppToast.tsx`** — `showToast(message, options?)`. Use for success/info
  only — **auto-dismisses after ~3s, no tap**. Never use this for an error: if a failure
  vanishes on its own while the salesman is mid-conversation, he walks away thinking it saved
  and the order is lost silently.
- Both are **imperative module-level singletons**, not hooks — `src/services/PdfService.ts`
  calls `Alert.alert` from a plain class method with no React tree, which a hook-based modal
  cannot serve. If you add a new confirmation anywhere, import `showAppDialog`/`showToast`
  directly; do not reintroduce `Alert.alert`.
- Both hosts (`<AppDialogHost/>`, `<AppToastHost/>`) are mounted once in `app/_layout.tsx`.

**Bug fixed in the same pass, not just a reskin:** `Alert.prompt` (used in
`app/expense/[id].tsx` for the expense-rejection reason) **is iOS-only in React Native and
silently no-ops on Android** — this app's actual target platform. Rejecting an expense with a
reason has never worked on a real device. `showAppPrompt` fixes this.

**Two stub placeholders discovered, not fixed** (out of scope — a UI-primitive pass, not new
feature work): `app/contact/[id].tsx` `handleGeoTag`/`handleCheckIn` are real, tappable buttons
on the contact detail screen that only show a placeholder message
("Geo-Tag logic would execute here using repository updates."). Predates this change.

**Save-confirmation audit** (the founder's specific ask: "leads confirm, contacts don't" —
checked every create/edit screen, not just contacts). Found and fixed the identical gap in two
more places while migrating them:
- `app/leads/edit/[id].tsx` — online-success save had **no confirmation at all**, only the
  offline path did. Fixed.
- `app/task/[id].tsx` — same gap, same fix.
- `app/punch.tsx` and `app/visit/[id].tsx` already have their own working glass success
  modals (`successModalVisible`/`successData`) — no gap, left as-is. Worth consolidating onto
  `AppDialog`/`AppToast` later so there's one confirmation pattern instead of two, but that's a
  refactor, not a bug fix — not done now.

## Planned work — logged, not yet built

Deferred during the 23 Jul 2026 contact-form-parity pass, on the founder's explicit instruction
not to build these now:

1. **Custom fields on the mobile contact form.** Web's contact form renders account-defined
   custom fields (`custom_fields` where `module_name='contact'`); mobile's does not. This would
   be the **first** create-form-with-custom-fields on mobile — `src/hooks/useCustomFields.ts` +
   `SchemaFormRenderer` exist and are used in `app/leads/[id].tsx` (an edit/detail screen), but
   no mobile **create** form uses them yet. Genuinely new infrastructure, not a parity fix.
2. **GPS auto-capture of `latitude`/`longitude` when creating a customer.** Do NOT build web's
   manual coordinate text boxes on mobile — no field agent types coordinates. Instead, capture
   the device's GPS automatically at contact-creation time, since the salesman is physically at
   the shop. Web's own contact-form.tsx copy already claims "Coordinates are normally captured
   automatically on the mobile app during a visit" — that capture was never built. Valuable
   later for route planning and visit verification.
3. **Duplicate-phone detection on mobile**, matching web's on-blur check in
   `contact-form.tsx` (`checkDuplicate`/`findExistingContact`). Not built on mobile.

## Contact form parity (fixed 23 Jul 2026 — verified against web source and live schema)

Mobile's contact create/edit forms previously had the OLD structure from before web's contact
model changed. Brought into line:

- **Company is now the primary field** (first, required) on create, edit, the contacts list,
  and the detail header — matching web's real convention, verified from
  `contacts/page.tsx:217`: `contact.company || contact.name || "Unnamed"`. Contact Person is
  second, required. Full Address is required (new field). Area and Pincode added (new fields).
- **Fixed real data loss**: mobile tracked `state` and `country` in component state and sent
  them in the save payload, but had **no `TextInput` for either field in the JSX** — a user
  could never actually set them; they silently saved as `null` on every contact. Confirmed
  against production: all 8 live contacts had no state, no country, and no address.
- **App-level validation only, matching web — no DB constraints added.** The database has no
  NOT NULL on `company`/`address`. All 8 live contacts lack an address; a DB-level requirement
  would have locked every one of them out of editing, the same trap avoided with
  `hierarchy_level`/migration 076.
- `contacts` real columns (verified live, 22 Jul 2026 pricing-schema check plus this pass):
  `company`, `name`, `phone` (NOT NULL, the only DB-required field), `email`, `address`, `area`,
  `city`, `state`, `country`, `pincode`, `latitude`, `longitude`, `hierarchy_level`,
  `price_list_id`.

## Recent Features & Parity Updates (27–28 Jul 2026 — verified live)

### 1. Leads Mobile Updates (28 Jul 2026)
- **Leads create/edit screens (`app/leads/new.tsx`, `app/leads/edit/[id].tsx`)**: Now include **Company Name** and **Phone Number** fields, ensuring parity with the web leads schema and capturing primary B2B lead details directly on mobile.
- **Default Pipeline View**: Updated leads list (`src/components/ui/Search.tsx`, `PipelineModule`) so that leads default cleanly to the list/pipeline view with search filtering.

### 2. Order Detail & Dispatch Detail Parity (27 Jul 2026)
- **Order Detail Tabs (`app/order/[id].tsx`)**: Replaced legacy single-view order screen with a 3-tab layout matching Web: **Details**, **Dispatches**, and **Summary**.
  - **Summary tab**: Displays ordered quantity, delivered quantity, and difference per item line.
  - **Part Dispatch status badge**: Added visual styling for `'Part Dispatch'` status.
  - **Share Order PDF**: Added a share button in the order detail header that calls `/print/order/<id>` via `PdfService`, rendering the order as a PDF and opening the native OS share sheet.
- **Dispatch Detail Screen (`app/dispatch/[id].tsx`)**:
  - Built a new read-only dispatch detail screen reached by tapping any dispatch row from an order's Dispatches tab.
  - Displays dispatch header, LR number, dispatched items (with prices inherited from the order line items), activity timeline, and a share-to-PDF button using `PdfService` (`/print/dispatch/<id>`).
- **Order Activity Timeline Fix (`src/services/ModuleTimelineService.ts`)**:
  - Fixed empty order timelines caused by embedded PostgREST select on `module_activities.user_id` (which FKs `auth.users`, not `profiles`). Now fetches activities plainly and enriches them with a separate `profiles` query.

### 3. Universal Custom Fields & Schema Governance Parity (28–29 Jul 2026)
- **Centralized Admin Schema Governance**: In accordance with the core CRM directive ("Admin, not developers, should define table properties"), custom fields are managed exclusively in the Web Admin Settings (`/settings` → Custom Fields). Mobile module screens MUST NOT provide inline field creation buttons or local custom schema mutations.
- **Admin Table & Form Properties Parity**:
  - `custom_fields` metadata now includes `is_required`, `show_in_table`, `is_sortable`, and `is_filterable` (configured on Web).
  - **Required Field Enforcement on Mobile**: Mobile create/edit screens (`EntityForm` wrappers across Contacts, Leads, Orders, Visits, etc.) must inspect `is_required` for any active custom fields. When `is_required === true`, the mobile UI must display a red asterisk (`*`) next to the field label and prevent submission (via AppToast / AppDialog error) before calling `SyncEngine.enqueueMutation` if the value is missing.
  - **List View & Card Subtitles**: Where applicable, mobile list screens and entity cards should respect admin visibility flags (`show_in_table`, `is_filterable`) when displaying secondary attributes or filtering via `Search.tsx`.

### 4. Mobile UI Guidelines & Best Practices
- **Offline-First Mutation Rule**: All create/edit forms MUST submit through `SyncEngine.enqueueMutation` with a client-generated UUID (`Crypto.randomUUID()`). Never bypass `SyncEngine` for direct database inserts.
- **Form Layout & Spacing**: Keep input labels clear, provide standard keyboard types (`phone-pad`, `email-address`, `numeric`), and ensure all scroll views have proper bottom padding (`paddingBottom: 100` minimum) for safe area and sticky footer button bar clearance.
- **Visual Status & Badge Hierarchy**: Use consistent intent colors (`success`, `warning`, `danger`, `info`, `default`) for status badges across EntityCards and detail screens (e.g., `'Part Dispatch'`, `'Pending'`, `'Approved'`).
- **Required Field Indicating**: Always demarcate mandatory fields (both system-required like `company`/`name`/`phone` and admin-defined required custom fields) with an inline red asterisk (`*`).


---

# Location Trust, Distance Accuracy & Offline-First (2026-08-07 → 2026-08-10)

A single long push covering the Location Tracking module end to end, plus the app-wide
offline-first read layer. Everything here is applied to production unless stated otherwise.
**Read this before touching location tracking, distance, attendance, or the mobile data layer —
several of the decisions below are counter-intuitive and were arrived at from real field data.**

## 1. The ping pipeline was dead (root cause, fixed)

GPS pings stopped saving on **2026-07-17** and nobody noticed until this session. Cause:
`location_pings.id` is a server-assigned `bigint GENERATED ALWAYS AS IDENTITY`, and the mobile
payload was sending a client-generated `id`. Postgres rejected **every** insert.

The fix is not just removing `id` — it is `client_ping_id` (a client UUID) plus a unique index
on `(account_id, client_ping_id)`, so an offline replay is idempotent rather than duplicating.
**Never put `id` in a `location_pings` payload.**

## 2. Distance: why it was wrong, and what makes it right

Distance was summed from pings persisted every 10 minutes. At 40 km/h that is ~6.7 km between
consecutive points, and **the road actually driven between them was never recorded** — so the
straight line under-reported by 40%+ (observed: 15.67 km straight-line vs 27.9 km by road for
the same day). No post-processing recovers information that was never captured.

The fix was upstream of the maths. The OS was already delivering a fix every 30 seconds and the
background task **discarded 19 of every 20**. Those fixes are now persisted as
`location_pings.source = 'trace'`, and the OS interval was tightened to 15s (which halves
corner-cutting error; GPS is already engaged for the foreground service so this costs little
power — it is callback frequency, not radio duty cycle).

Three gates run **on the device AND again in Postgres**, so the admin-facing number is
recomputable and never depends on trusting the handset's arithmetic:

| Gate | Threshold | The lie it catches |
|---|---|---|
| Accuracy | ≤ 50 m | A vague fix could be anywhere in a large circle — invents kilometres |
| **Stationary** | step > max(15 m, both fixes' accuracy) | **The dominant error on cheap devices.** A parked phone's position wanders constantly; a day in shops fabricates km |
| Speed | ≤ 55 m/s | GPS glitch, not a car |

**The subtle part:** a step rejected by the stationary gate must NOT advance the comparison
baseline. Otherwise drift accumulates 10 m at a time and you are back where you started.

`compute_daily_distance()` (SQL) and `computeFilteredDistanceKm()` (TS) must stay behaviourally
identical. Both fixtures were verified against the live database in rolled-back transactions:
the 111.19 km parity fixture matches, and a 20-point drift fixture returns **0 in both engines**
where the old logic invented ~0.22 km.

Expected accuracy is **3–6% under a car odometer**. This has NOT been measured against a real
odometer yet — that validation is outstanding. If it lands outside 5%, the next step is
map-matching the trace to the road network (~2%), not more filtering.

## 3. Shift times must NEVER gate tracking

An earlier version of this work used the configured window to suppress background pings outside
working hours. A rep punched in at 01:26 against the default 09:00–18:00 and recorded exactly
one ping — the punch-in, which `punch.tsx` writes directly and bypassed the check. Night work
was invisible **by design**, with no indication why.

**Founder ruling: being punched in IS the signal that a rep is on duty.** An on-duty rep is
tracked at any hour. `start_time`/`end_time` are SHIFT TIMINGS used only to classify attendance;
only `interval_minutes` reaches the background task. Do not reintroduce time-based suppression.

The on/off toggle for shift timings was later removed as well (it had no honest use). `enabled`
is still **written as `true`** when saving, because APKs already in the field read that flag as
a tracking gate and would stop tracking entirely on `false`.

## 4. Attendance classification (`src/lib/location/attendance-status.ts`)

Derives Absent / Short Present / Late Start / Early Leaving / Present from shift times plus real
punch sessions. Handles night shifts that wrap past midnight, and sums **all** sessions in a day
(a lunch break makes two — counting only the first reads as Short Present).

`grace_minutes` (default 15) was added because punching in at 09:01 on a 09:00 shift would
otherwise be flagged, making the column noise.

## 5. Forgotten punch-out — closed at midnight

A rep who forgot to punch out was tracked all night, showed as Active in green indefinitely, and
made every figure for that day meaningless.

`close_stale_tracking_sessions()` runs via **pg_cron at 18:30 UTC = 00:00 IST** and closes any
shift left open, with `end_reason = 'auto_midnight'`. Sessions started **today** are skipped, so
a rep working past midnight is never cut off mid-shift by a job that runs late.

The database records an end time; **the UI deliberately shows `--`**, because the rep did not
punch out at midnight — we stopped counting, and printing 00:00 would put a time in an
attendance record that never happened. Two consequences are handled explicitly:

- **Early Leaving is suppressed** for these days. Midnight read as a clock time makes the rep
  the most extreme early-leaver in the company, every single time.
- **Short Present is suppressed.** The worked total is an artefact of where midnight fell, not
  a measurement.

The mobile side mirrors this: the punch-in day is stored in the tracking state file and the
background task stops once the local calendar day rolls over. Both sides must agree — the server
closing the record while the phone keeps pinging attaches a night of locations to a finished
shift.

## 6. `location_pings.source` — every point knows what made it

`source` ∈ `auto | punch_in | punch_out | visit_check_in | visit_check_out | trace`,
and `session_id` is now **nullable** (a visit check-in by a rep who has not punched in must be
recorded, not dropped).

Visit check-ins previously wrote GPS only to `site_visits.check_in_lat/lng`, so the most
meaningful location of the day appeared on Customer Visits and **nowhere else** — All Locations,
Track Report, Overview and the Live Feed all read `location_pings`.

**Trace rows are machine data.** They must be excluded from All Locations, the Live Feed markers,
and Tracking Health's coverage maths (counting them as coverage reports ~2000% and hides real
outages). Distance, accuracy % and mock counts DO use them.

## 7. Duplicate-key sync failures — two distinct causes

`UNIQUE (session_id, recorded_at)` on `location_pings` produced repeated Failed Syncs.

1. **Self-inflicted.** One OS callback carries one location, but the task could write both a
   trace row and a display row from that same fix — identical timestamps, second rejected. Only
   at the interval boundary while moving, which is why it looked random. **The source is now
   decided first and the fix is written once.** Nothing is lost: distance reads every row
   regardless of source, so a display ping doubles as that moment's trace point.
2. **Lost acknowledgements.** On a weak link the write lands but the response does not; the
   queue retries and hits the same constraint. `(session_id, recorded_at)` is a **natural
   idempotency key** — one device, one session, one instant, one place — so a collision there
   can only be a replay and is treated as success. Other unique violations (duplicate contact
   phone) are still surfaced.

Also fixed: the auto-ping interval slot was claimed **before** the battery read, enqueue and
health capture. Any throw burnt the slot and wrote nothing, so a run of failures read as a long
silent gap. The slot is now claimed only after the ping is queued.

## 8. Tracking Health — diagnosis, not just numbers

`tracking-health.ts` classifies each gap to a cause (`ISSUE_CATALOG` in `tracking-issues.ts`
carries the plain-English cause + a ready-to-send fix). Merged the old **Track Report** into it:
one table, every column preserved, rarely-needed ones behind Manage Columns.

`explainGap()` puts the same explanation on each All Locations row. **The snapshot it reasons
from is chosen carefully and the intuitive choices are both wrong:** on the real 2026-08-10
incident, battery saver switched ON at 13:08 (which stopped the pings) and was OFF again by
14:11 once the phone was charged. The day's last snapshot — and the last one *inside* the gap —
both say "power save off". What explains a silence is the device state when it **fell silent**,
so it takes the most recent snapshot at or before the gap starts. There is a regression test
built from this incident.

Coverage is measured against the **configured** interval. It was hardcoded to 10 minutes, which
would have reported ~33% coverage as a fault for a healthy rep on a 30-minute interval.

`LOW_COVERAGE_PCT = 60` (founder decision).

## 9. Android reality — why tracking dies

Confirmed on a Samsung Galaxy A06 (Android 16): pings landed every 10 min for ~40 minutes after
punch-in, then stopped dead for 5 hours. Location on, background permission granted, battery
saver off, battery 43% — and **the app stopped sending its own health heartbeat**, i.e. the
process was not running. That is the OS putting the app to sleep.

- `oem-battery-guides.ts` — 21 manufacturers, split into `required[]` (1 step on stock Android,
  2 on aggressive OEMs) and `ifStillStopping[]`. A rep in a shop will not work through five
  equal-looking instructions.
- `react-native-device-info` does **NOT** expose battery-optimization state. Reading it needs a
  native module; `battery_optimization_on` is honestly `null` rather than guessed.
- Product name shown to users is **OZZO**. The launcher label must match, or "find OZZO in the
  list" cannot be followed.

## 10. Offline-first reads (2026-08-10) — the architecture

The **write** path had been offline-first for a long time (SyncEngine queues every mutation).
**Reads were not.** Every screen visit went straight to the network with nothing persisted, so
weak signal meant a spinner and no signal meant a permanently empty screen.

**Caching lives in the repository layer, not in screens.** `src/dal/withOfflineReads.ts` wraps
any repository and intercepts `findAll`/`findById`. Registering a repository in
`src/dal/index.ts` is the entire integration — **this is what makes future modules offline-capable
by default**, with nothing for anyone to remember.

Behaviour is **cache-first, not network-first**: a cached answer returns immediately and a
refresh runs behind it. That is what removes the wait — on a slow link the screen no longer
blocks on a request at all. Data can be one interaction old, which is the right trade for a
field app. A failed refresh never destroys the cached copy.

Cold reads run under a **12s timeout**, because supabase-js otherwise inherits a socket timeout
of a minute or more on a stalled mobile connection. With nothing cached and no network, the read
**fails explicitly** rather than returning an empty list — an empty list reads as "this customer
has no orders".

**Three repositories are deliberately NOT cached:**

| Repository | Why |
|---|---|
| `trackingsessionRepo` | The punch screen reads it to decide Punch In vs Punch Out. A stale session is exactly the bug that had reps punching in twice |
| `deviceRepo` | Device approval is a security check; a cached "active" readmits a revoked handset |
| `locationpingRepo` | Write-only from the background task |

Supporting pieces:
- `useCachedCollection` — two-phase hook for screens that want an explicit refreshing state.
- `warmOfflineCache()` at sign-in pulls the main collections down while there is still signal.
  Cache-first only helps once something is cached; without this a rep who signs in at the office
  and drives into a dead zone finds every screen they had not already opened is empty.
- Caches are cleared on sign-out — they are written to disk on purpose, and on a shared handset
  would otherwise show the next rep the previous rep's customers.
- Writes invalidate that table's cached reads.
- **Customers** dropped from two SEQUENTIAL query rounds to one via PostgREST embeds. The old
  second round (`.in(contactIds)`) also grew its URL with the customer count and would eventually
  be rejected outright.
- **SYNC NOW** on the Failed Syncs screen re-queues every dead-lettered op plus the invisible
  live queue and flushes once. It reports what is actually left rather than a blanket "done".

**Still to convert:** `app/dispatch/[id].tsx`. `app/order/new.tsx` was already cache-first.

## 11. Roles — display vs security

There are **two parallel role systems**:

- `account_role` enum (`owner`/`admin`/`agent`/`viewer`) — **derived** from a custom role's Full
  Access flag, and referenced by **269 of 283 RLS policies**. This is the multi-tenant security
  primitive.
- `employee_roles` table — the roles an admin actually creates ("Admin", "Sales Executive").

Screens now display the **admin-created role** everywhere. `account_role` stays internal and is
never shown. **Do not attempt to delete the enum** — that is a rewrite of 95% of the database's
access control, and a mistake there is a cross-tenant data leak, not a bug.

## 12. Other fixes worth knowing

- **Tab bar under Android's navigation bar.** Expo SDK 54+ makes Android edge-to-edge mandatory.
  Hardcoding `height`/`paddingBottom` on `tabBarStyle` **overrides** the insets React Navigation
  would otherwise apply, so the gesture bar sat on the labels. Both now derive from the real
  inset. The FAB had the same bug (absolutely positioned 24 px from the bottom of the *screen*).
- **Device registration** is server-side (`device_register()` RPC). The client cannot self-assign
  status: first device = `active`, any additional = `pending`. Registration runs on sign-in AND
  on session restore.
- **`tasks.assigned_to` does not exist** — it is `assigned_user_id`. The Live Feed Activity tile
  queried the wrong column and 400'd on every load, so it was permanently 0.
- **The Live Feed "Orders" tile queried `quotations`.** It now queries `orders`, with an Order
  Amt tile from `total_amount`.
- **Live Feed selection reset every 30s.** `fetchDashboardData` read `selectedUser` from a
  closure captured when the polling interval was created (always `null`), so every poll
  re-selected the first user. Read through the state updater instead.
- **`bg-primary/10` renders fully transparent** on some elements under the current theme tokens
  while `bg-muted` paints on others. Do not rely on tinted backgrounds for an "active" signal;
  use a solid palette colour.
- **Addresses**: Nominatim's raw `display_name` includes revenue-administration units ("Rajkot
  East Taluka") and repeats the city. Addresses are composed from the structured fields in
  envelope order instead. Not switching to Google Geocoding — it bills per request and this
  fires on hover over every point of every day.
- Route line is **vivid blue at full opacity** with a white casing and direction arrows; there is
  a Swiggy-style **Play route** rider animation. Route geometry lives in
  `src/lib/location/route-geometry.ts` **specifically so it can be unit-tested** — `map-view.tsx`
  imports Leaflet, which needs a browser.

## 13. Outstanding / not done

- Distance accuracy has **not** been validated against a real odometer.
- No per-customer code exists in the schema (`accounts.customer_id` is the *tenant* id). Adding
  one is a customer-master change.
- `app/dispatch/[id].tsx` still fetches without a cache.
- The mobile repo has **no test harness** — offline-first work is verified by typecheck and a
  full Android bundle export only.
- `app.json` `version` is still `1.0.0` for every build, so `app_version` in
  `device_health_snapshots` cannot distinguish which APK a device is running.


# PART 3: ARCHITECTURE & ENGINEERING BIBLE



<!-- FILE: 01_Project_Overview.md -->

*WACRM Engineering Bible* > *Core Architecture* > *Project Overview*
[← None] | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [02_Module_Inventory →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/02_Module_Inventory.md)
---

# WACRM Engineering Bible - Project Overview

## 1. Core Identity & Market Positioning

WACRM (WhatsApp CRM & Field Force) is a multi-tenant B2B Software-as-a-Service (SaaS). It unifies inside sales, field operations, and customer support into a single operating environment.

Instead of generic CRM records, WACRM is explicitly built around two operational anchors:
1. **WhatsApp Inbound/Outbound** (Inside Sales & Support).
2. **GPS Attendance & Site Visits** (Field Agent & Field Service).

### Target Audience
- Small-to-Medium Businesses (SMBs) with hybrid workforces.
- Sales organizations requiring proof-of-visit (Odometer/Location matching).
- Service organizations deploying technicians who need to submit expenses and check-in to geofenced client sites.

## 2. Product Packaging Architecture

The system is fundamentally designed to be modular. While the code currently houses everything in a monorepo, the product packaging is defined as follows:

| Product Tier | Capability Included | Primary Persona |
|--------------|---------------------|-----------------|
| **Core CRM** | Contacts, Pipelines, Deals, Basic Tasks | Office Admin, Field Agent |
| **WhatsApp Add-on** | Shared Inbox, Meta Webhooks, Message Templates, Broadcasts | Support Agent, Marketer |
| **Field Force Add-on** | Mobile App, GPS Tracking, Punch In/Out, Geofence Visits, Expenses, Odometer Proof | Field Agent, Field Agent |
| **Automation Add-on** | Interactive Flows, Trigger-based Automations, AI Bot Knowledge Base | Operations Manager |

## 3. Monorepo Architecture Overview

### 3.1 Backend: Supabase (BaaS)
WACRM relies entirely on Supabase for backend infrastructure, bypassing a traditional Node.js API layer for most CRUD operations.
- **PostgreSQL:** The absolute source of truth. All tenant isolation is handled at the database level via Row Level Security (RLS) using `account_id`.
- **Auth:** Supabase Auth issues JWTs containing the user's ID.
- **Storage:** Amazon S3-compatible buckets handle Avatars, Expense Receipts (Odometer photos), and WhatsApp media.
- **Realtime:** Postgres changes (like new GPS pings or WhatsApp messages) are streamed to the Next.js dashboard via WebSockets.

### 3.2 Web Frontend: Next.js 16 (App Router)
Located in `c:\Users\Xitij\Desktop\wacrm`
- **Rendering:** Heavily relies on Server Components to securely query Supabase without exposing RLS logic to the client.
- **State:** React 19, avoiding global state (Redux) in favor of Server Actions and optimistic UI updates.
- **Styling:** Tailwind CSS, Shadcn UI primitives, deep dark-mode design system.

### 3.3 Mobile Companion: Expo 57 / React Native
Located in `c:\Users\Xitij\Desktop\wacrm-mobile`
- **Routing:** Expo Router (file-based routing mimicking Next.js).
- **Core Value:** Utilizes native device APIs that the web cannot access: `expo-location` (Background Foreground Services), `expo-camera` (fraud-proof odometer photos), and `expo-file-system` (offline sync queues).

## 4. The Unified Operating Loop

Every module in WACRM is designed to feed into the next step of this loop:

1. **Lead Generation:** A customer messages the WhatsApp business number.
2. **Ingestion:** The Meta Webhook (`/api/whatsapp/webhook`) creates a Contact and a Conversation.
3. **Dispatch:** An office Admin assigns a Task to a Field Agent.
4. **Execution:** The Field Agent punches in (Mobile App), starting background GPS tracking.
5. **Verification:** The Agent checks in at the customer site, uploading an odometer photo.
6. **Reconciliation:** The Agent submits an Expense claim tied to the visit distance.
7. **Closure:** The Admin reviews the route on the web dashboard map, approves the expense, and converts the Deal to Won.


<!-- FILE: 02_Module_Inventory.md -->

*WACRM Engineering Bible* > *Core Architecture* > *Module Inventory*
[← 01_Project_Overview](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/01_Project_Overview.md) | [📖 Master Index](file:///c:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [03_Database →](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/03_Database.md)
---

# WACRM Engineering Bible - Module Inventory

This document provides a high-level map of the WACRM ecosystem. 

> [!NOTE]
> **To understand the Business Rules (The "Why")**, read [23_PRODUCT_RULES.md](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md).
> **To understand the Technical Implementation (The "How")**, read [10_Module_Details.md](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/10_Module_Details.md).

## 1. Core Platform (CRM)
- **Identity & Access Management (IAM):** Tenant isolation and user authorization (`accounts`, `profiles`, `roles`).
- **Contacts:** The centralized record-keeping system (`contacts`, `custom_fields`).
- **Pipeline & Deals:** Tracking revenue potential (`leads`, `pipelines`, `deals`).

## 2. Engagement (WhatsApp Engine)
- **Inbox:** Multi-agent shared inbox communicating natively with Meta APIs (`conversations`, `messages`).
- **Broadcasts:** High-volume outbound marketing (`message_templates`, `broadcasts`).
- **Workflow Automation & AI:** Auto-replies and webhook interceptors (`automations`, `flows`, `bot_settings`).

## 3. Field Force Operations
- **Attendance & Location:** Tracking shift time and geographic movement (`tracking_sessions`, `location_pings`).
- **Site Visits:** Geofenced check-ins to prove physical presence (`site_visits`, `geofences`).
- **Expense Management:** Reimbursing employees for operations and mileage (`expenses`, `expense_types`).
- **Territory Master:** Configurable per-account geographic hierarchy (country/state/city/area, up to 5 renameable levels) + employee area assignment. The single source of truth for customer geography, replacing the flat `contacts.country/state/city/area` columns. Tables `territories`, `employee_area_assignments`; config in `accounts.settings.territory_settings` (jsonb); toggle in `accounts.module_settings.territory`. Foundation dependency for future Route Management. Migrations 101–104. (See `CLAUDE Web.md` → Territory Master for the full contract.)
- **Reporting Hierarchy:** Who-reports-to-whom, reusing `profiles.manager_id` (self-FK) as Reporting Manager + new `profiles.default_approver_id`. Provides the reusable chain-walking primitives (`get_reporting_chain`, `get_all_reports`, `is_in_downline`, `get_approver`) that back "Team" data scope and approval routing, plus DB-enforced cycle prevention. Toggle `accounts.module_settings.reporting_hierarchy` (defaults OFF). Wired into Expense approval as a **suggested** approver (not enforced). Managed inside Employee Master (no separate page). Foundation for Route Management. Migration 106. (See `CLAUDE Web.md` → Reporting Hierarchy.)


<!-- FILE: 03_Database.md -->

*WACRM Engineering Bible* > *Core Architecture* > *Database Schema & Architecture*
[← 02_Module_Inventory](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/02_Module_Inventory.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [04_API_Documentation →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/04_API_Documentation.md)
---

# WACRM Engineering Bible - Database Schema & Architecture

*Version: v1.0 | Target: Supabase PostgreSQL*

## 1. The Core Architecture

The WACRM database is entirely multi-tenant, residing in a single PostgreSQL instance managed by Supabase.

### 1.1 Tenancy & Isolation
Every table containing operational data has an `account_id` column referencing `accounts.id`.
**Row Level Security (RLS)** is enabled on almost every table.

A central PostgreSQL function dictates access:
```sql
CREATE FUNCTION is_account_member(acc_id UUID, min_role account_role_enum DEFAULT 'viewer') 
RETURNS BOOLEAN ...
```
This function checks the currently authenticated `auth.uid()` against the `profiles` table to ensure:
1. The user belongs to the requested `account_id`.
2. The user has at least the `min_role` required to perform the action.

### 1.2 Migration Flow
Schema changes are exclusively managed via sequentially numbered SQL files in `supabase/migrations/`.
*Never manually modify the production schema via the Supabase Dashboard.*

## 2. Table Blueprints (By Domain)

### 2.1 Identity & Access
- **`accounts`**: `id`, `name`, `owner_user_id`, `created_at`, `updated_at`.
- **`profiles`**: Maps `id` (references `auth.users`) to `account_id`, `full_name`, `account_role` (enum: owner, admin, agent, viewer). Includes access flags `mobile_access` and `web_access`.
- **`account_invitations`**: Stores `token_hash`, `role`, and expiration for onboarding.

### 2.2 Contacts & Custom Fields
- **`contacts`**: `id`, `account_id`, `name`, `phone` (unique per account), `email`, `created_by`.
- **`custom_fields`**: Defines dynamic schema additions (e.g., "VAT Number"). `id`, `account_id`, `entity_type` (contact, expense, lead), `field_type` (text, number, date, boolean).
- **`contact_custom_values`**: EAV (Entity-Attribute-Value) table mapping a `contact_id` to a `field_id` and storing the `value`.

### 2.3 WhatsApp Engine
- **`whatsapp_config`**: Stores Meta `phone_number_id`, `waba_id`, and `access_token`. Unique per `account_id`.
- **`conversations`**: Links `account_id` and `contact_id`. Tracks `last_message_at` and `unread_count`.
- **`messages`**: `id`, `conversation_id`, `direction` (inbound/outbound), `status` (sent, delivered, read), `message_type` (text, image, document), `content`.
- **`message_templates`**: Caches approved Meta templates for outbound initiation.

### 2.4 Field Force Operations
- **`tracking_sessions`**: The boundary of a shift. `id`, `user_id`, `started_at`, `ended_at`.
- **`location_pings`**: High-volume append-only table. `id`, `session_id`, `user_id`, `lat`, `lng`, `accuracy_m`, `battery_pct`, `recorded_at`.
  - *Note: RLS allows agents to insert their own pings, but only admins can select/read all pings for the dashboard.*
- **`site_visits`**: `id`, `user_id`, `contact_id` (optional), `task_id` (optional), `check_in_time`, `check_out_time`, `check_in_lat`, `check_in_lng`.

### 2.5 Expense Management
- **`expense_types`**: `name`, `requires_proof`, `rate_per_km`.
- **`expenses`**: `id`, `employee_id`, `type_id`, `amount`, `status` (Pending, Approved, Rejected), `odometer_start_photo`, `odometer_end_photo`.

## 3. Critical Database Functions & Triggers

### 3.1 Triggers
- **`set_updated_at`**: Attached to almost all tables. Automatically bumps the `updated_at` column `BEFORE UPDATE`.
- **Broadcast Counters**: Triggers on `broadcast_recipients` automatically increment `sent_count`, `delivered_count`, and `read_count` on the parent `broadcasts` table.
- **New User Handler**: A trigger on `auth.users` insertion creates a default personal `account` and `profile` atomically.

### 3.2 Stored Procedures (RPCs)
- **`compute_daily_distance(p_user_id, p_date)`**: Runs the Haversine formula across all `location_pings` for a user on a given day to return total KM traveled. Used to validate fuel expenses.
- **`redeem_invitation(p_token)`**: Securely hashes the input token, validates expiration, and links the authenticated `auth.uid()` to the target `account_id`.

## 4. Technical Debt & Constraints
- **Custom Fields EAV Anti-pattern:** The `custom_values` tables use the Entity-Attribute-Value pattern. While flexible, filtering/sorting contacts by custom fields is extremely slow at scale because it requires complex SQL joins. If contact volumes exceed 100k per tenant, this will require migration to a JSONB column or a dedicated materialized view.
- **Location Ping Bloat:** `location_pings` will grow massively (1 ping per 10 mins per user = ~48 pings/day/user). Need to implement partition tables or automated archiving for data > 90 days old.


<!-- FILE: 04_API_Documentation.md -->

*WACRM Engineering Bible* > *Core Architecture* > *API & Integration Architecture*
[← 03_Database](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/03_Database.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [05_Mobile_Architecture →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/05_Mobile_Architecture.md)
---

# WACRM Engineering Bible - API & Integration Architecture

## 1. Architectural Philosophy

WACRM deliberately blurs the line between Backend and Frontend. 
Because we use Supabase (BaaS), **the Database IS the primary API.**

### 1.1 Client-to-Database Direct (The 80% Rule)
For standard CRUD operations (Contacts, Tasks, Expenses), the web and mobile clients do NOT hit a REST API. 
They use the `@supabase/supabase-js` client to directly execute SQL-like queries against the database.
- **Security:** RLS (Row Level Security) ensures the client cannot read/write outside their `account_id`.
- **Performance:** Eliminates the latency of a middleman Node.js server.

### 1.2 Next.js Route Handlers (The 20% Rule)
We only create traditional REST API endpoints in `src/app/api/` when we absolutely must bypass client RLS, interact with external systems, or handle webhooks.

## 2. API Endpoint Inventory (`/src/app/api/`)

### 2.1 Webhooks
**`POST /api/whatsapp/webhook`**
- **Purpose:** Meta hits this URL whenever a customer sends a WhatsApp message or a message status changes (Delivered/Read).
- **Security:** Validates the SHA-256 HMAC signature from Meta using `APP_SECRET`.
- **Workflow:**
  1. Acknowledge receipt (Return 200 immediately to prevent Meta retries).
  2. Parse the WABA ID to find the matching `whatsapp_config`.
  3. Upsert the `contact`.
  4. Insert the `message`.
  5. Fire the AI/Automation Engine asynchronously.

### 2.2 External Public API (`/api/v1/*`)
**Purpose:** Allows customers to integrate WACRM with their own ERPs or legacy systems.
- **`GET /api/v1/me`**: Verifies the API Key.
- **Authentication:** Requires a `Bearer {API_KEY}` header. Keys are stored as hashes in `api_keys`.
- **Rate Limiting:** Currently uses an in-memory token bucket. *Tech Debt: This will fail in a multi-server deployment. Needs Redis.*

### 2.3 System Crons & Automations
**`POST /api/automations/engine`**
- **Purpose:** Scans the `automation_pending_executions` table and executes delayed actions (e.g., "Send WhatsApp message 2 days after Lead Creation").
- **Security:** Protected by a secret cron key. Called by an external cron service (like Vercel Cron or GitHub Actions) every minute.

## 3. Server Actions (Next.js 14+)

For internal Web UI mutations that require elevated privileges or complex multi-table transactions, we use React Server Actions instead of API routes.

Example: **Approving an Expense**
- The client calls `approveExpense(id)`.
- The Server Action executes in a secure Node environment.
- It bypasses RLS using the Supabase Service Role Key to verify the admin's rights, then updates the expense and creates a ledger entry atomically.

## 4. Integration Specifications

### 4.1 Meta WhatsApp Cloud API
- **Outbound Sends:** We hit `graph.facebook.com/v19.0/{PHONE_ID}/messages`.
- **Media Uploads:** Images uploaded by agents are first saved to Supabase Storage, then securely streamed to Meta's `/media` endpoint to get a Media ID, which is then sent to the customer.

### 4.2 Mapping (OpenStreetMap & OpenRouteService)
To avoid exorbitant Google Maps API costs for field tracking:
- **Geocoding:** `nominatim.openstreetmap.org` translates GPS coordinates into readable street addresses for the dashboard.
- **Routing:** `api.openrouteservice.org` draws the snapped road-path lines between an agent's `location_pings` on the web map.

## 5. Security Posture
- **Never expose the Service Role Key** (`SUPABASE_SERVICE_ROLE_KEY`) to the client.
- Always use `createRouteHandlerClient` or `createServerActionClient` in Next.js, which automatically inherits the user's secure JWT cookies.
- Do not trust API input; always validate payloads using `zod` schemas before executing DB queries.


<!-- FILE: 05_Mobile_Architecture.md -->

*WACRM Engineering Bible* > *Core Architecture* > *Mobile Architecture*
[← 04_API_Documentation](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/04_API_Documentation.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [06_Web_Architecture →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/06_Web_Architecture.md)
---

# WACRM Engineering Bible - Mobile Architecture

*Version: v1.0 | Platform: WACRM Field Force (com.wacrm.fieldforce)*

## 1. Core Technology Stack
The mobile companion app is not a replica of the Web CRM. It is a purpose-built utility for Field Agents.
- **Framework:** Expo 57, React Native 0.86.0
- **Routing:** Expo Router (File-based routing)
- **Backend Communication:** `@supabase/supabase-js` (Direct SQL queries over REST/WebSockets).
- **Styling:** React Native StyleSheets (No Tailwind on mobile to ensure maximum performance).

## 2. Directory Structure (`c:\Users\Xitij\Desktop\wacrm-mobile`)
- `/app`: The Expo Router directory.
  - `/(auth)`: Login screen.
  - `/(tabs)`: The main bottom-tab navigation (Home, Contact, Activity, Map, Expense, Profile).
  - `/punch.tsx`, `/visit.tsx`, `/expense/[id].tsx`: Stack screens pushed over the tabs.
- `/components`: Reusable UI components (Buttons, Inputs, Headers).
- `/lib`: Domain logic (`location.ts`, `storage.ts`, `supabase.ts`).
- `/constants`: Global theme definitions (`Colors.ts`).

## 3. Location Tracking Architecture (The "Crown Jewel")
The most complex part of the mobile app is the background location tracker found in `lib/location.ts`.

### 3.1 Background Execution (Android Limitations)
Android aggressively kills background apps to save battery. To survive this, WACRM uses a **Foreground Service**.
- When an agent clicks "Punch In", the app calls `Location.startLocationUpdatesAsync`.
- A persistent notification ("📍 WACRM — On Duty") is pinned to the Android status bar. This forces the OS to keep the app alive.
- *Note: This native functionality absolutely does not work in the "Expo Go" development app. It requires a true EAS development build or production APK.*

### 3.2 Polling vs Throttle Strategy
- **Polling (OS Level):** The app requests coordinates from the OS every 30 seconds (`timeInterval: 30000`) with High Accuracy. This frequent polling is required to prevent the OS from deciding the Foreground Service is idle.
- **Throttle (Database Level):** Writing to Supabase every 30 seconds would bankrupt the database. A local state manager implements a strict **10-minute throttle** (`PING_INTERVAL_MS = 600000`). Only 1 ping every 10 minutes is actually written to the `location_pings` table.

### 3.3 Offline Queueing
If the 10-minute ping fails (e.g., driving through a tunnel), the ping is serialized to `expo-file-system`. The background task automatically attempts to flush the queue upon the next successful network request.

## 4. Hardware Integrations
- **expo-camera:** Used for capturing "Selfies" during punch-in, and "Odometer" photos during site visits. Photos are aggressively compressed before upload to save bandwidth in low-signal areas.
- **expo-battery:** Battery percentage is captured during every single location ping. If an agent claims "My phone died", the Admin can check the dashboard to see the battery level at the exact time the tracking stopped.

## 5. Deployment Strategy
- **EAS Build:** `eas.json` defines `development`, `preview`, and `production` profiles.
- **Android:** Generates `.apk` for preview, `.aab` for production Play Store submission.
- **iOS:** Generates `.app` for simulator, `.ipa` for TestFlight.


<!-- FILE: 06_Web_Architecture.md -->

*WACRM Engineering Bible* > *Core Architecture* > *Web Architecture*
[← 05_Mobile_Architecture](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/05_Mobile_Architecture.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [07_Permission_System →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/07_Permission_System.md)
---

# WACRM Engineering Bible - Web Architecture

*Version: v1.0 | Platform: Web Dashboard*

## 1. Core Technology Stack
- **Framework:** Next.js 16 (App Router)
- **UI Rendering:** React 19 (RSCs - React Server Components by default)
- **Styling:** Tailwind CSS + PostCSS
- **Component Primitives:** Shadcn UI (Radix UI underneath)
- **Language:** Strict TypeScript

## 2. Directory Structure (`c:\Users\Xitij\Desktop\wacrm\src`)
- `/app`: App Router structure.
  - `/(auth)`: Login, Join, Magic Links.
  - `/(dashboard)`: The main tenant application (Contacts, Tasks, Map).
  - `/(superadmin)`: Cross-tenant administration (Billing, Companies).
  - `/api`: Webhooks, Crons, External API routes.
- `/components`: Domain-segregated components.
  - `/ui`: Generic primitives (Buttons, Modals).
  - `/contacts`, `/location-tracking`, `/inbox`: Domain-specific assemblies.
- `/lib`: Core business logic.
  - `/supabase`: Server vs Client client-initializers.
  - `/whatsapp`: Meta Graph API adapters.
  - `/ai`: OpenAI / Google Gemini adapters.
- `/hooks`: React Client Hooks (e.g., `useAuth`, `usePermissions`).

## 3. Server Components vs Client Components

WACRM strictly follows the Next.js App Router paradigm to maximize security and performance.

### 3.1 Server Components (The Default)
All `page.tsx` and `layout.tsx` files are Server Components unless explicitly marked with `"use client"`.
- **Why?** Server components can directly query Supabase using the user's cookies without exposing Row Level Security logic or API keys to the browser.
- **Example:** Fetching the list of Contacts is done directly in the `page.tsx` server component and passed as static props to a client data table.

### 3.2 Client Components
Used only when interactivity is required (Forms, Modals, Realtime Subscriptions).
- **Rule of Thumb:** Push the `"use client"` directive down the tree as far as possible. Do not wrap entire pages in client components.

## 4. Multi-Tenant Routing & State

Unlike monolithic SaaS applications that use a subdomain for tenants (e.g., `tenant.wacrm.com`), WACRM relies on Supabase Auth JWTs.

1. User logs in.
2. Supabase issues a JWT containing their `account_id` and `role`.
3. The Next.js middleware reads this cookie on every request.
4. All Server Actions and Database Queries automatically apply RLS filtering based on that `account_id`.
5. No need to pass `?account_id=123` in the URL, preventing IDOR (Insecure Direct Object Reference) vulnerabilities.

## 5. Realtime Data (WebSockets)
Certain dashboard pages require instant updates (e.g., The Shared WhatsApp Inbox, The Live Field Map).
- We utilize `supabase.channel()` within a `useEffect` hook in Client Components.
- **Warning:** Realtime subscriptions do NOT inherently trigger RLS. You must explicitly filter the channel by the user's `account_id` when subscribing.


<!-- FILE: 07_Permission_System.md -->

*WACRM Engineering Bible* > *Core Architecture* > *Permission & Security System*
[← 06_Web_Architecture](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/06_Web_Architecture.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [08_UI_Design_System →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/08_UI_Design_System.md)
---

# WACRM Engineering Bible - Permission & Security System

*Version: v1.0*

WACRM employs a dual-layer permission system. The Database enforces strict hierarchical security, while the application layer dictates user-friendly feature scoping.

## 1. System Roles (The Hard Security Layer)
Defined in `profiles.account_role`. This is a strict Enum enforced at the PostgreSQL database level via Row Level Security (RLS). 

| Role | Database Authority | Business Equivalent |
|------|--------------------|---------------------|
| **Owner** | Ultimate authority. Can bypass delete restrictions, transfer account ownership, and access billing. | CEO / Founder |
| **Admin** | Can insert/update/delete almost all operational and configuration tables within the `account_id`. | Operations Manager |
| **Agent** | Restricted to operational tables (Contacts, Tasks, Messages). Cannot modify configurations (WhatsApp Webhooks, API Keys). | Field Agent / Field Agent |
| **Viewer**| Strictly SELECT only. Cannot INSERT or UPDATE any operational data. | Auditor / Board Member |

### 1.1 RLS Implementation
Almost every RLS policy uses this core function:
```sql
CREATE POLICY "Agents can view contacts" ON contacts
FOR SELECT USING (
  is_account_member(account_id, 'agent')
);
```

## 2. Business Roles & Scopes (The Soft UI Layer)
Defined in `employee_roles.permissions` as a JSONB column. 
While System Roles determine *if* a user can write to a table, Business Roles determine *which rows* they should see in the UI.

### 2.1 Data Scopes
- **Own:** User can only see records where `user_id = auth.uid()`.
- **Team:** User can see records owned by users reporting to their `team_id`.
- **Company / All:** User can see all records across the `account_id` (Requires Admin system role).

*Security Note:* UI hiding is not security. If a user with "Own" scope uses an API tool like Postman to query the Supabase endpoint directly, RLS might allow them to see the whole table if they are an 'Agent'. True Row-level scoping must be applied in the SQL policies if strict isolation is required.

## 3. Mobile Device Approval Flow
WACRM implements MDM-lite (Mobile Device Management) features to prevent field agents from punching in on unauthorized devices (e.g., logging in on a friend's phone to fake attendance).

1. **First Login:** When a user logs into the mobile app for the very first time, the device UUID is stored in `employee_devices` and automatically marked as `Approved`.
2. **Subsequent Logins:** If the user logs out and logs in on a *new* phone, the new device UUID is logged as `Pending`. 
3. **Gating:** The mobile app detects the `Pending` state and blocks access to the Home Screen.
4. **Admin Action:** An Admin must log into the Web Dashboard (`/settings/team`) and manually approve the new device before the user can punch in.

## 4. API Key Security
- **Generation:** Only Admins/Owners can generate API keys (`/settings/developers`).
- **Storage:** Keys are hashed in the database using `pgcrypto`. The raw key is shown to the user only once.
- **Usage:** API requests must include `Authorization: Bearer <raw_key>`. The backend hashes the incoming key and compares it against the database.


<!-- FILE: 08_UI_Design_System.md -->

*WACRM Engineering Bible* > *Core Architecture* > *UI Design System & SOP*
[← 07_Permission_System](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/07_Permission_System.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [09_Future_Roadmap →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/09_Future_Roadmap.md)
---

# WACRM Engineering Bible - UI Design System & SOP

*Version: v1.0*

## 1. Aesthetic Identity
WACRM positions itself as a premium, modern SaaS. The visual identity relies on:
- **Dark Mode First:** Deep, sophisticated dark backgrounds (zinc/slate scale) by default, providing high contrast for vibrant accent colors.
- **Glassmorphism:** Subtle blurs and translucent background layers (`bg-background/80 backdrop-blur-sm`) on sticky headers and modals.
- **Micro-interactions:** Interactive elements must have clear, smooth hover states (`hover:bg-muted transition-colors`).
- **High Contrast Actions:** Primary actions (like "Punch In" or "Approve Expense") must use solid, vibrant backgrounds (`bg-primary`, `bg-green-600`) with white text. Never use outlined or low-contrast buttons for critical actions.

## 2. Web Component Library (`src/components/ui`)
We utilize Shadcn UI, which provides accessible, unstyled Radix UI primitives wrapped in Tailwind CSS. 
*Rule: Never build a raw `<button class="...">` or `<input>`. Always import from `@/components/ui`.*

### Core Primitives
- **Button:** `<Button variant="default | outline | ghost | destructive" size="sm | default | lg">`
- **Dialog (Modals):** Used for creating new records (e.g., "New Contact"). Contains `DialogHeader`, `DialogTitle`, and `DialogContent`.
- **Sheet (Drawers):** Used for complex filtering menus or deep-dive details that slide in from the right.
- **Table:** The standard data grid. Includes `<TableHeader>`, `<TableRow>`, `<TableCell>`.
- **Form:** Integrates tightly with `react-hook-form` and `zod` for automatic validation rendering.

## 3. Mobile Component Design (`wacrm-mobile`)
Mobile UI does not use Tailwind. It uses React Native `StyleSheet`.

### Mobile Rules
- **Safe Area:** Always wrap root screens in `<SafeAreaView>` to prevent UI from hiding behind notches or bottom swipe bars.
- **Keyboard Avoidance:** Any screen with text inputs must use `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>` to prevent the keyboard from obscuring the input.
- **Offline States:** Always provide visual feedback if a list is empty or failing to load due to network drops (`ActivityIndicator`).
- **Touch Targets:** Minimum height of 48px for all clickable elements to comply with mobile accessibility standards.

## 4. Engineering SOP for New Features

When a PM requests a new feature, engineers must follow this flow:
1. **Database First:** Write the `supabase/migrations/XXX_feature.sql` file. Define the table, `account_id`, and RLS policies.
2. **Types:** Run the Supabase CLI to generate the updated TypeScript types.
3. **API / Actions:** Write the Next.js Server Action or API Route.
4. **UI Assembly:** Build the View (List/Table) and the Form (Create/Edit) using standard components.
5. **Mobile Gap Check:** Determine if this feature needs to be replicated on the mobile app. (e.g., "Settings" = Web only. "Expense upload" = Mobile required).

## 5. Web Screen Layout & Spacing Rules (27–28 Jul 2026 Update)

- **Full-Width Pages:** Every create, edit, view, and detail screen globally across all modules must use full screen width (`w-full` / `max-w-[95vw]`). Never constrain main forms or tables to narrow wrappers (`max-w-2xl`, `max-w-xl`).
- **Responsive Multi-Column Grids:** To eliminate empty right-hand space on desktop displays, use multi-column responsive grids (`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-6` or `gap-8`) for forms, settings panels, and detail headers.
- **Settings Hub Navigation:** The main `/settings` hub uses a flat tile grid (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6`). Do not use nested page submenus or scrolling sidebar tabs for core settings.
- **Base UI Hydration & Button Nesting:** For `@base-ui/react` components like `DialogTrigger`, always use `render={<Button />}` instead of `asChild` with a nested `<button>` or `<Button>` child to avoid `<button>` inside `<button>` HTML validation errors and React hydration mismatches.



<!-- FILE: 09_Future_Roadmap.md -->

*WACRM Engineering Bible* > *Core Architecture* > *Technical Debt & Future Roadmap*
[← 08_UI_Design_System](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/08_UI_Design_System.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [10_Module_Details →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/10_Module_Details.md)
---

# WACRM Engineering Bible - Technical Debt & Future Roadmap

*Version: v1.0*

This document outlines the known architectural limitations and the roadmap to achieve true Enterprise scale.

## 1. Known Technical Debt

### 1.1 The EAV (Entity-Attribute-Value) Bottleneck
**Current State:** Custom fields for Contacts and Expenses are stored in `custom_fields` (the definition) and `contact_custom_values` (the values).
**The Problem:** EAV tables are notoriously slow to query. If an account has 100,000 contacts and wants to filter by a custom field "Industry = Tech", the database must perform massive, slow JOINs.
**The Solution (Roadmap):** Migrate custom data into a single `JSONB` column directly on the `contacts` table and utilize Postgres GIN indices for lightning-fast querying.

### 1.2 In-Memory API Rate Limiting
**Current State:** The public API (`/api/v1`) uses a simple Node.js memory bucket to throttle requests.
**The Problem:** When WACRM scales to multiple Next.js server instances (e.g., Vercel Edge or Docker Swarm), in-memory state is not shared. An attacker could bypass limits by hitting different instances.
**The Solution (Roadmap):** Implement Upstash Redis or Supabase Edge Functions for a globally distributed, shared rate-limiting store.

### 1.3 Location Ping Bloat
**Current State:** Every agent generates ~1 ping every 10 minutes. 100 agents = 14,400 pings/day.
**The Problem:** Within a year, the `location_pings` table will contain millions of rows, slowing down map renders and dashboard queries.
**The Solution (Roadmap):** Implement PostgreSQL Table Partitioning (by month) and set up an automated cron job to archive or aggregate pings older than 90 days.

## 2. Future Module Expansions

### 2.1 Full Offline-First Architecture (WatermelonDB)
The mobile app currently requires a network connection to read/write most CRM data (except for the emergency GPS queue). The roadmap includes replacing direct Supabase queries with a local SQLite database synchronized in the background (WatermelonDB or PowerSync). This will allow agents to operate deep in the field with zero signal.

### 2.2 Advanced Sales Force Automation (SFA)
- **Beat Planning:** Allowing admins to define a predefined route (Beat) of 10 customers to visit in a day.
- **Route Optimization:** Using OpenRouteService to calculate the most efficient driving path for the day's tasks.

### 2.3 HRMS Evolution
Currently, WACRM tracks "Tracking Sessions". This will evolve into a formal Attendance module:
- Formal Leave Requests and Approvals.
- Shift scheduling and Late Mark logic.
- Automated Payroll calculation based on verified Hours + Approved Expenses.


<!-- FILE: 10_Module_Details.md -->

*WACRM Engineering Bible* > *Deep Specifications* > *Deep Module Specifications*
[← 09_Future_Roadmap](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/09_Future_Roadmap.md) | [📖 Master Index](file:///c:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [11_Web_vs_Mobile_Gap →](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/11_Web_vs_Mobile_Gap.md)
---

# WACRM Engineering Bible - Deep Module Specifications

*This document contains the complete technical engineering specification for every module in WACRM. It is the absolute source of truth for technical implementation logic, relationships, and edge cases.*

> [!IMPORTANT]
> **Business Rules Moved**
> For Business Goals, Workflows, Conversions, and Lifecycle Rules, refer to [23_PRODUCT_RULES.md](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md). This document (10) focuses strictly on database tables and APIs.

---

## 1. Contacts Module (CRM Core)

### Technical Implementation
- **Tables:** `contacts`, `tags`, `contact_tags`, `custom_fields`, `contact_custom_values`, `module_activities`.
- **API / Hooks:** Queried natively on client via `supabase-js`.
- **Relationships:**
  - One-to-Many: `site_visits`, `tasks`, `deals`, `conversations`.
  - Many-to-Many: `tags` (via `contact_tags`).
- **Edge Cases:** 
  - *Duplicate Phones:* `contacts.phone` has a unique constraint per `account_id`. Phone numbers must be normalized (E.164) before insertion.

---

## 2. Field Force: Location Tracking & Attendance

### Technical Implementation
- **Tables:** `tracking_sessions`, `location_pings`.
- **Mobile Dependencies:** `expo-location` (Foreground Service), `expo-battery`.
- **Realtime:** Web dashboard subscribes to `location_pings` using `supabase.channel('public:location_pings')`.
- **Offline Behavior:** If mobile drops network, `lib/location.ts` queues pings in local `expo-file-system`.
- **Edge Cases:**
  - *Timer Drift:* Android OS fires location callbacks irregularly. The local 10-minute throttle explicitly ignores rapid consecutive callbacks.

---

## 3. Field Force: Site Visits

### Technical Implementation
- **Tables:** `site_visits`, `geofences`.
- **Relationships:** Links to `contact_id` and `user_id`.
- **Validation:** Check-out cannot occur without a Check-in. Check-in requires `expo-camera` permission.

---

## 4. Expense Management

### Technical Implementation
- **Tables:** `expenses`, `expense_types`, `expense_rate_tiers`.
- **Storage:** `odometer_photos` bucket.
- **Edge Cases:** 
  - *Approval Editing:* Once approved, the record is locked via RLS and cannot be modified by the Field Agent.

---

## 5. WhatsApp Inbox & Automation

### Technical Implementation
- **Tables:** `conversations`, `messages`, `message_templates`.
- **Dependencies:** Meta Graph API (Cloud API).
- **Limitations:** Only supports text and basic media. No native mobile inbox UI yet.
- **Automations:** `automations` table intercepts inbound messages based on keywords before marking them "unread" for humans.


<!-- FILE: 11_Web_vs_Mobile_Gap.md -->

*WACRM Engineering Bible* > *Deep Specifications* > *Web vs Mobile Parity Gap*
[← 10_Module_Details](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/10_Module_Details.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [12_Offline_First_Architecture →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/12_Offline_First_Architecture.md)
---

# WACRM Engineering Bible - Web vs Mobile Parity Gap

*This document outlines the current feature disparity between the Web Dashboard and the Mobile Companion App, serving as the implementation roadmap.*

## 1. CRM & Sales

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **Contact List** | ✅ Full | ✅ Basic | Low | Medium (Add advanced filtering to mobile) |
| **Contact Custom Fields** | ✅ Full | ❌ Missing | High | High (Dynamic form rendering on React Native) |
| **Pipelines & Deals** | ✅ Full | ❌ Missing | Medium | Medium (Needs mobile pipeline UI) |
| **Leads** | ✅ Full | ❌ Missing | Medium | Low (Simple CRUD duplication) |

## 2. Field Force Operations

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **Background Location** | ❌ N/A | ✅ Full | None | Mobile-exclusive feature |
| **Live Map Dashboard** | ✅ Full | ❌ N/A | None | Web-exclusive feature |
| **Punch In / Out** | ❌ N/A | ✅ Full | None | Mobile-exclusive feature |
| **Site Visits** | ✅ View Only | ✅ Check In/Out | None | Balanced |

## 3. Communication

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **WhatsApp Inbox** | ✅ Full | ❌ Missing | Critical | Very High (Requires robust offline sync and complex chat UI in RN) |
| **Broadcasts** | ✅ Full | ❌ Missing | Low | Web-exclusive feature |

## 4. Automation & AI

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **Flow Builder** | ✅ Full | ❌ Missing | Low | Web-exclusive feature (Too complex for mobile screens) |
| **AI Bot Settings** | ✅ Full | ❌ Missing | Low | Web-exclusive feature |

## 5. Administration

| Feature | Web App | Mobile App | Gap Priority | Implementation Complexity |
|---------|---------|------------|--------------|---------------------------|
| **Expense Approval** | ✅ Full | ❌ Missing | High | Low (List view with Approve/Reject buttons) |
| **Team Management** | ✅ Full | ❌ Missing | Low | Web-exclusive feature |
| **Billing / Subscription** | ✅ Full | ❌ Missing | Low | Web-exclusive feature |


<!-- FILE: 12_Offline_First_Architecture.md -->

*WACRM Engineering Bible* > *Deep Specifications* > *Offline First Architecture (Roadmap)*
[← 11_Web_vs_Mobile_Gap](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/11_Web_vs_Mobile_Gap.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [13_Navigation_Flow →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/13_Navigation_Flow.md)
---

# WACRM Engineering Bible - Offline First Architecture (Roadmap)

*This document outlines the required engineering design to transition the WACRM Field Force mobile app from a "Requires Network" state to a true "Offline First" Enterprise application.*

## 1. Current State & Limitations
- **Current State:** Only GPS Location Pings have an offline fallback (saving to `expo-file-system`). All other operations (Punch In, Check In, Add Expense, Add Contact) require an active internet connection.
- **The Problem:** Field Agents often work in warehouses, basements, or rural areas with zero cellular reception. A failed "Punch Out" or "Check In" causes data loss and payroll disputes.

## 2. Required Architecture: Local Database
To achieve true offline-first, the app must never read/write directly to Supabase from the UI thread.
- **Technology Choice:** `WatermelonDB` or `PowerSync` (SQLite wrapper for React Native).
- **The Pattern:** 
  1. UI reads exclusively from the Local SQLite DB.
  2. UI writes exclusively to the Local SQLite DB.
  3. A background Sync Engine handles bidirectional synchronization with Supabase.

## 3. Queue Architecture & Conflict Resolution
- **Sync Status Indicators:** Every record in the local DB requires a `sync_status` column (`synced`, `pending_insert`, `pending_update`, `pending_delete`).
- **Conflict Resolution:** We will employ **LWW (Last Write Wins)** based on a highly accurate `updated_at` timestamp. 
- **Server Authority:** If the server rejects a change (e.g., due to an RLS violation), the local record is reverted to the server state and an alert is logged in the `Failed Sync Queue`.

## 4. Attachment Synchronization (Photos)
Photos (Selfies, Odometer readings) are massive and prone to network failure.
1. Camera captures photo.
2. Photo is compressed and saved to the local `expo-file-system`.
3. The local DB records the path: `file:///data/user/0/.../photo.jpg`.
4. The Background Sync Engine attempts a chunked upload to Supabase Storage.
5. Upon successful upload, the Sync Engine receives the public URL and updates the local DB record.

## 5. Cache Invalidation & Data Scoping
A mobile device cannot download the entire CRM database.
- **Scoping:** The sync engine will only pull Contacts and Tasks explicitly assigned to the Agent.
- **Pagination:** Sync must happen in paginated chunks to prevent OOM (Out of Memory) crashes on low-end Android devices.
- **Manual Sync:** Provide a "Force Sync" button on the mobile Profile screen.

## 6. Authentication Offline
- Supabase JWTs expire.
- If the app is launched offline, it must validate against the last known valid JWT stored securely in `expo-secure-store`. If the session is within a 7-day grace period, the app permits offline access.


<!-- FILE: 13_Navigation_Flow.md -->

*WACRM Engineering Bible* > *Deep Specifications* > *Navigation Flow*
[← 12_Offline_First_Architecture](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/12_Offline_First_Architecture.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [14_Component_Library →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/14_Component_Library.md)
---

# WACRM Engineering Bible - Navigation Flow

*This document outlines every navigation path, deep link, and role-based guard across the Web and Mobile applications.*

## 1. Web Application Navigation (`src/app`)

### 1.1 Unauthenticated Flow
- `/join` -> Registration page. (Checks `account_invitations` table based on a token).
- `/(auth)/login` -> Main email/password entry.
- `/(auth)/magic-link` -> OTP / Email Link fallback.

### 1.2 The Dashboard `/(dashboard)`
*Protected by Next.js Middleware. Requires valid Supabase JWT.*
- **CRM:**
  - `/` -> Main Analytics Dashboard.
  - `/contacts` -> CRM List View.
    - `/contacts/[id]` -> Contact Detail (Drawer/Sheet).
  - `/leads` -> Leads management.
  - `/orders`, `/quotations`, `/products`, `/dispatches`, `/pending-dispatch` -> Order and Product workflows.
- **WhatsApp:**
  - `/inbox` -> WhatsApp Shared Inbox.
  - `/broadcasts`, `/automations`, `/flows` -> WhatsApp campaigns and flows.
  - `/settings?tab=templates`, `/settings?tab=ai` -> Templates and Knowledge Base.
- **Location Tracking:**
  - `/location-tracking/overview`, `/location-tracking/dashboard`, `/location-tracking/all-locations`, `/location-tracking/visits`, `/location-tracking/track-report`, `/location-tracking/attendance` -> Map and attendance views.
- **Team:**
  - `/team/employees` -> Employees management.
  - `/team/roles` -> Employee Roles management.
  - `/expenses` -> Approvals and expense claims.
- **Account (Collapsible Sub-Menu):**
  - `/settings?tab=profile` -> User Profile settings.
  - `/settings?tab=security` -> Login & security settings.
- **Settings (Collapsible Sub-Menu):**
  - `/settings?tab=whatsapp` -> WhatsApp Settings.
  - `/settings?tab=fields` -> Fields & tags.
  - `/settings?tab=deals` -> Currency.
  - `/settings?tab=leads` -> Leads settings.
  - `/settings?tab=tasks` -> Task types.
  - `/settings?tab=orders` -> Orders settings.
  - `/settings?tab=pricing` -> Pricing & Schemes.
  - `/settings?tab=members` -> Team members settings (kept separate from main Team module).
  - `/settings?tab=api` -> API keys.
  - `/settings?tab=expense_types` -> Expense policies.
  - `/settings?tab=appearance` -> Appearance & Theme settings.

### 1.3 Superadmin `/(superadmin)`
*Protected by `is_superadmin` flag in the `profiles` table.*
- `/admin/accounts` -> View all tenants for billing/support.
- `/admin/feature-flags` -> Global rollout controls.

## 2. Mobile Application Navigation (`app/`)

The mobile app uses Expo Router with a strict Tab-based paradigm layered with Modals.

### 2.1 Authentication & Gating
- `/` (Index) -> Checks session. If none -> `/(auth)/login`.
- **Device Approval Guard:** If logged in, but device is `Pending`, intercepts route and shows `PendingApprovalScreen`.

### 2.2 Tab Navigation `/(tabs)`
- **Home:** Quick stats and the massive "Punch In" button.
- **Contact:** Mobile-optimized Contact list.
- **Activity:** Assigned Tasks.
- **Map:** Agent's daily trail.
- **Expense:** Agent's submitted claims.
- **Profile:** Settings, Force Sync, Logout.

### 2.3 Stack & Modal Navigation
*Pushed on top of the active tab, obscuring the bottom bar.*
- `/punch` -> The Selfie / Permission request flow before starting the tracker.
- `/visit` -> Check In/Out flow with Geofence validation.
- `/expense/[id]` -> Stack screen to view a past claim's rejection notes.


<!-- FILE: 14_Component_Library.md -->

*WACRM Engineering Bible* > *Deep Specifications* > *Component Library (Web)*
[← 13_Navigation_Flow](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/13_Navigation_Flow.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [15_Testing_Checklist →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/15_Testing_Checklist.md)
---

# WACRM Engineering Bible - Component Library (Web)

*This document catalogs the reusable React components found in `src/components`. Rebuilding existing UI is strictly prohibited.*

## 1. Generic Primitives (`src/components/ui`)
Powered by Shadcn UI. These are domain-agnostic.
- **`<Button>`:** Use `variant="primary"` for main actions. Use `variant="destructive"` for deletions.
- **`<Input>` / `<Textarea>`:** Always wrap inside a `<FormField>` from `react-hook-form` to gain automatic Zod validation text.
- **`<Dialog>`:** Standard center-screen modal. Use for simple confirmations or short 1-2 input forms.
- **`<Sheet>`:** Slide-out drawer from the right. Use for complex forms (e.g., "Create Contact" or "Edit Expense").
- **`<DataTable>`:** Generic wrapper around `@tanstack/react-table`. Supports sorting, filtering, and pagination out of the box.

## 2. Domain-Specific Components

### 2.1 CRM & Contacts
- **`<ContactSelector>`:** An async dropdown component that searches contacts. Used when creating Tasks or Site Visits.
- **`<Timeline>`:** Renders `module_activities`. Takes an array of events and draws the vertical line with icons based on `activity_type`.

### 2.2 Location & Tracking
- **`<MapContainer>`:** Wrapper around `react-leaflet`. Handles tile loading and marker clustering.
- **`<AgentTracker>`:** Subscribes to `public:location_pings` and moves a car/dot icon smoothly across the `<MapContainer>` using Framer Motion interpolation.

### 2.3 Inbox
- **`<ChatBubble>`:** Renders inbound/outbound WhatsApp messages. Handles media attachments and "read" ticks identically to the native WhatsApp app.

## 3. Engineering Rules for Components
1. **No External Fetching inside UI Components:** A `Button` or `Card` should never call `supabase.from()`. Pass data down as props.
2. **Tailwind Merge (`cn`):** Always use the `cn()` utility when exposing a `className` prop to ensure Tailwind classes resolve specificity correctly (e.g., overriding a default `bg-blue-500` with `bg-red-500`).


<!-- FILE: 15_Testing_Checklist.md -->

*WACRM Engineering Bible* > *Deep Specifications* > *QA & Testing Checklist*
[← 14_Component_Library](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/14_Component_Library.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [16_Development_Workflow →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/16_Development_Workflow.md)
---

# WACRM Engineering Bible - QA & Testing Checklist

*This document defines the Enterprise Acceptance Criteria that must be passed before any major release.*

## 1. Row Level Security (RLS) Penetration Tests
*Goal: Ensure no tenant can see another tenant's data.*
- [ ] **Direct API Query:** Obtain a valid JWT for `Account A`. Use Postman to `GET /rest/v1/contacts?account_id=eq.{ACCOUNT_B_ID}`. Result must be `[]`.
- [ ] **Agent Escelation:** Obtain an Agent JWT. Attempt to `DELETE /rest/v1/whatsapp_config`. Result must be `401 Unauthorized`.
- [ ] **Device Spoofing:** Attempt to inject a fake `device_id` into the `employee_devices` table as an Agent.

## 2. Field Force Reliability (Mobile)
*Goal: Ensure background tracking cannot be killed easily and handles network loss.*
- [ ] **Deep Sleep Test:** Punch In. Minimize app. Turn screen off. Drive 2km over 20 minutes. Check Web Dashboard. Must see at least 2 location pings.
- [ ] **Offline Queue Test:** Punch In. Turn on Airplane Mode. Drive 1km. Turn off Airplane mode. Wait 1 minute. Verify all pings were flushed to the server with accurate `recorded_at` timestamps.
- [ ] **GPS Spoofing Check:** Use a "Fake GPS" developer app on Android. Attempt to punch in at a restricted Geofence. The app should (if implemented) detect `isMocked` and reject the check-in.

## 3. Realtime Concurrency
*Goal: Prevent race conditions in the WhatsApp Inbox and Tasks.*
- [ ] **Dual Inbox Read:** Agent A and Agent B open the same unread conversation. Agent A replies. Agent B's screen must immediately reflect the reply, and the unread count must drop to 0 for both.
- [ ] **Approval Race:** Two Admins open the same Expense claim. Admin A clicks "Approve". Admin B clicks "Reject" 1 second later. Admin B's request must fail gracefully (Record already processed).

## 4. WhatsApp Webhook Resilience
*Goal: Handle Meta's aggressive retry logic.*
- [ ] **Duplicate Payload Test:** Send the exact same Meta webhook payload twice within 500ms. The system must use the `wamid` (WhatsApp Message ID) as a unique constraint and ignore the second payload, returning 200 OK.

## 5. UI/UX Regressions
*Goal: Ensure the design system remains premium.*
- [ ] **Dark Mode Lock:** Ensure no white flashes occur during page loads on the web dashboard.
- [ ] **Mobile Keyboard:** Open "Add Contact" on mobile (small screen like iPhone SE). Focus the bottom-most input. The `<KeyboardAvoidingView>` must scroll the input above the keyboard.


<!-- FILE: 16_Development_Workflow.md -->

*WACRM Engineering Bible* > *AIOS Standards* > *Development Workflow*
[← 15_Testing_Checklist](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/15_Testing_Checklist.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [17_Definition_of_Done →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/17_Definition_of_Done.md)
---

# WACRM AIOS - Development Workflow

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document defines the exact sequence of events required to move a feature from a business idea into the production environment of WACRM.

**Why it exists:** WACRM is a Multi-Tenant SaaS with an Offline-First Mobile architecture. Ad-hoc development guarantees data leaks (via missed RLS) or data loss (via missed offline sync queues). This strict, linear workflow prevents architectural drift.

**Who uses it:** Product Managers, Architects, AI Agents, and Engineers.
**When to use it:** At the inception of every single feature, large or small.

---

## 2. The 12-Step Development Workflow

### Phase 1: Business Idea & Product Review
Every feature begins as a business requirement.
- **Inputs:** User feedback, PM request, or Roadmap mandate.
- **Deliverables:** Draft of `19_SPRINT_TEMPLATE.md`.
- **Exit Criteria:** The business value and scope boundaries are explicitly defined.
- **Anti-pattern:** "Let's just build it and see if they use it."

### Phase 2: Architecture Review
Before a single line of code is written, the architecture must be verified.
- **Inputs:** Approved Sprint Template.
- **Deliverables:** Draft of `20_ARCHITECTURE_DECISIONS.md` (ADR) if the feature introduces new external dependencies or modifies the offline sync engine.
- **Approval Gate:** CTO or Principal Architect must approve the ADR.

### Phase 3: Database & Permissions (The Foundation)
Because WACRM uses Supabase, the database *is* the backend API.
- **Inputs:** Approved Architecture.
- **Deliverables:** New SQL migration file in `supabase/migrations/`.
- **Exit Criteria:** 
  - Table contains `account_id`.
  - Row Level Security (RLS) is enabled and tested via `is_account_member`.
  - Supabase CLI has generated updated TypeScript types.
- **Common Mistake:** Forgetting to add the `set_updated_at` trigger to a new table.

### Phase 4: Backend Logic & API
Building the bridge between the DB and UI.
- **Inputs:** Applied Migrations.
- **Deliverables:** Next.js Server Actions (for mutations) or `/api/` route handlers (for webhooks/crons).
- **Exit Criteria:** Input is strictly validated using Zod schemas.

### Phase 5: Web UI Development
- **Inputs:** Server Actions & DB Types.
- **Deliverables:** React Server Components (RSCs) and Client Components placed in `src/app`.
- **Exit Criteria:** Follows the Tailwind/Shadcn design system. Dark mode flash is non-existent.

### Phase 6: Mobile Development
- **Inputs:** The same DB Types used for Web.
- **Deliverables:** Expo Router screens in `app/`.
- **Exit Criteria:** Safe Area Contexts and Keyboard Avoiding Views are implemented.

### Phase 7: Offline Architecture Implementation
*Crucial step for Field Force.*
- **Inputs:** Mobile screens.
- **Deliverables:** Integration with the local SQLite (WatermelonDB) schema and sync queue logic.
- **Exit Criteria:** The feature functions flawlessly with the device in Airplane Mode.

### Phase 8: Quality Assurance (QA)
- **Inputs:** Feature complete on both Web and Mobile.
- **Deliverables:** Executed `15_Testing_Checklist.md`.
- **Exit Criteria:** All edge cases (RLS bypass, fake GPS, concurrency) pass.

### Phase 9: Regression Testing
- **Exit Criteria:** The new feature did not break the core loop (WhatsApp Inbound -> CRM -> Field Tracking -> Expense).

### Phase 10: Documentation
- **Inputs:** QA Passed.
- **Deliverables:** Updates to `10_Module_Details.md` and `11_Web_vs_Mobile_Gap.md`.
- **Exit Criteria:** If a new developer joins tomorrow, they can read the docs and understand the new feature completely.

### Phase 11: Release
Follows the exact steps outlined in `22_RELEASE_PROCESS.md`.

### Phase 12: Post-Release Validation
- **Exit Criteria:** Telemetry and error logs (Sentry/Datadog) confirm 0 immediate regressions in the production environment.


<!-- FILE: 17_Definition_of_Done.md -->

*WACRM Engineering Bible* > *AIOS Standards* > *Definition of Done (DoD)*
[← 16_Development_Workflow](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/16_Development_Workflow.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [18_AI_OPERATING_SYSTEM →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/18_AI_OPERATING_SYSTEM.md)
---

# WACRM AIOS - Definition of Done (DoD)

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document defines the absolute, non-negotiable checklist that every feature must pass before it can be merged into the `main` branch or considered "Done". 

**Why it exists:** "It works on my machine" is unacceptable in a Multi-Tenant SaaS. A single missed RLS policy could expose all customer data. A single unhandled offline exception could cause a field agent to lose a day's worth of expenses.
**Who uses it:** Engineers (for self-checking) and AI Reviewers (for PR approval).

---

## 2. The Strict Checklist

### 2.1 Database & Security (RLS)
*Why: Tenant isolation is the most critical feature of WACRM.*
- [ ] Every new operational table has an `account_id` column.
- [ ] Row Level Security (RLS) is explicitly enabled on every new table.
- [ ] RLS policies use `is_account_member(account_id, role)` to enforce tenant boundaries.
- [ ] System roles (Admin vs Agent) are correctly scoped in the RLS policies.
- [ ] `created_at` and `updated_at` columns exist, and the update trigger is applied.

### 2.2 Backend & APIs
*Why: Preventing malformed data and ensuring scalability.*
- [ ] All inputs to Next.js Server Actions or API routes are validated with a `zod` schema.
- [ ] RLS is NOT bypassed using the Service Role Key unless strictly necessary (e.g., automated background crons), and if bypassed, is thoroughly documented.
- [ ] Rate limiting logic is applied to any public `/api/v1/` endpoint.

### 2.3 Mobile & Offline First
*Why: Field agents operate in low-signal environments.*
- [ ] The feature is functional when the device is in Airplane Mode.
- [ ] Mutations (Inserts/Updates) are queued in the local SQLite/WatermelonDB store and synced in the background.
- [ ] Conflict resolution (Last-Write-Wins based on `updated_at`) is handled correctly by the sync engine.
- [ ] The UI clearly indicates to the user if a record is "Pending Sync".

### 2.4 Realtime & Synchronization
*Why: The office dashboard must reflect field/customer reality instantly.*
- [ ] If the feature involves live operations (Map tracking, WhatsApp Inbox), Supabase Realtime channels are implemented.
- [ ] Realtime subscriptions explicitly filter by `account_id` to prevent cross-tenant message broadcasting.

### 2.5 User Interface (UI)
*Why: Maintaining the premium, glassmorphic brand identity.*
- [ ] Only standard components from `src/components/ui` (Shadcn) were used. No raw `<button>` or `<input>` tags.
- [ ] Dark Mode was tested and verified (no white flashes).
- [ ] Loading states (Spinners/Skeletons) are implemented for all async actions.
- [ ] Mobile screens are wrapped in `<SafeAreaView>` and `<KeyboardAvoidingView>`.

### 2.6 Documentation & Traceability
*Why: Code rots. Documentation scales.*
- [ ] `10_Module_Details.md` has been updated with the new tables and workflows.
- [ ] `11_Web_vs_Mobile_Gap.md` has been updated to reflect parity changes.
- [ ] If a major architectural shift occurred, `20_ARCHITECTURE_DECISIONS.md` was filed.
- [ ] Code comments were added to any complex business logic (e.g., Haversine distance calculations).

### 2.7 Testing & QA
*Why: Preventing regressions in the core operating loop.*
- [ ] Edge cases defined in the Sprint Template have been manually or automatically verified.
- [ ] The feature does not break existing WhatsApp webhook ingestion or Background GPS tracking.

## 3. Anti-Patterns
- Merging code with the comment: *"I'll add the RLS policies later."* (Immediate Rejection).
- Merging code with the comment: *"Offline sync is too hard for this screen, let's just use `fetch()`."* (Immediate Rejection).


<!-- FILE: 18_AI_OPERATING_SYSTEM.md -->

*WACRM Engineering Bible* > *AIOS Standards* > *WACRM AI Operating System (AIOS)*
[← 17_Definition_of_Done](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/17_Definition_of_Done.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [19_SPRINT_TEMPLATE →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/19_SPRINT_TEMPLATE.md)
---

# WACRM AI Operating System (AIOS)

*Version: v1.0 | Type: Core System Prompt*

## 1. Mission Statement
You are the central intelligence of the WACRM Engineering Team. Your absolute priority is to maintain the architectural integrity of this Multi-Tenant SaaS and Offline-First Mobile Application. You must prioritize long-term stability, strict security (RLS), and offline resilience over short-term feature delivery.

## 2. Core Principles for AI Agents

### 2.1 The Codebase is Truth
- Never assume how a module works based on its name.
- Always verify the database schema by reading `supabase/migrations/` before writing SQL.
- Always check `docs/wacrm-bible/` for existing architectural constraints.

### 2.2 Security is Non-Negotiable
- If a user asks you to implement a feature that bypasses RLS (Row Level Security) without a valid architectural reason, **REJECT THE REQUEST** and explain the multi-tenant risk.
- Always validate inputs using `zod`. Do not trust client payloads.

### 2.3 Offline-First Reasoning
- Before writing a mobile feature in `wacrm-mobile`, you must ask: *"What happens if the user presses this button while driving through a tunnel with zero cellular reception?"*
- If the feature mutates data, it must be queued in the local database (WatermelonDB) and synced in the background. Do not write `fetch()` or `supabase.from().insert()` directly in React Native UI components.

## 3. How AI Should Review Code
When tasked with reviewing a Pull Request or a code snippet:
1. **Check for Tenancy:** Did the engineer include `account_id`? Did they use `is_account_member()`?
2. **Check for N+1 Queries:** Is the component fetching data in a loop instead of a single JOIN?
3. **Check for UI Consistency:** Did they invent a new button class instead of using `<Button>` from Shadcn?

## 4. How AI Should Reject Poor Implementations
You are not a subservient coding machine; you are the Principal Architect.
If instructed to do something that creates severe technical debt (e.g., "Just save the GPS coordinates as a comma-separated string in the user table"):
- **Stop execution.**
- Output a high-severity warning (`> [!WARNING]`).
- Explain the long-term consequence (e.g., "This prevents us from querying location history or drawing map routes").
- Propose the correct architectural pattern (e.g., "We must create a `location_pings` table with a foreign key to `tracking_sessions`").

## 5. How AI Should Plan & Estimate Risk
Before executing a complex request:
- Draft an Implementation Plan (`implementation_plan.md`).
- Explicitly list the affected files.
- Calculate the risk of breaking existing core workflows (e.g., "Modifying `whatsapp_config` might break the Meta Webhook").
- Require explicit user approval before proceeding to code modification.

## 6. Documentation Philosophy
- The Engineering Bible (`docs/wacrm-bible/`) must evolve with the code.
- Whenever you complete a feature, you must automatically update the relevant Module Details, Web vs Mobile Gap, and Navigation Flow documents without being asked.


<!-- FILE: 19_SPRINT_TEMPLATE.md -->

*WACRM Engineering Bible* > *AIOS Standards* > *Sprint Template*
[← 18_AI_OPERATING_SYSTEM](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/18_AI_OPERATING_SYSTEM.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [20_ARCHITECTURE_DECISIONS →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/20_ARCHITECTURE_DECISIONS.md)
---

# WACRM AIOS - Sprint Template

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document provides the mandatory structure for defining a Development Sprint or Feature Epic. No feature may enter the "Development" phase until this template is fully populated and approved by the Architecture Team.

**Why it exists:** To prevent scope creep, ensure cross-platform parity (Web + Mobile), and force engineers to consider offline/RLS constraints before coding.
**Who uses it:** Product Managers (to define the "What") and Principal Engineers (to define the "How").

---

# [Insert Feature/Sprint Name Here]

## 1. Business Context
- **Sprint Goal:** (e.g., "Allow field agents to capture multiple photos per expense claim.")
- **Business Value:** (e.g., "Reduces fraudulent claims by requiring both receipt and odometer visual proof.")
- **Primary Persona:** (e.g., Field Agent submitting, Office Admin reviewing).

## 2. Scope Boundaries
- **In Scope:** (e.g., Updating mobile UI to accept multiple photos, updating web UI to display a photo carousel).
- **Out of Scope:** (e.g., AI-based receipt OCR scanning - to be handled in a future sprint).

## 3. Impact Analysis

### 3.1 Database & Security
- **Affected Tables:** (e.g., `expenses`, `expense_attachments` [NEW]).
- **Permission Impact:** (e.g., Agents can insert into `expense_attachments` where `expense.user_id = auth.uid()`).
- **Migration Required:** YES / NO.

### 3.2 Platform Impact
- **Affected Web Screens:** (e.g., `/(dashboard)/expenses/[id]/page.tsx`).
- **Affected Mobile Screens:** (e.g., `app/(tabs)/expense/[id].tsx`).
- **Affected APIs:** (e.g., Supabase Storage Bucket rules for `expenses`).

### 3.3 Offline Impact (Crucial for Mobile)
- **Offline Behavior:** (e.g., Photos are saved to `expo-file-system`. Background sync task attempts upload. Expense is marked 'Pending Sync' until all photos upload successfully).

## 4. Acceptance Criteria & Testing
- **Scenario 1 (Happy Path):** User attaches 3 photos, submits, admin sees all 3.
- **Scenario 2 (Offline Path):** User attaches 2 photos in Airplane mode. Submits. App queues. User regains signal. Photos upload in background.
- **Scenario 3 (Security Path):** Agent B attempts to fetch Agent A's expense attachment via direct URL. Supabase Storage denies access.

## 5. Risks & Dependencies
- **Dependencies:** Requires Expo Camera SDK update?
- **Risks:** High memory usage on low-end Android devices if user attaches 10 high-res photos at once. Mitigation: Compress images before local save.

## 6. Deliverables Checklist
- [ ] Database Migrations applied.
- [ ] Web UI updated and deployed to Staging.
- [ ] Mobile UI updated and built to EAS Preview.
- [ ] `10_Module_Details.md` updated.
- [ ] QA Sign-off.


<!-- FILE: 20_ARCHITECTURE_DECISIONS.md -->

*WACRM Engineering Bible* > *AIOS Standards* > *Architecture Decision Records (ADR)*
[← 19_SPRINT_TEMPLATE](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/19_SPRINT_TEMPLATE.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [21_CODING_STANDARDS →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/21_CODING_STANDARDS.md)
---

# WACRM AIOS - Architecture Decision Records (ADR)

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document establishes the Architecture Decision Record (ADR) system for WACRM. 
**Why it exists:** Memory fades. In 3 years, a new engineer will ask, "Why did we use WatermelonDB instead of Realm for offline sync?" The ADR prevents repeating past mistakes and explains the tradeoffs that were accepted at the time.
**Who uses it:** Principal Architects and Senior Engineers.
**When to use it:** Whenever introducing a new technology, changing a fundamental pattern (e.g., switching from REST to GraphQL), or making a decision that is hard to reverse.

---

## 2. ADR Template
Every ADR must be saved as a Markdown file in `docs/architecture/` using the naming convention `ADR-00X-[Short-Title].md`.

```markdown
# ADR-00X: [Title]

## 1. Context
What is the business or technical force prompting this decision? 
*Example: Field agents are losing data when punching out in rural areas with zero cell reception.*

## 2. Problem
What exactly are we trying to solve?
*Example: Supabase JS throws a network error and drops the mutation if offline. We need a local queue.*

## 3. Options Considered
1. **Option A:** Write custom Async Storage queues.
2. **Option B:** Adopt WatermelonDB (SQLite).
3. **Option C:** Adopt PowerSync.

## 4. Decision
What did we choose? 
*Example: We chose WatermelonDB.*

## 5. Consequences & Trade-offs
What is the cost of this decision?
*Example: Positive: Agents never lose data. Negative: Adds 5MB to the app bundle size and requires us to write complex migration schemas in React Native.*

## 6. Status
[Proposed | Accepted | Deprecated | Superseded by ADR-00Y]
```

## 3. Anti-Patterns
- **The "Ninja" Decision:** Changing the state management library (e.g., from React Context to Zustand) in a random Pull Request without an ADR.
- **The "No Drawbacks" ADR:** Writing an ADR that lists zero negative consequences. Every architectural decision has a trade-off (usually speed vs complexity vs cost).


<!-- FILE: 21_CODING_STANDARDS.md -->

*WACRM Engineering Bible* > *AIOS Standards* > *Enterprise Coding Standards*
[← 20_ARCHITECTURE_DECISIONS](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/20_ARCHITECTURE_DECISIONS.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [22_RELEASE_PROCESS →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/22_RELEASE_PROCESS.md)
---

# WACRM AIOS - Enterprise Coding Standards

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
To ensure the WACRM codebase looks like it was written by a single, hyper-consistent Senior Engineer, regardless of how many humans or AI agents contribute to it.

## 2. Architecture & File Structure

### 2.1 Web (Next.js)
- **Domain Logic:** Must reside in `src/lib/`. Never put complex business logic (e.g., Haversine calculations) directly inside a React component.
- **Components:** Generic UI primitives go in `src/components/ui`. Domain-specific components go in `src/components/[domain]` (e.g., `src/components/contacts`).
- **Server Actions:** Place in `src/app/actions/` or alongside the domain component. Always suffix with `Action` (e.g., `createContactAction`).

### 2.2 Mobile (Expo)
- **Routing:** Use `app/` strictly for navigation.
- **UI:** Place reusable screens/components in `components/`.
- **State:** Use `React Context` for global state (e.g., Auth, Location Tracking status). Avoid Redux.

## 3. Database & SQL (Supabase)

### 3.1 Migrations
- **Naming:** Must be sequential and descriptive: `066_add_expense_categories.sql`.
- **Idempotency:** Always use `IF NOT EXISTS` for tables/columns. 
- **Destruction:** Never drop a column in a standard migration if data exists. Rename it to `deprecated_[name]` first, migrate the data, then drop in a future release.

### 3.2 Row Level Security (RLS)
- **Mandatory:** Every table must have RLS.
- **Pattern:** Use the `is_account_member(account_id, role)` RPC. Do not duplicate role-checking logic in every policy.

## 4. Frontend & UI Conventions

### 4.1 React Components
- **TypeScript:** `any` is strictly prohibited. Define explicit `interface` or `type` for all props.
- **"use client":** Push this directive as far down the component tree as possible. Do not put `"use client"` on a `page.tsx` file unless absolutely necessary.
- **Tailwind:** Use `cn()` from `clsx` and `tailwind-merge` to combine classes dynamically.

### 4.2 Validation & Error Handling
- **Zod:** All API inputs, Server Action inputs, and Forms must be validated using a Zod schema.
- **Errors:** Never expose raw database errors to the client. Catch Supabase errors and return a sanitized, user-friendly message.

## 5. Comments & Documentation
- **Why, not What:** Do not comment what the code does (e.g., `// loop through contacts`). Comment *why* it does it (e.g., `// O(n) loop acceptable here because contacts array is paginated to max 50 items`).
- **Deprecation:** Use `/** @deprecated Use newFunction() instead. Will be removed in v2.0 */` to mark old code.

## 6. Performance & Caching
- **N+1 Problem:** Avoid querying the database inside a loop. Use SQL `JOIN`s or Supabase relational queries (`contacts(*, tasks(*))`).
- **Next.js Cache:** Understand `revalidatePath` and `revalidateTag`. After a Server Action mutates data, always invalidate the relevant path so the UI updates.


<!-- FILE: 22_RELEASE_PROCESS.md -->

*WACRM Engineering Bible* > *AIOS Standards* > *Release Process*
[← 21_CODING_STANDARDS](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/21_CODING_STANDARDS.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [23_PRODUCT_RULES →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md)
---

# WACRM AIOS - Release Process

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document defines the strict lifecycle that every feature must follow to move from the `development` branch into the `production` environment. 

**Why it exists:** Deploying to a multi-tenant SaaS requires absolute caution. A broken release can halt operations for hundreds of companies simultaneously. Mobile apps cannot be hot-fixed instantly due to App Store review times.
**Who uses it:** Tech Leads, QA Engineers, and DevOps.

---

## 2. The 11-Step Release Pipeline

### Step 1: Development & Self Review
- Developer completes the feature.
- Developer strictly verifies the `17_Definition_of_Done.md`.
- Pull Request (PR) is opened against the `staging` branch.

### Step 2: Peer / AI Review
- A Senior Engineer or AI Agent reviews the PR.
- **Focus:** RLS policies, N+1 queries, UI consistency, and Zod validations.
- **Action:** Approved PR is merged into `staging`.

### Step 3: Staging Deployment
- Vercel automatically builds and deploys the `wacrm` web app to a staging URL.
- Supabase Staging environment receives the new SQL migrations.

### Step 4: QA & Regression (Staging)
- QA Team executes the `15_Testing_Checklist.md`.
- **Focus:** Does the new feature break the core loop (WhatsApp -> CRM -> Field Tracking)?

### Step 5: Mobile APK / TestFlight Build
- If the feature touches mobile, an EAS Build (`eas build --profile preview`) is triggered.
- The `.apk` or TestFlight build is distributed to internal testers.

### Step 6: Documentation Finalization
- The Engineer must update `docs/wacrm-bible/` to reflect the new reality.
- The `CHANGELOG.md` is updated with a human-readable summary of the changes.

### Step 7: Production Merge
- `staging` is merged into `main`.
- Vercel begins the Production build.

### Step 8: Database Migration (Production)
- **CRITICAL:** Before the Vercel build completes, the Supabase Production environment must receive the SQL migrations via the Supabase CLI (`supabase db push`).
- **Rollback Plan:** If the migration fails, the Vercel deployment must be cancelled immediately.

### Step 9: Mobile Production Build
- Trigger `eas build --profile production`.
- Submit to Google Play Console and Apple App Store.

### Step 10: Post-Release Smoke Test
- Immediately after deployment, a designated engineer logs into a test tenant on Production.
- They must manually verify:
  1. Login works.
  2. A WhatsApp message can be received.
  3. A GPS ping can be saved.

### Step 11: Lessons Learned (Retrospective)
- If a bug escaped into production, a blameless post-mortem is held.
- The `17_Definition_of_Done.md` or `15_Testing_Checklist.md` must be updated to ensure the bug is caught automatically next time.


<!-- FILE: 23_PRODUCT_RULES.md -->

*WACRM Engineering Bible* > *Governance* > *Product Business Rules*
[← 22_RELEASE_PROCESS](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/22_RELEASE_PROCESS.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [24_ARCHITECTURAL_THINKING_MODE →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/24_ARCHITECTURAL_THINKING_MODE.md)
---

# WACRM Engineering Bible - Product Business Rules

*Version: v1.0 | Type: Business Governance*

## 1. Purpose
This document defines the **BUSINESS DNA** of WACRM. While the codebase explains *how* a feature works, this document explains *why* it exists and the inviolable rules it must follow. Future engineers and AI agents must NEVER infer business behavior from reading SQL or React code. If a business rule is not defined here, the feature is not defined.

---

## 2. Definitive Product Ownership

No module exists in isolation. Every feature belongs to a core Product.

### Core CRM
- **Modules:** Contacts, Companies, Leads, Deals, Pipelines, Tasks.
- **Owner:** Core Platform Team.
- **Goal:** The foundational system of record for all external entities.

### WhatsApp CRM
- **Modules:** Inbox, Broadcasts, Templates, AI Replies, Automations.
- **Owner:** Engagement Team.
- **Goal:** Unifying inbound and outbound communication securely via Meta APIs.

### Field Force Tracking (FFT)
- **Modules:** Attendance (Punch), GPS Tracking, Site Visits, Expenses.
- **Owner:** Field Operations Team.
- **Goal:** Providing irrefutable proof of work, location, and expenditure for outside teams.

### Future Expansion: HRMS
- **Modules:** Leave Requests, Payroll, Shift Management.
- **Goal:** Evolving basic "Punch In" attendance into enterprise human resources.

### Future Expansion: Sales Force Automation (SFA)
- **Modules:** Beat Planning, Route Optimization, Orders, Quotations.
- **Goal:** Dictating *where* a field agent goes, rather than just reacting to where they went.

---

## 3. Deep Module Business Rules

### 3.1 Module: Contacts
- **Purpose:** The ultimate source of truth for an individual human interacting with the tenant.
- **Business Goal:** To provide a 360-degree view of communication, sales, and field visits for one person.
- **Primary Personas:** Admin, Agent.
- **Workflow Rules:** A Contact can be created manually, via WhatsApp webhook, or via Lead conversion.
- **Validation Rules:** Phone numbers MUST be unique per `account_id` and formatted in E.164.
- **Lifecycle Rules:**
  - *Deletion:* A Contact cannot be hard-deleted if they have associated financial records (Deals/Expenses). They must be archived.
  - *Merge:* If a duplicate phone number is detected, the newer contact must be merged into the older contact, transferring all `task_id` and `conversation_id` foreign keys.
- **Dependencies:** Required by WhatsApp, Visits, and Deals.
- **Offline Behavior:** Read-only on mobile. Cannot create offline yet.
- **Permission Behavior:** Agents can only see Contacts assigned to their Team (unless explicitly granted Company-wide access).

### 3.2 Module: Leads
- **Purpose:** To track unqualified potential business before they become formal Contacts or Deals.
- **Business Goal:** High-volume ingestion and qualification without polluting the core CRM.
- **Workflow & Conversion Rules:**
  - A Lead can be converted into a Contact.
  - A Lead may only be converted ONCE. Converted Leads cannot be converted again.
  - Deleting converted Leads is strictly prohibited (historical audit trail).
  - During conversion, all attached Activities and Tasks MUST migrate to the newly created Contact.
- **Limitations:** Leads do not have WhatsApp Conversations. They must be converted to Contacts first.

### 3.3 Module: Deals & Pipelines
- **Purpose:** To track revenue opportunities across discrete stages.
- **Validation Rules:** A Deal MUST belong to a Pipeline and a specific Stage. A Deal MUST be attached to a Contact or a Company.
- **Lifecycle Rules:** Once a Deal enters "Closed Won" or "Closed Lost", it is locked. Only an Admin can reopen a closed Deal.
- **Reporting Behavior:** Values are aggregated strictly based on the tenant's default currency.

### 3.4 Module: WhatsApp Inbox
- **Purpose:** To act as the central hub for all customer support and inside sales communication.
- **Workflow Rules:** 
  - Messages arrive via webhook.
  - If the sender does not exist, a Contact is silently created.
  - An AI Bot evaluates the message FIRST. If the AI cannot resolve it, it marks the conversation as "Unread" for a human Agent.
- **Notification Behavior:** Unread messages trigger an in-app badge increment.
- **Limitations:** Only Text, Images, and basic Documents are supported. Audio notes are currently not transcribed.

### 3.5 Module: Broadcasts (WhatsApp)
- **Business Goal:** To send templated marketing or operational blasts to thousands of Contacts simultaneously.
- **Validation Rules:** Cannot send arbitrary text. MUST use a Meta-approved Message Template.
- **Lifecycle Rules:** 
  - Once a Broadcast is in `sending` state, it CANNOT be cancelled or edited.
- **Reporting Behavior:** Delivery and Read receipts update incrementally in real-time.

### 3.6 Module: Attendance & GPS Tracking (FFT)
- **Purpose:** To generate irrefutable proof of working hours and geographic location.
- **Workflow Rules:** 
  - An Agent must "Punch In" to start a `tracking_session`.
  - The mobile app requests Foreground Location permissions.
- **Validation Rules:** The app MUST capture a "Selfie" during Punch In to prevent buddy-punching.
- **Offline Behavior (CRITICAL):** Location pings MUST queue locally in SQLite/FileSystem if the phone drops cellular signal. Data loss here causes payroll disputes and is unacceptable.
- **Lifecycle Rules:** Sessions older than 90 days are archived into cold storage, retaining only the aggregated daily distance.

### 3.7 Module: Site Visits (FFT)
- **Purpose:** To prove an Agent visited a specific Contact's physical location.
- **Workflow Rules:** Agent clicks "Check In" -> App records coordinates -> Agent works -> Agent clicks "Check Out".
- **Validation Rules:** 
  - Check-in cannot occur if the Agent's GPS coordinates are more than 500 meters from the Contact's saved Address. (Geofence Validation).
  - A Check-out cannot occur without an active Check-in.

### 3.8 Module: Expenses (FFT)
- **Purpose:** To reimburse Agents for operational costs (Fuel, Meals, Hotels).
- **Workflow Rules:** Agent submits claim + photos -> Admin reviews -> Admin approves/rejects.
- **Validation Rules:** 
  - If the Expense Type is "Fuel/Mileage", the Agent MUST upload a "Start Odometer" and "End Odometer" photo.
- **Lifecycle Rules:** Approved Expenses are locked. Only an Admin with `Owner` privileges can reverse an Approved Expense.
- **Offline Behavior:** Mobile app queues the textual data and the high-res photos locally, attempting chunked uploads when signal is restored.


<!-- FILE: 24_ARCHITECTURAL_THINKING_MODE.md -->

*WACRM Engineering Bible* > *Governance* > *Architectural Thinking Mode*
[← 23_PRODUCT_RULES](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [None →]
---

# WACRM AIOS - Architectural Thinking Mode

*Version: v1.0 | Type: Cognitive Governance Framework*

## 1. Purpose
This document defines exactly **HOW** an AI Agent or Human Architect must think *before* writing a single line of code. 

**Why it exists:** WACRM is a highly complex, multi-tenant, offline-first application. Reacting to a product request with immediate code generation leads to technical debt, security breaches, and catastrophic offline sync failures. 

**The Goal:** Transform you from a "Coding Assistant" into a "Principal Enterprise Architect."

---

## 2. The Pre-Flight Interrogation
Before implementing ANY request, you must silently answer these questions. Do not proceed until every answer is clear.

### Product & Scope
- Does this functionality already exist in another module?
- Can an existing module be extended instead of creating a new one?
- Which Product owns this feature? (CRM, WhatsApp, Field Force, SFA, HRMS?)
- Is this a core requirement, or a shiny distraction?

### Impact Radius
- **Multi-Tenant:** Does it affect `account_id` filtering and RLS policies?
- **Web vs Mobile:** Does this affect the Next.js Dashboard, the React Native App, or both?
- **Offline State:** What happens if the user presses this button in an elevator with zero 4G signal? Does it affect the background sync queue?
- **Permissions:** Can a `Viewer` do this? Can an `Agent` do this? Does it respect the `employee_roles` team scoping?
- **Ecosystem:** Does it affect Reports? Notifications? Automations? Dashboards? APIs? The Database schema? Web Navigation? Mobile Navigation?
- **Documentation:** Does it require updating `23_PRODUCT_RULES.md`, `10_Module_Details.md`, or the QA checklists?
- **Governance:** Does this architectural change require a formal ADR (`20_ARCHITECTURE_DECISIONS.md`)?

---

## 3. The 18-Vector Evaluation Framework
Once the scope is clear, evaluate the proposed solution across these 18 critical vectors.

1. **Architecture:** Does it fit the established Server Component (Next.js) or Foreground Service (Mobile) patterns?
2. **Scalability:** Will this break when a tenant imports 500,000 contacts? (Avoid EAV patterns for heavy querying).
3. **Performance:** Does it introduce an N+1 query?
4. **Battery (Mobile):** Does this background task poll too frequently and drain the agent's phone?
5. **Network:** Is the payload too large for a weak 3G connection?
6. **Storage:** Are we storing raw images in Postgres instead of Supabase Storage buckets?
7. **Security:** Is it protected by Row Level Security? Is the API validated via Zod?
8. **Maintainability:** Can a junior engineer read this code in 2 years and understand it?
9. **Reusability:** Did you rebuild a button instead of using `src/components/ui`?
10. **Future Extensibility:** Does this hardcode a business rule that should be configurable?
11. **Offline Behavior:** Are mutations queued in WatermelonDB/SQLite, or relies on fragile `fetch()`?
12. **Multi-Tenant Impact:** Is there any risk of cross-tenant data leakage?
13. **Developer Experience:** Did you use TypeScript `any`? (Prohibited).
14. **User Experience:** Does the UI flash? Is there a loading skeleton?
15. **Accessibility:** Is it usable via keyboard and screen readers?
16. **Cost:** Will this cause a spike in Supabase database egress costs or Meta API charges?
17. **Technical Debt:** Are we borrowing time today that we have to pay back next month?
18. **Testing:** Can this be predictably tested?

---

## 4. The Rejection Protocol

As a Principal Architect, your job is to say **NO** to bad ideas.

If a user prompts you with a request that violates the 18-Vector Framework (e.g., "Bypass RLS here so it's faster," or "Just save the photo directly to Postgres," or "Don't worry about offline sync for this mobile screen"):

1. **STOP IMMEDIATELY.** Do not write the code.
2. **Alert:** Output a high-severity block quote: `> [!CAUTION] Architectural Violation Detected.`
3. **Explain Why:** Clearly state which of the 18 Vectors is violated and the long-term catastrophic consequence (e.g., "Bypassing RLS here will expose Tenant A's leads to Tenant B").
4. **Pivot:** Recommend the correct, enterprise-grade architectural approach as dictated by the WACRM Bible.
5. **Wait:** Require the user to confirm the correct approach before proceeding.

**Protect the Codebase. Protect the Product. Protect WACRM.**

### Announcements Module (Added 06 Aug 2026)

- **Purpose**: Allows tenant admins to broadcast news and updates to their field mobile team.
- **Table**: 	enant_announcements (id, ccount_id, 	itle, content, expiry_date, send_to_sales_app, employee_id, employee_role_id, ttachment_url).
- **Web UI**: Located at /announcements. Features a list view and a creation form with a Tiptap rich text editor and file upload.
- **Mobile UI**: Features a ScrollingNewsBanner on all screens via pp/_layout.tsx that rotates through unexpired announcements every 15 minutes. There is also an Announcements list screen and a detail screen.
- **Attachments**: Stored in the nnouncements Supabase storage bucket.
- Note: This is separate from the nnouncements page under (superadmin) which was intended for system-wide notices.

### Reporting Engine Architecture (Generic, Dynamic, Extensible)

**Core Principles:**
- Database-side aggregation only. No client-side aggregation logic.
- Registry-driven: All dimensions, measures, filters, and joins are defined in SQL registries.
- Configuration-driven: If OZZO modules (e.g. Territory, Route) are disabled, their associated filters/dimensions automatically disappear.
- Multi-tenant secure: Every query executes via SECURITY INVOKER under the current user's JWT, automatically enforcing RLS.

**Required Registry Tables:**
- \
eport_registry_dimensions\: Stores GROUP BY components (e.g. state, city, product_category) and their required LEFT JOINs.
- \
eport_registry_measures\: Stores aggregation columns (e.g. \item_amount\ = \SUM(order_items.sub_total)\) and their required LEFT JOINs.
- \
eport_registry_filters\: Stores WHERE clause templates for dynamic UI filters.
- \
eport_registry_joins\: Stores reusable LEFT JOIN snippets (e.g. joining contacts, users, products).
- \saved_reports\: Stores JSON states of configured reports, categorized by Private, Team, or Organization sharing modes.

**Security Rules:**
- RPCs use \SECURITY INVOKER\ (NEVER \SECURITY DEFINER\) so they run safely inside the user's RLS environment.
- Tenant isolation is strictly enforced.
- Frontend SQL generation is strictly FORBIDDEN. All queries are built securely via parameterized \execute_dynamic_report\ RPC.

**Fan-Out Prevention Strategy (Crucial for 1-to-N aggregations):**
When joining a 1-to-N relation (like \orders\ -> \order_items\), directly summing the base table's total (e.g. \SUM(orders.sub_total)\) causes mathematically inflated totals (fan-out) because the base total repeats for every item row. To prevent this, reports grouping by item-level dimensions (e.g. \product_category\) MUST use item-level measures (e.g. \item_amount\ mapped to \SUM(order_items.sub_total)\). The generic registry supports this seamlessly without changing engine code.

**Saved Reports & Future Compatibility:**
Saved reports can be shared via 'private', 'team', or 'organization' modes. The generic architecture natively supports upcoming features: Drill Down Reports, Dashboard Widgets, Scheduled Reports, and Universal Custom Fields onboarding.



## Document Templates (Added Aug 2026)
- **Status (2026-08-16): complete for all four document types.** Storage, editor, user
  assignment, signature images, and template-driven rendering on **all four print routes**
  (order, quotation, dispatch, payment). Before this the module was a front-end mockup: a
  hardcoded `DUMMY_TEMPLATES` array and a `// Simulate save` setTimeout, with no table.
- **Governing rule (founder, 2026-08-16): a template must be able to show everything its
  module's creation screen captures.** `MODULE_CAPABILITIES` encodes this per module and is
  the first place to extend when a creation form gains a field. It is why the order table
  carries Discount, Unit, MRP and Rate incl. Tax, and why the dispatch document-info rows are
  exactly the dispatch form's fields (dispatch code, invoice no/date, LR no/date, transport,
  transport contact, tracking).
- **Correction to an earlier note in this file: a dispatch DOES have prices.** `dispatch_items`
  stores none of its own, but every row carries `order_item_id` and both the dispatch creation
  screen and its print route follow it. All production dispatch lines are linked. A dispatch has
  no *tax* column, because its creation screen has none. Dispatch lines are priced on the
  quantity dispatched, not ordered, so a part dispatch never prints the whole order's value.
- **Quotations get no discount columns** — `quotation_items` has no discount fields at all.
  Same rule, not an inconsistency with orders.
- **Every module auto-creates a "Default" template on first view** of its tab, so the screen is
  never empty and there is always something to clone. Done in the panel rather than by a
  migration because the built-in config lives in TypeScript — a seeded row would drift the
  moment those defaults changed. Racing tabs are harmless: the unique name index rejects the
  second insert and the panel re-reads.
- **Clone / Assign / Make Default are always-visible buttons on each card.** They were
  hover-only, which made them undiscoverable and left them completely unreachable on a touch
  screen, where there is no hover.
- **Removed `priceGroup` (2026-08-16):** the toggle existed but `orders` has no price-list
  column and the order form has no such field, so it could only ever print nothing.
- **`remark` renamed to `notes`**, matching the order form's own label and `orders.notes`.
  Quotations do **not** offer it — the quotations table has no notes column; `terms_conditions`
  is their free-text field and it already overrides the template footer on the printed page.
- **The order screen's "Line total incl." and "Line Total" collapse to one template column**
  (Net Amount): once a line's tax mode is applied they are the same figure, and two columns
  printing an identical number on every row is worse than one.
- **Assignments** (`document_template_assignments`): assigning a template to a user means BOTH
  — they print with it, and only they may edit it. **Admins can always edit**, deliberately:
  without that escape hatch, assigning a template to one rep would lock the owner out of a
  layout the whole business prints with. A user holds at most one template per module (unique
  index); the assign dialog says which template a tick would move them off, rather than letting
  the save fail on a constraint. `account_id`/`module_name` are copied from the template by
  trigger, never trusted from the client.
- **Print precedence**, resolved in one round trip by `resolve_document_template(account, module,
  user)`: template assigned to the viewer → account default → built-in module default. Resolved
  for **whoever is printing**, not whoever created the record.
- **Signature images** live in the public `document_assets` bucket (2 MB, PNG/JPEG/WebP), path
  `<account_id>/signatures/...` with membership checked on the first path segment. Public
  deliberately, matching the company logo: the mobile app renders these print pages in a webview
  to build PDFs, and an expiring signed URL there yields a broken image with no obvious cause.
- **🔴 Found 2026-08-16: `products.hsn_code` was written by the product form but did not exist.**
  The HSN input shipped in `a3fdc91` on 2026-08-09 and the save payload has included `hsn_code`
  ever since, against a column that was never created — so **product create/edit would have
  failed outright**. Latent only because no product has been saved since 2026-07-26. The column
  was added by `20260816160000_document_templates`. The product form already had the full input;
  no UI work was needed.
- **Four document types only**: `order`, `quotation`, `dispatch`, `payment` — each already had a
  print route. The mockup's **"Estimate" is not a real module**; the product's equivalent is
  **Quotation**, and it was renamed rather than built. **"Outstanding" was dropped**: it would be
  a statement of account, a document that must be built before it can be styled.
- **Tables**: `document_templates` (account-scoped, RLS, `config jsonb`). One default per module
  enforced by a **partial unique index**, not a trigger, so a second default is refused outright
  instead of racing. Names are unique per module, case- and space-insensitive.
- **`set_default_document_template(uuid)`** RPC — promoting is unset-then-set, which must not be
  half-applied or a module ends up with no default. `SECURITY INVOKER`, so RLS still applies.
- **Config shape lives in `src/lib/document-templates/schema.ts`, not in Postgres.** jsonb buys
  flexibility and loses validation, so `buildDefaultConfig()` + `normalizeConfig()` are the
  substitute: a template saved before a field existed gets that field's default, and anything the
  module cannot support is forced off on read.
- **`MODULE_CAPABILITIES` is the "show only what applies" rule, driven by real schema limits.**
  A **payment has no line items** (`payments` is one row with an amount) so it has no item table
  and no quantity summary. A **dispatch has no prices** (`dispatch_items` is product_name, unit,
  quantity only) so every currency column and total is unavailable — a delivery note could
  otherwise offer a Price column that can only print blank.
- **One renderer for preview and print**: `document-template-preview.tsx` is used by both the
  editor and `/print/order/[id]`, with the editor passing sample data. The mockup's preview
  rendered nothing real, which is exactly how a preview drifts from the document it claims to
  show. Callers pass pre-formatted strings; the renderer lays out and does not calculate.
- **🔴 Fixed a live bug in every printed document**: the print routes read `account.business_name`,
  `account.phone`, `account.email`, `account.gst_number`, `account.gstin` — **none of those
  columns exist on `accounts`**. Real details live in `accounts.settings.company_profile`. Every
  order and quotation PDF was printing the raw account name, an empty contact line and the literal
  text "GST No :" with nothing after it, and the uploaded company logo was never rendered.
  Resolved once in `src/lib/document-templates/company-profile.ts`.
- **`company_profile.gst_number` added** (jsonb, no migration): the header offers a GST line and
  no field existed to hold a company GST number.
- **`products.hsn_code` added**: the editor offers an HSN column and `settings.hsn_enabled` was
  already true, but no HSN column existed anywhere in the schema. Free text — 4, 6 and 8 digit
  codes are all valid, so no CHECK constraint.
- **Item code / HSN / category / image are NOT on `order_items`** — they live on `products` and
  need a join, fetched once per document and tolerant of a since-deleted product (the line still
  prints, without its catalogue extras).
- **Quantity totals are grouped by unit**, because "Total 42" across kilograms and pieces is
  meaningless. Note units are still free text (`kg`/`Kg`/`KG` all exist in production), so the
  grouping is only as clean as the data — see the configurable-units backlog item.
- **Custom fields are stored as ids, not names**, so renaming a field in Settings does not
  silently drop it from every document. `payment` has 0 custom fields, so that section is hidden
  for it rather than shown empty.

## Payment Collection Module (Added Aug 2026)
- **Status (2026-08-14): repaired, in UAT — NOT production-proven.** As shipped on 2026-08-13 the
  module did not function: both web and mobile wrote to columns that do not exist, so no payment
  could be created from either client. The commit message for `a03b22a` calls it "Ready for Pilot"
  with "end-to-end" flow and working credit enforcement; none of that was true. Fixed on
  `fix/payment-module-production-readiness` (web) and `feat/mobile-payment-collection` (mobile).
  Full findings: `docs/engineering/payment-module-readiness-report.html`.
- **Known gap**: an Approved payment cannot be reversed — the transition table makes it terminal, so
  there is no correction path for a mis-keyed payment or a bounced cheque. Open product decision.
- **Purpose**: SFA-focused payment collection (not accounting/ERP).
- **Key Features**: Offline mobile collection, dual-amount (collected vs verified), strict status state machine (Pending -> Approved/Rejected/Cancelled), no physical deletes (soft-delete via 'Cancelled' status), customer financial visibility (outstanding balance = approved orders - approved payments + opening balance).
- **Tables**: payments, payment_types, payment_attachments, payment_custom_values.
- **RPCs**: update_payment_status (handles transitions and module_activities).
- **Permissions**: `view_payments`, `create_payments`, `edit_payments`, `approve_payments`,
  `reject_payments`, `cancel_payments`. Roles in the wild store creation rights as either
  `create_*` or the legacy `add_*`; `hasPermission` resolves both, because installed APKs check the
  legacy spelling and cannot be updated retroactively. Do not "normalise" these keys in the database.
- **Settings**: `approval_required`, the four credit keys, and — since 2026-08-16 — the three
  `require_*` toggles are all consumed. `require_notes` / `require_reference` are enforced by
  `enforce_payment_required_fields()` on INSERT (and on an edit that would blank a required
  field, never on an unrelated update, so historical rows stay approvable). `require_attachment`
  is enforced by `enforce_payment_attachment_on_approval()` on the transition into Approved,
  **not** on insert: the client writes the payment, uploads to storage, then inserts
  `payment_attachments` in three separate transactions, so at insert time the proof provably
  does not exist yet. Both clients mirror the rules at capture time
  (`src/lib/payments/requirements.ts`, `wacrm-mobile/lib/payments/requirements.ts`) purely for a
  readable message — the triggers are the authority, because mobile writes the table directly.
- **`payment_types.requires_reference`** (added 2026-08-16) marks the instruments that actually
  carry a reference: Cheque, UPI, NEFT, RTGS, Bank Transfer. Cash, Credit Note and Other do not,
  so `require_reference` never blocks a cash collection. Stored as a column rather than matched
  on the type name in SQL — name matching would silently disable the rule the first time somebody
  renamed "Cheque". New custom types default to `false` so adding a type cannot start blocking
  saves by surprise.
- **Known limit, documented not hidden**: with `approval_required` OFF a payment is born Approved
  on insert and never crosses the approval transition, so the database cannot verify its proof. In
  that configuration the capture-time client rule is the only attachment guard.


## Visit & Ageing Reports (Added 18 Aug 2026)

Two more reports on the generic engine (migration
`20260818090000_visit_and_ageing_report_modules.sql`, applied to prod as
`visit_and_ageing_report_modules_rpc` + `_registry`). Engine-level detail lives in
`docs/report-engine.md` §5f–§5g; the product rules are here.

### Visit Report — `/reports/visits`

Tabs: **Customer, Lead, Area, Period, User**. Base table `site_visits`, dated by
check-in.

- **Feedback is a pivot, not a grouping.** Every tab carries one column per
  feedback type — Excellent / Good / Average / Poor / **No Feedback** — and the
  five sum exactly to `# visit`. The type list is hardcoded in the mobile app
  (`app/visit/[id].tsx`, `FEEDBACK_OPTIONS`), not account-configurable; making it
  configurable means changing these five registered measures too.
- **Productive visit = a visit that produced an order**, read from
  `orders.site_visit_id` rather than inferred (founder decision, 18 Aug 2026).
  Deliberately **absent from the Lead tab** — orders are raised against
  customers, so a column of zeroes there would read as failure rather than as
  not-applicable.
- `# customer visit` + `# lead visit` = `# visit`; they split *visits* by who was
  visited. `# unique customer` / `# unique lead` answer the distinct-people
  question and sit in Manage Column.
- Visits are polymorphic (`target_type` / `target_id`), so Customer and Lead tabs
  INNER JOIN their own entity while geography LEFT JOINs both and COALESCEs.

### Ageing Report — `/reports/ageing`

Tabs: **Customer, Area, Product**, plus **Product Category / Sub-Category** when
the account's product hierarchy is deep enough. Lists who and what stopped
ordering.

- **"Period" means "had NO order in this window."** Widening the period *shrinks*
  the list — the inverse of every other report. This is the single most
  confusable thing in the module.
- Beyond the names, each row carries **Last Order Date**, **Days Since Last
  Order** and **# lifetime order**, from an unbounded lookback: how long someone
  has been dormant is a lifetime question even when the window is one month.
  Days Since is non-additive, so the table footer dashes it instead of summing
  ages.
- The Customer/Area tabs read `contacts` and the Product tabs read `products` —
  two base tables, so two registry modules under one report, via the new
  `TabConfig.moduleOverride`.

**Known sharp edges, not hidden:** `contacts` is the whole customer master with no
active/archived flag, so dormancy lists include records that were never really
customers; `Product Status` is filterable but **off by default**, so discontinued
products appear until it is set; and `contacts.area` is free text that is not
case-folded, so `Kalawad road` and `Kalawad Road` currently list as two areas.

**Not built:** the Task Report, which was scoped in the same request and is on
hold pending its field list.


## Expense Report (Added 18 Aug 2026)

`/reports/expenses`, on the generic report engine (migration
`20260818140000_expense_report_module.sql`, applied to prod as
`expense_report_registry`). Engine-level detail is in `docs/report-engine.md`
§5h. The engine had resolved `expense` to the `expenses` table since the original
report-engine migration, but **nothing was ever registered against it** — the
module was an empty shell until now.

Tabs: **User, Expense Type, Allowance Type, Period, Status, Approved By.**

- **Same status pivot as Payments.** Every tab carries Pending / Approved /
  Rejected / Total, so a row reads "of this much claimed by X, this much is
  approved". `Total = Pending + Approved + Rejected` always reconciles.
- **Approved means sanctioned, not claimed.** It reads `approved_amount` (falling
  back to `amount`), mirroring how Payments treat `verified_amount`. `Claimed` is
  available in Manage Column, so **Claimed − Total is exactly what approvers
  trimmed**.
- Travel (km) and Approved % are available per group; Approved % is a ratio, so
  the footer dashes it and the KPI card recomputes it across the whole set.

**There is deliberately no Area tab.** An expense has no geography of its own —
no customer, no site, no territory column. The only route to one is
`employee_area_assignments`, which is many-to-many: one employee on prod already
covers **six** areas, so grouping by area would multiply that employee's every
amount by six, and there is no honest way to split one hotel bill across six
areas. Area is therefore a **filter** ("claims by employees who cover this
area"), implemented as `EXISTS` so it cannot fan out. If area-wise expense
totals are wanted for real, expenses need their own area stamped at claim time.

**Department / Branch / Designation** are registered as dimensions but are not
tabs: all three profile columns are empty on prod today, so each would render a
single "Unassigned" row. They light up the moment those HR fields are filled.

**Nav note:** the Report group now has both "Expense Reports" (this report) and
the pre-existing "Expenses Report" (`/expenses`, which is the expense *list*, not
a report). Worth renaming the latter — flagged, not changed.


### Post-ship fixes (18 Aug 2026)

Three registered-SQL type bugs, all found by executing every registry entry
rather than by reading it. The registry stores SQL as **untyped strings**, so
none of these failed at registration — and when they fail at runtime the RPC
raises, the viewer catches, and the user sees the ordinary **"No records found
for selected filters"**. A broken report is indistinguishable from an empty one.

- `expense_types.allowance_type` is an **enum**, registered as text. Broke both
  the Allowance Type filter *and* the whole Allowance Type tab.
- `contacts.hierarchy_level` is an **integer**, registered as text. Broke the
  Ageing report's Customer Type grouping — shipped a day earlier and unnoticed.
- The `user` filters cast the payload straight to uuid, which raises on the
  object payload shape instead of simply not matching. Hardened on the four new
  modules; the same pattern is still latent on order/sales/lead/deal/quotation/
  payment and is flagged, not changed.

Rule now documented in `docs/report-engine.md` §5i: **cast the COLUMN to `::text`,
never the literal to the column's type**, and execute every registry entry once
when adding a module. Full sweep is clean: 31 dimensions, 32 measures, 36 filters.

Also: `AsyncSearchSelect` silently swallowed query errors, so the Expense Type
picker showed "No results found." when it was really a 400 on a missing column.
It now logs the failing table and columns.


## Task Report + Report menu cleanup (18 Aug 2026)

### Task Report — `/reports/tasks`

Built on the generic engine (migration `20260818160000_task_report_module.sql`,
applied to prod as `task_report_module_rpc` + `task_report_registry`). Engine
detail in `docs/report-engine.md` §5j.

Tabs: **Customer, Lead, Activity Type, Status, Area, Period, User.** Columns are
`# task`, `# completed`, `# pending`, `# overdue`, `Completed %`.

- `# completed + # pending + # cancelled = # task` exactly. **`# overdue` is
  outside that sum** — it is a *subset* of pending (past due and still open), not
  a fourth bucket. It stays a default column because it is what a manager acts on.
- **Tasks are dated by due date, falling back to created_at.** 3 of 14 prod tasks
  have no due date; dating strictly by `due_date` would silently drop them from
  every period, so the report would under-report while looking healthy.
- **Activity types come from account settings**, not a hardcoded list
  (`accounts.settings.task_types`). This account uses "Payment follow up", which
  is not among the shipped defaults, so a static list would have made its own
  tasks unfilterable. New `ReportFilterDef.optionsFromSettings` does this.
- Assumptions taken from the earlier offer, since no field list was given: the
  report mirrors the Visit report's tab shape. **Notes are counted as tasks** —
  the app treats `activity_type = 'Note'` as a logged comment and hides it from
  task lists, but this report does not silently exclude anything. There are no
  Note rows on prod today. Say if they should be excluded.
- Every string column here is genuinely `text` — status, priority and
  activity_type are NOT enums (checked, not assumed, after the expense bug).
- `tasks` repeats and doubles the expenses FK trap: `assigned_user_id` points at
  `profiles(id)` (the assignee) while `user_id` is the **auth uid** (the creator).

Verified on prod: 14 tasks reconciling across the User, Activity Type and
Customer tabs; the full execute-every-entry sweep passes 32/32.

### Report menu now holds only real reports

Four entries were removed from the **Report** group. None was a report — each was
a second link to a module's own list page:

| Removed label | Actual destination |
| --- | --- |
| Activity Report | `/follow-ups` — the follow-ups list |
| Sales & Deals | `/pipelines` — the deals pipeline |
| Expenses Report | `/expenses` — the expense list |
| Location Reports | `/location-tracking/health` — Tracking Health |

"Expenses Report" sat directly beside the real "Expense Reports", which nobody
could be expected to tell apart.

**No page was deleted and nothing was orphaned** — every one of those four is
still reachable from its own section (`/follow-ups` and `/pipelines` have
top-level entries, `/expenses` is "Expense", and `/location-tracking/health` is
"Tracking Health" under Location Tracking). `/follow-ups` is also the post-login
landing page and was never at risk.

The Report group is now exactly the ten engine-backed reports: Order, Sales,
Quotation, Payment, Lead, Deal, Visit, Ageing, Expense, Task.

### Task report follow-ups (18 Aug 2026)

Founder reported "no report shows data, everything shows zero". **Investigated and
found no bug.** Reproduced the exact frontend path — impersonating the owner's
auth uid under RLS — and every module returned correct data: Order, Payment,
Visit and Expense all show August figures.

The zeros were the **default period**. Every report opens on "This Month"
(August 2026), and three modules have no August records at all:

| Module | Records in August | Total |
| --- | --- | --- |
| Task | **0** | 14 (all dated 30 Jun – 27 Jul) |
| Lead | **0** | 9 |
| Deal | **0** | 3 |
| Order / Payment / Visit / Expense | 12 / 6 / 19 / 3 | — |

Fixed the real problem, which was that an out-of-range report is
indistinguishable from a broken one: the empty state now **names the active
period** and says whether other filters are set, instead of the bare "No records
found for selected filters".

Also in this pass:

- **Task status reduced to Done / Undone** (founder decision). The table still
  stores five statuses; the report exposes two, and "All" is leaving the Status
  filter unset. Done = `Completed`, Undone = everything else including Cancelled
  and null, so `# done + # undone = # task` exactly. `# cancelled` and
  `# pending` are gone — they were slices of Undone presented as peers of it.
- **Lead filter added** to the Task report. A task belongs to a lead *or* a
  customer, and only Customer was filterable, which left the Lead tab
  unfilterable.
- **"Payment follow up" in the Activity Type filter**: verified the account
  setting does contain it and the drawer does read `accounts.settings.task_types`
  — this was the deploy not having landed when it was tested, the same timing
  issue as the Expense Type picker earlier.


## DSR — Daily Sales Report (Added 18 Aug 2026)

`/reports/dsr`, migration `20260818180000_dsr_report_module.sql` (applied to prod
as `dsr_report_module_rpc` + `dsr_report_registry` +
`dsr_payment_collected_excludes_cancelled`). Engine detail in
`docs/report-engine.md` §5k.

**The suite's only cross-module report.** One row per employee, each column drawn
from a different module, so a manager reads one line and knows what a rep did
that day. Tabs: **User** and **User Role**.

Columns, in the order specified: Assigned / Visited / Missed Customers, Days
Present, Leave Days, Total Visits, Productive Visits, Distance (km), New
Customers, Order Amount, Order Quantity, Payment Collected, New Leads, Lead
Visits, Quotation Amount, Approved Quotation Amount, New Deals, Deal Amount —
plus the full status splits for **payments** (Approved / Pending / Rejected /
Cancelled) and **expenses** (Approved / Pending / Rejected), and Orders count.

**It opens on Today**, not This Month — the first report to override the default
period, because a daily report that opened on a month would answer a different
question than its name.

### How it avoids multiplying every number by every other module

Joining nine modules onto `profiles` would fan out eight ways at once. So the DSR
**joins nothing**: every measure is a correlated scalar subquery that carries its
own date window. Nothing joined means nothing can fan out, and because `profiles`
never duplicates, grouping by User or Role is equally correct.

### Definitions that are choices, not facts

- **Payment Collected = Approved + Pending + Rejected, EXCLUDING Cancelled.** A
  cancelled payment is a voided entry and was never collected. This deliberately
  **differs from the Payment report's Total**, which includes Cancelled because it
  reconciles every row ever written. Cancelled has its own DSR column so the
  money stays visible. *This was a real bug found by reconciliation* — one
  cancelled ₹15,900 payment was inflating Collected to ₹26,400 against ₹10,500
  approved.
- **Assigned Customers is a CURRENT count** (customers owned now), not date-bound.
  Missed = Assigned − Visited, floored at zero.
- **Distance is odometer-based**, not GPS — it is what travel allowance is paid on
  — and counts only sessions where **both** readings were captured. On prod today
  that is **6 of 31 sessions**, so this column under-reports until reps capture
  both odometer photos. A GPS/haversine alternative was rejected: the engine
  anticipates 1M+ pings and a per-employee distance computation would not survive.
- **Quotations** use latest-version-only; "Approved" counts status Approved **or**
  Accepted.

### Source notes

There is no `attendance` table — punch in/out is `tracking_sessions`, which also
carries the odometer readings. Days Present = distinct punch-in dates. Leave Days
sums `leave_days.day_value` (0.5 for half days) excluding Cancelled.

Key discipline, verified by counting matches both ways before writing anything:
contacts / tracking_sessions / site_visits / orders / payments / leads /
quotations / deals key off the **auth uid**; `leave_days` and `expenses` key off
**profiles.id**.

**Verified on prod** column-by-column against each source module: visits 46/12,
productive 11/4, orders 22/4, order amount 115,301.15/14,790, quantity 668/70,
days present 14/5, assigned 27/1, new leads 7/0, quotation amount 109,962.94/0,
payment collected and expense claimed all matching exactly for the two active
users. Registry sweep 39/39 clean. Unverified on screen.

### DSR follow-ups (18 Aug 2026)

- **Period dropdown showed the raw value** — "this_month" instead of "This Month",
  on *every* report. `@base-ui` renders `Select.Value` as the value unless given
  children; the trigger now renders the resolved label. Pre-existing, surfaced by
  a DSR screenshot.
- **Chart measure is now selectable.** A donut can only ever plot one measure and
  it was hardcoded to the first selected column — "Assigned Customers" on the DSR,
  which is a meaningless thing to chart. A picker appears in donut view
  (`ReportConfig.chartMeasure`); the bar chart uses the same pick to rank its
  top-N. Both fall back to the first measure, including when a stored pick is no
  longer on screen after a tab switch.
- **Employee Status filter removed** from the DSR at the founder's request —
  every prod profile is `active`, so it filtered on one meaningful value. Deleted
  from the registry as well as the config so the two cannot drift.
- **Distance was not a bug.** All six sessions carrying both odometer readings are
  dated **July 2026** (822 km, all sumit vegad), so July returns 822 and August
  correctly returns 0. Verified via the RPC for both windows.

### DSR follow-ups, round 2 (18 Aug 2026)

- **Donut defaulted to "Assigned Customers".** The picker shipped and works, but
  its fallback was `measures[0]`, which on the DSR is a snapshot identical every
  day. Adds `ReportDefinition.defaultChartMeasure`; the DSR charts **Order
  Amount** unless the user picks otherwise.
- **"Today shows random data" was not random.** Verified against prod: today has
  1 punch-in, 0 visits, 0 orders — so Days Present 1 and every other zero were
  correct. What looked wrong was **Assigned Customers 27 / Missed 27 appearing
  regardless of period**. Assigned is a SNAPSHOT (customers owned now); there is
  no assignment history in the schema, so it *cannot* be period-bound. It is now
  labelled **"Assigned Customers (Current)"** so the caveat is where the reader
  actually looks.
- **"Missed Customers" renamed to "Not Visited"**, same arithmetic (Assigned −
  Visited, floored at zero). Over a single day "missed" read as 27 failures when
  it only meant "not reached today". A true missed-call figure needs route plan
  data (`route_execution_stops.status`); this account has **zero** route
  executions and the Route module ships off, so that is the upgrade path the day
  routes are enabled — not something to fake now.
