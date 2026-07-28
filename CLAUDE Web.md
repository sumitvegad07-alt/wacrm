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
- **`products` has NO `tax_rate` column** and never did. The rate comes from
  `products.tax_slab_id → tax_slabs.rate`. FK `products_tax_slab_id_fkey` exists, so PostgREST
  can embed `tax_slabs(rate)`.
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

### Global UI Design System & Spacing Guidelines (Web)

- **Full Screen Width for Forms & Panels (`w-full`)**: Do NOT use narrow wrappers (`max-w-2xl`, `max-w-xl`) or constrained centered containers on create, edit, view, or settings screens. All main screens and settings forms must use full screen width (`w-full` / `max-w-[95vw]`).
- **Multi-Column Responsive Grids**: To prevent empty/wasted white space on the right-hand side of large desktop monitors, arrange form fields, settings toggles, and metadata panels in responsive multi-column grids (`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-6` or `gap-8`).
- **Base UI / Next.js Hydration & Button Nesting Rule**: When using `@base-ui/react` components such as `DialogTrigger`, use the `render={<Button />}` prop pattern instead of `asChild` wrapping a `<button>` or `<Button>` child. Using `asChild` with an inner button causes an HTML `<button> cannot be a descendant of <button>` validation error and React 19 hydration mismatch.

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
