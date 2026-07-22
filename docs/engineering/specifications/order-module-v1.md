# Feature Specification: Order Module (FMCG) + Dispatch + Convert-to-Customer + Customer Rename

**Status:** Confirmed
**Module:** New Module (Order Management) + CRM (conversion, rename)
**Date:** 2026-07-22

## 1. Feature Overview

- **Problem:** Field salesmen have no way to capture orders during visits. Companies with
  distribution hierarchies (Super Stockist → Distributor → Dealer → Retailer) cannot
  classify primary vs. secondary orders. Admins have no order pipeline, no dispatch
  tracking, no order reports. Separately: lead conversion on web is unsafe
  (non-transactional, hard-deletes the lead) and absent on mobile; the "Contact" naming
  confuses users who think of them as Customers.
- **Business justification:** Order capture is the single highest-value action a field
  salesman performs during a visit. It is also the anchor for planned Payment Collection,
  Scheme Management, and Accounting Integrations (Tally/Zoho/Busy/Marg).
- **Target use case:** FMCG/distribution companies. Salesman checks in at a customer,
  opens the product catalog, adds quantities, places the order, checks out. Admin manages
  status and dispatches on web; salesman answers customer status queries from mobile.

## 2. Scope

**In scope (v1):**
- Orders + order items + per-account auto-numbering (ORD-0001), classification
  (direct/primary/secondary) derived from configurable customer hierarchy.
- Account settings: hierarchy enable + editable level names (1–5); admin-configurable
  order statuses (default: Placed, Accepted, Dispatched, Delivered, Cancelled).
- `products.stock` (manual, admin-maintained; future accounting sync overwrites it).
- `contacts.hierarchy_level` + web UI to set it (visible only when hierarchy enabled).
- Mobile capture from an active visit: catalog (photo/name/sku/price/unit/stock, search +
  category/price filter), quantity cart, review with editable order custom fields,
  offline-first placement, success message.
- Mobile orders list + detail (status read-only, custom values, dispatches) + share
  (order and dispatch text summaries).
- Web /orders list (inline status editing, filters) + detail + partial-capable dispatch
  creation (order → many dispatches, each with items+quantities, transport, tracking no).
- Order custom fields via existing shared `custom_fields` system (module_name 'order') +
  `order_custom_values`.
- Web order report + dispatch report (filters, summary cards, CSV export); mobile "My
  Order Summary" after web ships.
- Atomic `convert_lead_to_customer` RPC used by both web and mobile; lead kept with
  Converted badge.
- Rename Contact → Customer: user-visible labels on both apps; DB stays `contacts`;
  mobile routes stay `/contact/*`; retire the mock drawer Customers module.

**Out of scope (explicitly):**
- Accounting integrations (documented as future; dispatch/stock shapes designed for it).
- Standalone order creation outside an active visit.
- Schemes/discounts, payment collection, credit limits, customer outstanding.
- Stock decrementing on order/dispatch (stock is display-only info for the salesman).
- Renaming DB tables/columns/routes (`contacts`, `contact_id`, `/contact/*` unchanged).

## 3. User Roles & Permissions

| Role | Sees | Does | RLS |
|---|---|---|---|
| Salesman (agent, mobile) | Own orders, catalog, own dispatches | Create orders during active visit; share | `is_account_member(account_id)`; orders insert requires `user_id = auth.uid()` |
| Admin/Owner (web) | All account orders/dispatches | Change status, create dispatches, configure hierarchy/statuses, set customer levels, edit stock | member read/write; delete admin-only — mirrors quotations policies |
| Viewer | Read-only lists | — | member read |

## 4. Data Model

Migration `067_convert_lead_rpc.sql`: `convert_lead_to_customer(p_lead_id uuid) RETURNS uuid`
— plpgsql, invoker rights (RLS applies). Atomic: insert contact (name, phone←whatsapp
fallback 'Unknown', email, company←industry, city, state, country), copy lead notes →
contact_notes, re-link tasks (lead_id→null, contact_id→new), rewrite module_activities to
module_name 'contact'/new record_id, set lead is_converted=true +
converted_contact_id=new id (lead KEPT), log a module_activities 'created' entry, return
new contact id. Raise exception if lead already converted or not visible under RLS.

Migration `068_orders_module.sql` (all `IF NOT EXISTS`, RLS mirroring quotations):
- `products ADD COLUMN stock NUMERIC` (nullable = not tracked).
- `contacts ADD COLUMN hierarchy_level INTEGER` (nullable).
- `order_statuses(id uuid PK, account_id, name, color default '#3b82f6', position int,
  created_at, updated_at)` — shape of `lead_statuses`.
- `account_sequences ADD COLUMN order_seq BIGINT DEFAULT 0, dispatch_seq BIGINT DEFAULT 0`;
  `get_next_order_number()` → 'ORD-' || lpad(seq,4,'0') BEFORE INSERT trigger; same for
  `get_next_dispatch_number()` → 'DSP-0001'.
- `orders(id uuid PK (client-generatable), account_id NOT NULL, user_id NOT NULL,
  contact_id nullable FK, lead_id nullable FK, site_visit_id nullable FK→site_visits,
  order_number text (trigger), date date default now, sub_total, tax_total,
  total_amount numeric(15,2), status text default 'Placed',
  classification text CHECK (classification IN ('direct','primary','secondary')),
  notes text, created_at, updated_at)`.
- `order_items(id uuid PK (client-generatable), order_id FK CASCADE, product_id FK SET
  NULL, product_name text NOT NULL (snapshot), unit, quantity numeric, price numeric,
  tax_rate, tax_amount, sub_total, total, position int, created_at)`.
- `order_custom_values(id uuid PK (client-generatable), order_id FK CASCADE,
  custom_field_id FK, value text, created_at)` — mirrors `quotation_custom_values`.
- `order_dispatches(id uuid PK, account_id, order_id FK CASCADE, dispatch_number text
  (trigger), dispatched_at date default now, transport_name text, tracking_number text,
  notes text, created_at)`.
- `dispatch_items(id uuid PK, dispatch_id FK CASCADE, order_item_id FK, product_name text
  (snapshot), unit, quantity numeric)`.
- Indexes: orders(account_id, date), orders(user_id), orders(site_visit_id),
  order_dispatches(order_id).
- `accounts.settings` new key `order_settings = {hierarchy_enabled: bool,
  levels: [{position:int, name:string}]}` (merge-preserving writes only).

Classification rule (computed at order creation, stored denormalized): hierarchy disabled
→ 'direct'; enabled + customer hierarchy_level=1 → 'primary'; enabled + level≥2 or null →
'secondary'.

## 5. API Contract

No new HTTP endpoints. Direct Supabase reads/writes under RLS plus one RPC:
- `supabase.rpc('convert_lead_to_customer', { p_lead_id: uuid })` → `uuid` (new contact
  id). Errors: 'Lead not found or not accessible', 'Lead already converted'.
- Mobile order placement: `syncEngine.enqueueMutation('orders','CREATE', orderId,
  payload)` then per-item `('order_items','CREATE', itemId, ...)` and per-custom-value
  `('order_custom_values','CREATE', cvId, ...)` — all client uuids; FK failures self-heal
  via SyncEngine retry (order row lands first on replays).
- Web status change: `orders.update({status})` + module_activities log. Dispatch create:
  insert `order_dispatches` + `dispatch_items` rows.

## 6. Mobile Behavior

- All order writes go through `SyncEngine.enqueueMutation` with client `Crypto.randomUUID()`
  ids (the select-contact.tsx pattern; NOT the direct-supabase pattern). Airplane-mode
  placement must queue and sync on reconnect (auto-flush triggers already exist:
  reconnect, app foreground, pull-to-refresh).
- Catalog + order custom field definitions + order_settings + statuses cached in
  AsyncStorage (useReferenceList/useTaskTypes patterns) so capture works fully offline.
- `order_number` is server-generated on sync — offline orders show "Pending sync" until
  the number arrives; the success alert says so.
- Orders list/detail: last-successful-fetch cache (leadReadRepo pattern). Status is
  read-only on mobile.

## 7. UI States

- Catalog: loading / empty ("No products yet — add products on the web portal") / search
  no-results / offline-from-cache / populated. Stock badge hidden when stock is null.
- Review: empty cart blocked ("Add at least one product"); required custom fields
  validation; placing spinner; offline-queued alert; error alert with retry.
- Orders list: loading / empty / offline-cache / populated; detail: dispatches empty state
  ("Not dispatched yet").
- Web orders: DataTable loading/empty; dispatch dialog validation (qty ≤ remaining, > 0);
  settings hierarchy editor validation (unique level names, 1–5 levels).
- Convert: button hidden when `is_converted`; offline tap → "Requires internet" alert;
  converting spinner; success → navigate to new customer.

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected | Severity |
|---|---|---|
| Order placed fully offline | Queues (order+items+custom values), visible after sync, number assigned on sync | Blocker |
| Items sync before order row (FK) | Retry self-heals on next flush pass (max 5 retries) | Blocker |
| Visit target is a Lead (not customer) | Order allowed: `lead_id` set instead of `contact_id`; classification 'secondary' when hierarchy on (leads have no level), 'direct' when off | Warning |
| Hierarchy disabled after orders exist | Old orders keep stored classification (denormalized by design) | Info |
| Customer has no level while hierarchy on | Classified 'secondary'; web customer page nudges admin to set level | Info |
| Dispatch qty > remaining | Blocked client-side in dialog | Warning |
| Convert tapped twice / already converted | RPC raises 'already converted'; UI hides button when is_converted | Blocker |
| Convert mid-failure | Impossible partial state — single transaction (RPC) | Blocker |
| Stock shows 0/null | 0 shows "Out of stock" badge but ordering is NOT blocked (stock is informational) | Info |

## 9. Reuse Check

Antigravity must search for these before writing new code:
- `032_quotations_module.sql`, `063_*` (schema + numbering + RLS template),
  `quotation-form.tsx`, `product-details-table.tsx` (web line-item patterns).
- `tasks-settings.tsx` (settings JSONB merge-write), `settings-sections.ts`,
  lead-statuses settings panel (order statuses manager model).
- Mobile: `useReferenceList`, `useTaskTypes`, `Select`/`SelectModal`,
  `GlassDateTimePicker`, `SupabaseLeadReadRepository` (offline read-cache model),
  `select-contact.tsx` (offline-first create), Contacts/Leads filter-modal style,
  `useCustomFields` (extend for editable rendering), `LineItem` type shape.
- Web leads `[id]/page.tsx` `handleConvert` (to be replaced by the RPC call).

## 10. Open Questions

None — all decisions confirmed during scoping discussion on 2026-07-21/22 (stock: manual
field now; statuses: configurable now; convert: keep lead + shared RPC; rename: both apps;
dispatch: partial-capable with line quantities).

## 11. Acceptance Criteria

- **Functional:** Airplane-mode order capture end-to-end; classification correct for
  level-1 (primary), level-4 (secondary), hierarchy-off (direct); admin status change
  visible on mobile after refresh; partial dispatch (60 of 100) then second dispatch (40)
  both visible on mobile with transport/tracking; order + dispatch share summaries
  readable; custom text + dropdown fields fillable on mobile and visible on web; convert
  keeps lead flagged + badge on both apps; no user-visible "Contact" remains except the
  lead's "Contact Person" field.
- **Code Quality:** `tsc --noEmit` zero new errors both repos; no unjustified `any`.
- **Architecture:** All mobile writes via SyncEngine; RLS on every new table; settings
  writes merge-preserving; reuse per Section 9.
- **Testing:** SQL verification of numbering trigger + RPC atomicity (verified via
  Supabase MCP); on-device offline test by the user (cannot be automated here — stated
  explicitly in the final report).
- **Security:** RLS mirrors quotations (member read/write, admin delete); RPC invoker
  rights; no cross-tenant leakage (queries always account-scoped).
- **Performance:** Catalog cached locally; orders list paginated (20/page).
- **Documentation:** This spec; handbook updated with new tables + `order_settings` key.
- **Production Readiness:** Migrations additive/IF NOT EXISTS; no destructive changes;
  feature degrades to 'direct' classification when config absent.

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip
steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything
1. Read the full Engineering Handbook for the current tech stack, architecture principles,
   and code standards.
2. Read this entire specification, including Open Questions.
3. Search the existing codebase for everything in Section 9 (Reuse Check) before writing
   new code.
4. Identify actual naming conventions by inspecting real files — do not assume.
5. Do not assume offline support exists automatically. Wire every mobile write into
   `SyncEngine.enqueueMutation` with client-generated `Crypto.randomUUID()` ids, following
   `app/visit/select-contact.tsx`. Confirm against the live repo before writing code.

### Step 2 — STOP AND ASK triggers
- Anything in Open Questions is relevant (currently none).
- Existing code conflicts with this spec (e.g. an orders table appears that this spec says
  doesn't exist).
- Behavior not specified for a case you hit (error state, permission edge, type ambiguity).
- You are about to add a new library/dependency/pattern not already in the codebase.
- You are about to change a shared component/service/table in a way affecting other
  features (e.g. `useCustomFields`, `custom_fields` schema, `account_sequences`).

Ask a specific, answerable question — not "should I proceed?".

### Step 3 — Implementation rules
- TypeScript strict; zero errors; no `any` without a justifying comment.
- Reuse Before Create / Extend Before Replace.
- Match Section 4/5 exactly; deviations are STOP AND ASK.
- RLS on every new table/query; never rely on app-level filtering alone.
- Offline-first on mobile: degrade gracefully with no connectivity, sync correctly on
  return. Never send `''` to a uuid column — `null` only.

### Step 4 — Self-verification before declaring done
Check every Section 11 item, category by category. If something can't be verified in your
environment (e.g. on-device airplane-mode test), say so explicitly instead of marking done.

### Step 5 — Report back
1. What was implemented, mapped to spec sections. 2. Deviations and why. 3. New
conventions discovered (for the handbook). 4. Acceptance Criteria not fully verifiable and
why.
