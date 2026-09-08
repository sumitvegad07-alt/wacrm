# Feature Specification: Multi Unit (Product Unit Conversion)

**Status:** BUILT & PUSHED by Claude Code 2026-09-08 (web 357aa87 → Vercel, mobile 97645ae). DB migration applied to prod + verified. Remaining: report base-quantity measure, mobile APK build, live screen-verify.
**Module:** CRM → Catalogue / Orders (Order Management) + Field Force (mobile order entry) + Stock
**Date:** 2026-09-08

---

## 1. Feature Overview

- **Problem:** Today a product carries exactly **one** unit (`products.unit_id` → `product_units`, or the legacy `products.unit` text). A rep can only order in that single unit. Real distribution businesses buy/sell the same product in nested packs — PCS, BOX, CARTON — where `1 BOX = 12 PCS`, `1 CARTON = 144 PCS`. There is no way to enter "2 BOX" and have the system understand it means 24 PCS for pricing and stock.
- **Business justification:** wacrm/OZZO sells into FMCG/distribution SMBs (the same market that drives the Order, Scheme and Stock modules). Multi-unit ordering is table-stakes for that market — every competitor (Vyapar, Marg, Zoho Inventory) supports it. Without it, a distributor cannot record a realistic order, and stock counts are meaningless because "2" could mean 2 pieces or 2 cartons.
- **Target use case / industries:** FMCG distributors, wholesalers, and any field-sales org where goods move in packs. A field rep at a shop enters "Qty 2, Unit BOX"; the office sees 24 PCS deducted from stock and priced at the base per-piece rate.

## 2. Scope

**In scope:**
- A workspace toggle **Settings → Extra Settings → Enable Multi Unit** (default OFF).
- Product Master: a **mandatory Base Unit** per product + any number of **alternate conversion units**, each with a **decimal conversion factor** to the base unit.
- Web order form: enter Qty + select Unit → auto-compute Base Qty; a read-only "per selected unit" price helper.
- Mobile order form (React Native): the **same** enter-Qty + select-Unit + auto-Base-Qty behavior (mobile order creation already exists and goes through the same `create_order` RPC).
- Order line persistence of: entered qty, entered unit, conversion factor, base qty, base-unit price, line amount.
- Pricing engine (`calculate_order_pricing`) works entirely in **base units**; amount = base qty × base-unit price. No per-unit price list.
- Stock derived **only in base units** — order→stock and dispatch→stock post the base quantity.
- Schemes/slabs: a per-scheme admin choice of whether quantity thresholds are measured in **base unit or entered unit**.
- Reports: show entered unit **and** converted base quantity.
- Full backward compatibility: OFF = today's behavior unchanged; existing orgs/products/orders keep working with zero data cleanup.

**Out of scope (v1 — do NOT build):**
- Per-unit / per-pack **pricing** (a different price for BOX vs PCS). Explicitly rejected by the founder — price is always base-unit; alternate-unit price is a display-only derivation.
- Unit conversion in **purchase/GRN** documents (no purchase module exists yet).
- Different base units per warehouse/location (single company-wide stock pool only — matches Stock v1).
- Changing a product's base unit **after** it has transactions (base unit locks — see §4).
- Fractional-pack rounding rules / "sell only whole boxes" enforcement. Decimals are allowed everywhere; no whole-number constraint in v1.
- Unit conversion in Quotations (can be a fast follow once Orders is proven; not in v1 unless the order-line pattern drops in trivially — treat as OUT unless separately approved).

## 3. User Roles & Permissions

| Role | Can see | Can do | RLS / tenant implications |
|---|---|---|---|
| Owner / Admin | Extra Settings toggle; product base unit + conversions; all orders | Enable/disable Multi Unit; define base unit + conversion factors on products; order in any unit | All new rows carry `account_id`; RLS `is_account_member(account_id, ...)`. Managing conversions gated by the existing catalogue/product manage permission (`manage_products` / product create-edit keys) — reuse, do not invent a new key unless the founder asks. |
| Agent (field rep) | Unit dropdown on the order line; base-qty readout | Select a unit and enter qty while creating/editing an order (respecting existing order create/edit permission keys) | Cannot edit product master conversions. Order writes already gated by `create_orders`/`edit_orders`. |
| Viewer | Order lines with entered unit + base qty (read only) | Nothing | SELECT only. |

No new permission key is introduced by this feature. If the founder later wants "who can edit unit conversions" separated from "who can edit products," that is a follow-up.

## 4. Data Model

All DDL must be additive, `IF NOT EXISTS`, and safe on live data (112 products, 62 order_items, 13 stock_ledger rows in prod today). Use a timestamped migration file `supabase/migrations/<ts>_multi_unit_v1.sql`. Apply the `update_updated_at_column` trigger (NOT `set_updated_at`) to any new table with `updated_at`.

### 4.1 Toggle storage
Store the switch in the existing `accounts.settings` JSONB under a new **`extra_settings`** object:
```json
"extra_settings": { "multi_unit_enabled": true }
```
- Add a SQL helper `multi_unit_enabled(p_account_id uuid) returns boolean` mirroring the existing `stock_module_enabled(uuid)` pattern (default **false** when the key is absent). Reuse this helper everywhere (SQL + a TS mirror in `src/lib`), never re-read the JSON path inline.
- **Why a new `extra_settings` object, not `product_settings`:** the founder named the location "Extra Settings" and it is likely to accumulate other cross-cutting toggles. Keep it as its own namespace.

### 4.2 Product base unit — RESOLVED: reuse `products.unit_id`
**Open Question #1 resolved by code inspection (2026-09-08):** the product form (`product-form.tsx`) already saves the selected unit as `products.unit_id` and writes legacy `unit` text as `null`. So **`products.unit_id` IS the base unit** — no new `base_unit_id` column is added. The base unit = `unit_id`, implicit conversion factor 1; alternate units live in the conversions table (§4.3).

- No product-table column change for the base unit. Multi-unit ON simply means: base = `products.unit_id`, plus zero-or-more `product_unit_conversions` rows.
- Products with only legacy text `unit` and no `unit_id` (there are ~106) keep behaving as single-unit; the admin sets a real `unit_id` from the product form (existing UI) before adding conversions. No backfill needed — `unit_id` already carries whatever unit the product had.
- **Do NOT drop or repurpose `products.unit` / `products.unit_id`.**

### 4.3 Conversion units (new table)
```sql
CREATE TABLE IF NOT EXISTS public.product_unit_conversions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id           uuid NOT NULL REFERENCES product_units(id),
  conversion_factor numeric(18,6) NOT NULL CHECK (conversion_factor > 0),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, unit_id)
);
```
- `conversion_factor` = **how many base units one of this unit equals** (BOX → 12, CARTON → 144). `numeric(18,6)` supports decimals up to 6 places (requirement #9/#11).
- The **base unit itself is not stored here** — it is implicitly factor `1`. The order line's factor for a base-unit selection is `1`.
- RLS: enable, policies `is_account_member(account_id)` for SELECT and `is_account_member(account_id,'agent') AND <product manage key>` for write — mirror the RLS on `product_units` / `products` exactly (read the real policy first; do not guess the key name).
- `update_updated_at_column` trigger attached.

### 4.4 Order line columns (new, additive on `order_items`)
`order_items` today: `unit text`, `quantity numeric(15,2)`, `price`, etc. `quantity` **keeps its meaning = the entered quantity** (backward compatible; every existing reader is unaffected). Add:
- `entered_unit_id  uuid REFERENCES product_units(id)` — the unit the rep picked (the text `unit` column continues to store the unit name snapshot for PDFs/legacy).
- `conversion_factor numeric(18,6) NOT NULL DEFAULT 1` — factor at time of entry (snapshotted, so later master edits never rewrite history).
- `base_quantity     numeric(18,6)` — `quantity * conversion_factor`. Nullable; when NULL (all existing rows) readers fall back to `quantity` (i.e. factor 1).
- `base_unit_price   numeric(15,2)` — the base-unit price used (equals the existing `price`/`price_list_price` base price; stored explicitly for report clarity).

> **Meaning of `quantity` is unchanged.** For a single-unit line (factor 1), `base_quantity == quantity`. The entered unit lives in `unit` (name) + `entered_unit_id` (fk). The line amount columns (`sub_total`, `tax_amount`, `total`) are unchanged in meaning — they already equal base amount because pricing is driven off base qty (see §5).

### 4.5 Dispatch line columns (new, additive on `dispatch_items`)
`dispatch_items` mirrors the order line and feeds dispatch→stock. Add:
- `conversion_factor numeric(18,6) NOT NULL DEFAULT 1`
- `base_quantity     numeric(18,6)` (nullable, fallback to `quantity`)

A dispatch line inherits its `order_item_id`'s unit + factor. Dispatch qty is entered in the **same unit as the order line** in v1 (no unit switching on dispatch).

### 4.6 Scheme unit basis (new, additive on `schemes`)
- `qty_unit_basis text NOT NULL DEFAULT 'base' CHECK (qty_unit_basis IN ('base','entered'))` — admin's per-scheme choice of whether `scheme_slabs.min_qty/max_qty/free_qty` thresholds are measured in base units or entered units. Default `'base'` (consistent with pricing/stock). Existing schemes backfill to `'base'`.

### 4.7 Migration data-safety summary
- 100% additive. No column dropped, no type narrowed.
- Existing 62 order_items: `conversion_factor` defaults 1, `base_quantity` NULL → treated as `quantity`. No behavioral change.
- Existing 13 stock_ledger rows: untouched (ledger is immutable; it already holds base-equivalent quantities because every product was single-unit).
- Existing schemes: `qty_unit_basis = 'base'`.

## 5. API Contract

No new endpoints. Three existing RPCs change; all changes are **no-ops when factor = 1**, so an org with Multi Unit OFF sees byte-identical output.

### 5.1 `calculate_order_pricing(p_account_id, p_contact_id, p_lines, p_order_discount, p_as_of, p_order_schemes)`
Each element of `p_lines` today carries `product_id, quantity, discount_type, discount_value, locked_price, tax_mode, scheme_id, is_scheme_goods, scheme_discount_amount`. **Add one field: `conversion_factor` (numeric, default 1).**

Changes inside the function (bump `engine_version` 3 → 4):
- In `_pricing_scratch`, carry `conversion_factor` and a derived `base_quantity = quantity * conversion_factor`.
- **`gross = ROUND(price_list_price * base_quantity, 2)`** (was `* quantity`). `price_list_price` remains the **base-unit** price (`COALESCE(locked_price, p.price)`).
- Amount discount currently `ROUND(discount_value * quantity, 2)`. **Decision (founder, 2026-09-08): admin-configurable basis, same as schemes.** A new workspace setting `accounts.settings.order_settings.amount_discount_basis` ('base'|'entered', default `'entered'` = today's behavior) decides whether an amount discount multiplies by `quantity` (entered) or `base_quantity`. The engine reads it once per call. Default `'entered'` keeps OFF-state byte-identical. Call this out in a code comment.
- Floor check: `effective_unit = after_item / base_quantity` (was `/ quantity`) so the effective price is **per base unit**, comparable to `products.min_price` (a base-unit floor). This keeps `min_price` semantics intact.
- Emit on each returned line: `conversion_factor`, `base_quantity`, `base_unit_price` (= `price_list_price`), and keep existing `unit`. Add `entered_unit_id` passthrough if the client sends it.
- The TS mirror `src/lib/pricing/*` (the advisory engine used for offline + online drift detection) must receive the **identical** change, and the `sql-parity.md` fixture set must be re-run with new multi-unit fixtures (see §11). This dual-write-under-parity is the single biggest risk — treat it exactly like the Scheme v1 engine parity work.

### 5.2 `create_order(...)` and `update_order(...)`
- Extend the `INSERT INTO order_items (...)` column list + SELECT to persist the new columns: `entered_unit_id`, `conversion_factor`, `base_quantity`, `base_unit_price`, reading them from the priced `v_store -> 'lines'` objects (which now carry them from `calculate_order_pricing`).
- `quantity` continues to store `(ln ->> 'quantity')` = entered qty. `base_quantity` stores `(ln ->> 'base_quantity')`.
- No signature change. Offline/idempotency/quoted-price-wins logic is untouched.
- `update_order` reuses the same line-insert shape (it deletes+reinserts items today — verify and match).

### 5.3 `stock_reconcile_order(p_order_id)` and `stock_reconcile_dispatch(p_dispatch_id, p_account_id)`
- Change the target-quantity sums from `SUM(oi.quantity)` / `SUM(di.quantity)` to **`SUM(COALESCE(oi.base_quantity, oi.quantity))`** / **`SUM(COALESCE(di.base_quantity, di.quantity))`**.
- Everything else (posted-vs-target delta, reversal on cancel, idempotency) is unchanged. Existing rows with NULL `base_quantity` fall back to `quantity` → identical to today.
- Also check `stock_on_order_item_change`, `stock_on_order_change`, `stock_on_dispatch_item_change` triggers — they call the reconcile functions, so no change is needed there, but **read them to confirm** none independently sum `quantity`.

### 5.4 `detect_eligible_schemes(p_account_id, p_contact_id, p_lines, p_as_of)`
- Read each scheme's `qty_unit_basis`. When `'base'`, compare `scheme_slabs.min_qty/max_qty` against `quantity * conversion_factor`; when `'entered'`, against `quantity`. `free_qty` output is expressed in the base unit either way (free goods become a ₹0 order line in base units — confirm against the Scheme v1 free-goods line logic).
- The client passes `conversion_factor` per line (same field as §5.1).
- Mirror the change in the TS `detectEligibleSchemes`.

## 6. Mobile Behavior

- **Mobile order creation already exists** and calls `create_order` via the offline RPC-enqueue path (`SyncEngine` + client UUID). Confirm the exact file (order create screen) in `wacrm-mobile` before editing — do not assume the path.
- The order line UI gains a **Unit picker** (reuse the existing `Select`/`SelectModal` used for lead/contact dropdowns — the same components used for hierarchy level pickers) populated from the product's base unit + its `product_unit_conversions`. Default selection = base unit.
- On unit/qty change, the client computes `base_quantity = qty * factor` locally and shows the base-qty readout + the "per selected unit" price helper (`base_price * factor`, display only).
- The client must send `conversion_factor` in each line of the `p_lines` payload to `create_order`. The **TS pricing mirror** already runs on mobile for the offline estimate — it must include the §5.1 change so the offline-quoted total matches the server.
- **Offline:** conversions are read from the product record. Cache the product's conversion list alongside the product cache (AsyncStorage) so a rep offline at a shop can still pick BOX/CARTON. If the conversion list is unavailable offline, fall back to base-unit-only entry (never block order creation). New writes ride the existing `SyncEngine.enqueue*` path — no new offline plumbing, but **verify** `create_order` is wired through the RPC enqueue (per handbook it is, for orders).
- When Multi Unit is OFF for the account, the mobile order line renders exactly as today (no unit picker, `unit` from product).

## 7. UI States

**Web — Settings → Extra Settings (new card):**
- Loading (settings fetch), toggle OFF (default), toggle ON, save success toast, permission-denied (non-admin sees it disabled via `gated-button`).

**Web — Product form (`products` create/edit):**
- Multi Unit OFF: unchanged (single unit field as today).
- Multi Unit ON: **Base Unit** required dropdown (from `product_units`) + a repeatable **Conversion Units** editor (unit dropdown + factor input, decimals allowed, add/remove rows). Validation: base unit required; no duplicate unit; factor > 0; a unit cannot equal the base unit.
- Base unit **locked** (read-only with an explanatory tooltip) once the product has any `order_items` or `stock_ledger` row — check via a lightweight existence query; alternate units stay editable.
- Empty state (no conversions yet) = product behaves as single-unit.

**Web — Order line editor (`LineItemsEditor`):**
- Multi Unit ON: Unit becomes a **dropdown** (base + conversions) instead of the current read-only unit; a **Base Qty** read-only cell; the price cell keeps the base price with a small "= ₹X / BOX" helper beneath.
- Multi Unit OFF: Unit stays read-only from the product (today's behavior).
- States: loading products, product with no conversions (dropdown shows base only), floor-breach warning (unchanged), scheme suggestion (unchanged), offline (unchanged).

**Reports (order/sales/stock/DSR):** each order line shows `entered_qty entered_unit` and, in a separate column, `base_qty base_unit`. Stock reports remain base-unit only (already true).

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behavior | Severity |
|---|---|---|
| Multi Unit OFF | Zero behavioral change anywhere; `conversion_factor`=1, `base_quantity` NULL/=quantity | Blocker if violated |
| Existing order edited after enabling Multi Unit | Old lines keep `conversion_factor`=1 snapshot; only newly added/edited lines get a real unit/factor | Warning |
| Product has base unit but no conversions | Order shows base unit only, no dropdown clutter | Info |
| Admin edits a conversion factor after orders exist | History unaffected (line snapshots factor); only future lines use the new factor | Blocker if history changes |
| Admin tries to change base unit after transactions | Blocked (locked field) with a clear message | Blocker |
| Decimal factor (e.g. 0.333) | `base_quantity` computed at 6 dp; stock/pricing use full precision, display rounds sensibly | Warning |
| Free-goods scheme line under multi-unit | Free qty expressed in base units; ₹0 line; stock deducts base qty | Warning |
| Offline order with conversions cached | Works; base qty computed locally; quoted total matches server via TS mirror | Blocker if mismatch |
| Offline, conversion list not cached | Falls back to base-unit-only entry; never blocks order save | Warning |
| Dispatch of a multi-unit order | Dispatch line inherits unit + factor; dispatch→stock deducts base qty | Blocker if wrong |
| Legacy product with only text `unit`, no `unit_id` | `base_unit_id` NULL; single-unit behavior; admin can set a base unit later | Info |
| Duplicate unit added as both base and conversion | Rejected by form validation + `UNIQUE(product_id, unit_id)` | Warning |

## 9. Reuse Check

Antigravity **must search for and reuse** these before writing anything new:
- `product_units` table + its settings/master UI (unit name catalog — do NOT create a second unit list).
- `products.unit_id` / `products.unit` handling in the product form and everywhere they're read.
- `stock_module_enabled(uuid)` SQL helper + its TS mirror — copy this exact pattern for `multi_unit_enabled(uuid)`.
- `calculate_order_pricing` + the TS pricing mirror (`src/lib/pricing/*`) + `sql-parity.md` fixtures.
- `create_order` / `update_order` / `stock_reconcile_order` / `stock_reconcile_dispatch` / `detect_eligible_schemes` (exact bodies are in this spec's §5; read the live versions before editing).
- `LineItemsEditor` (web order line component) and the mobile order-create screen + its `Select`/`SelectModal` dropdown components.
- `gated-button` (web) / `PermissionWrapper` (mobile) for permission gating.
- The Stock v1 settings card pattern (`stock_settings` in `accounts.settings`) as the template for the Extra Settings card.

## 10. Open Questions

1. **`base_unit_id` vs existing `unit_id`:** if the product form already treats `unit_id` as the definitive base unit, a separate `base_unit_id` may be redundant. **[Builder (Claude Code) resolves by inspecting the live product form — no founder input needed.]** Reuse `unit_id` as base if the form already sets it; add `base_unit_id` only if `unit_id` is used ambiguously.
2. ~~Quotations~~ **RESOLVED 2026-09-08 (founder): Quotations do NOT get multi-unit. OUT of scope.**
3. ~~Amount-discount basis~~ **RESOLVED 2026-09-08 (founder): admin-configurable, same mechanism as schemes — `order_settings.amount_discount_basis` ('base'|'entered', default 'entered' = today's behavior). See §5.1.**

*(Everything else was confirmed during the 2026-09-08 scoping discussion: builder = Claude Code direct; toggle location = Extra Settings; base unit mandatory + locked after use; conversions in a per-product table with 6-dp decimal factors; pricing/stock in base units; per-selected-unit price helper shown; scheme threshold basis chosen per-scheme, default base; amount-discount basis admin-set (default entered); mobile in full scope; fully backward compatible.)*

## 11. Acceptance Criteria

**Functional**
- [ ] With Multi Unit OFF, product form, order form, order totals, stock postings, schemes and every report are byte-identical to pre-change (verified by re-pricing an existing order and diffing the JSON).
- [ ] With Multi Unit ON, a product can have a base unit + ≥2 conversion units with decimal factors; an order line "2 BOX" (factor 12) stores `quantity=2, conversion_factor=12, base_quantity=24, unit='BOX'`, amount = `24 × base_price`.
- [ ] Stock deducts **24** (base) for that line, not 2 — verified in `stock_ledger` in a rolled-back transaction across all three stock-out modes (order_created / order_closed / dispatch).
- [ ] Scheme with `qty_unit_basis='base'` triggers on 24; with `'entered'` triggers on 2 — both verified.
- [ ] Reports show entered unit + base qty columns.

**Code Quality**
- [ ] TypeScript strict, zero new errors, no `any`. Amount-discount and floor-check base-qty decisions carry explanatory `// why` comments.

**Architecture**
- [ ] `multi_unit_enabled` helper is the single source of truth (SQL + TS), never an inline JSON read.
- [ ] Conversion factor is **snapshotted** on the order/dispatch line; master edits never rewrite history.
- [ ] SQL pricing engine and TS mirror produce identical output on the multi-unit fixture set (parity proven, not claimed).

**Testing**
- [ ] New vitest fixtures for multi-unit pricing (base qty math, decimal factor, floor check per base unit, amount discount per entered unit) pass in both engines; `sql-parity.md` updated.
- [ ] Rolled-back prod-transaction dry-run covering: create multi-unit order → stock delta correct → dispatch → cancel-reversal → edit factor (history unchanged).
- [ ] Existing web test suite stays green (currently ~1192 tests).

**Security**
- [ ] `product_unit_conversions` has RLS enabled with `is_account_member` policies; write gated by the existing product manage permission. Cross-tenant SELECT returns `[]`.
- [ ] All new RPC inputs remain Zod-validated on the client; no raw DB errors surfaced.

**Performance**
- [ ] No N+1: conversions loaded with the product (single relational query / joined), not per-line lookups. Mobile caches conversions with the product.

**Documentation**
- [ ] `engineering-handbook.md` updated: new table, new columns, `multi_unit_enabled` helper, `extra_settings` namespace, engine_version → 4.
- [ ] This spec's Open Questions resolved and recorded.

**Production Readiness**
- [ ] Migration is additive + idempotent; backfill (`base_unit_id = unit_id`, schemes `qty_unit_basis='base'`) verified on a copy of prod counts (112 products / 62 items / 13 ledger).
- [ ] Rollback SQL written and stored under `docs/engineering/incidents/`.
- [ ] `next build` green; mobile `tsc` clean.

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything
1. Read the full Engineering Handbook for the current tech stack, architecture principles, and code standards.
2. Read this entire specification, including Open Questions.
3. Search the existing codebase for anything related before writing new code. Specifically search for: `product_units`, `products.unit_id`, `products.unit`, `products.base_unit_id`, `stock_module_enabled`, `calculate_order_pricing` (SQL + `src/lib/pricing/*` TS mirror + `sql-parity.md`), `create_order`, `update_order`, `stock_reconcile_order`, `stock_reconcile_dispatch`, `stock_on_order_item_change`, `detect_eligible_schemes`, `LineItemsEditor`, the mobile order-create screen, `Select`/`SelectModal`, `gated-button`, `PermissionWrapper`, and the Stock v1 settings card (`stock_settings`).
4. Identify the actual naming conventions currently used (component, file, hook, service naming) by inspecting real files — do not assume.
5. **Do not assume offline support exists for this feature.** `SyncEngine` covers `site_visits`, `activities`, `tracking_sessions`, `location_pings`, and order-create RPC enqueue per the handbook. Confirm order creation is wired through the RPC enqueue path in the live mobile repo before relying on it. New mobile line writes must degrade gracefully offline (fall back to base-unit entry if the conversion list isn't cached) and never block an order save.

### Step 2 — STOP AND ASK triggers
- **Open Question #1 (`base_unit_id` vs `unit_id`)** — you MUST resolve this by inspecting the live product form before adding the column. If `unit_id` already is the base unit, ask whether to skip `base_unit_id`.
- Open Question #2 (Quotations in scope) and #3 (amount-discount basis) are relevant to code you're about to write — confirm.
- You find existing code that conflicts with this spec (e.g. the order line already stores a base quantity somewhere).
- The spec doesn't specify behavior for a case you hit (an error state, a permission edge, a data-type ambiguity).
- You are about to introduce a new library, dependency, or pattern not already used.
- You are about to change a shared component/service/table (`calculate_order_pricing`, `create_order`, `LineItemsEditor`, stock functions) in a way that could affect other features — you ARE changing these; make the changes strictly no-op when `conversion_factor = 1`, and if you cannot guarantee that, STOP AND ASK.

When you stop, ask a specific, answerable question — e.g. "The live product form writes `unit_id` as the product's only unit and treats it as the base. Should I reuse `unit_id` as the base unit and add only the conversions table, or still add a separate `base_unit_id`?"

### Step 3 — Implementation rules
- TypeScript strict: zero errors, no `any` without a justifying comment.
- Reuse Before Create / Extend Before Replace — reuse `product_units`, the pricing engine, the stock functions, the dropdown components. If you wrote new code where existing code could be extended, undo it and extend.
- Match the data model and API contract in §4–§5 exactly. Any deviation is a STOP AND ASK.
- **Every change must be a no-op when Multi Unit is OFF / factor = 1.** This is the backward-compatibility contract. Prove it by re-pricing an existing order and diffing.
- Respect multi-tenant isolation (RLS) on `product_unit_conversions` and every new query. Never rely on app-level filtering alone.
- Snapshot `conversion_factor` on the line; never recompute historical base quantities from the current master.
- Preserve offline-first behavior on mobile — conversions cached with the product; graceful base-unit fallback offline.
- SQL engine and TS mirror must stay in lockstep under the parity fixtures — this is the highest-risk part; do it the way Scheme v1 did.

### Step 4 — Self-verification before declaring done
Check every item in §11 Acceptance Criteria, category by category (Functional, Code Quality, Architecture, Testing, Security, Performance, Documentation, Production Readiness) — not just "looks good." Run the OFF-state diff, the base-qty stock dry-run (rolled back), and the SQL↔TS parity fixtures. If any item can't be verified in your environment (e.g. on-device mobile offline), say so explicitly rather than marking it done.

### Step 5 — Report back
1. What was implemented, mapped to this spec's sections.
2. Any deviations from the spec and why.
3. Any new conventions discovered or introduced (so they can be added to the handbook — especially the resolution of Open Question #1 and the `extra_settings` namespace).
4. Any Acceptance Criteria items that could not be fully verified and why (call out mobile on-device offline explicitly).
