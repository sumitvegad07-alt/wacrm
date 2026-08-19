# Feature Specification: Scheme Management (Pricing Phase 4)

**Status:** Confirmed
**Module:** CRM → Orders / Catalogue (pricing pipeline)
**Date:** 2026-08-19

> Founder decisions locked during scoping on 2026-08-19:
> 1. Schemes are **suggested, salesman confirms** — never silently auto-applied to the order.
> 2. **Best single scheme per product line**, with a whole-order value-slab discount allowed to stack on top.
> 3. **Full V1**: admin setup screens + engine wired in **both** SQL and the TypeScript mirror + mobile "add N more to unlock" nudges.
> 4. Scheme setup lives on a **dedicated Schemes page** under the order/catalogue area (the disabled switch in Catalogue Settings becomes a link to it).
> 5. Free goods land as an **auto-added, locked ₹0 line** (qty not free-hand editable; the whole scheme can be declined).
> 6. Value-slab threshold measures the **after-discount subtotal of the scheme's own products** (whole order if scoped to `all`); ₹0 reward lines never count.
> 7. Suggestion defaults: **money discounts pre-checked, free goods opt-in; auto-revalidate on every line edit.**

---

## 1. Feature Overview

- **Problem:** The database has carried scheme tables (`schemes`, `scheme_slabs`, `scheme_products`, `scheme_customers`) since migration `075` (Jul 2026), but **nothing reads them**. The pricing engine `calculate_order_pricing` (SQL, `engine_version 2`) and its TypeScript mirror (`wacrm-web/src/lib/pricing/`) both pass the scheme step through unchanged. In the UI, Catalogue Settings shows a disabled switch reading *"Not built yet."* So a distributor cannot run a single promotion today.
- **Business justification:** Schemes are the primary way FMCG/distribution businesses — wacrm's core market — move stock and hit targets: "buy 10 get 1 free," "order over ₹50k get 3% off," volume slabs. Without them, every promotion is a manual discount a salesman types in by hand, with no consistency, no auditability, and no way for a rep to see what a customer has earned. This is the highest-leverage unbuilt piece of the pricing pipeline.
- **Target use case / industries:** Distributors, wholesalers, FMCG field sales. A salesman standing in a shop (often offline) building an order needs to see, in real time, "this customer has earned a free crate" or "add 2 more cases to unlock 5% off," and choose whether to apply it. An admin at head office needs to define these promotions with product scope, customer targeting, quantity/value slabs, and a live date window.

## 2. Scope

**In scope (V1):**

- **Admin scheme CRUD** — a dedicated `/schemes` page (list + create/edit) on web covering all three existing scheme types: `quantity_slab`, `free_goods`, `value_slab`; both `slab_mode`s (`step_up`, `repeat`); `target_type` (`all`, `specific_customers`); product scope; slab editor; date window; `priority`; `max_free_units_per_order`; `active` toggle.
- **Scheme detection brain** — a deterministic function that, given a draft order (account, contact, line items, as-of date), returns the **eligible schemes and the reward each would produce**, applying the "best single scheme per line + value-slab on top" resolution and `priority` tie-break. Written **twice and pinned by parity fixtures**: an SQL function (`detect_eligible_schemes`) and a TypeScript mirror in `src/lib/pricing/`.
- **Suggest-and-confirm UX** — on the web and mobile order forms, eligible schemes surface as suggestions. Money discounts (`discount_percent`, `discount_amount`, `special_price`) are **pre-checked**; free goods are **opt-in**. Accepting a free-goods scheme **auto-adds a locked ₹0 order line** flagged `is_scheme_goods = true` with `scheme_id` set. Every line edit **re-runs detection and revalidates** accepted schemes, removing any that no longer qualify with a visible notice.
- **Engine integration** — `calculate_order_pricing` consumes the **confirmed** scheme set as input (per-line `scheme_id`, plus the ₹0 free-goods lines) and produces `scheme_discount_amount` deterministically from the scheme definition, in the fixed sequence `catalogue → price list → scheme → salesman discount → order discount → floor`. Bump `engine_version` to `3`. Update the parity fixture suite (`src/lib/pricing/fixtures.ts`, `sql-parity.md`).
- **Mobile nudges** — the mobile order screen shows the same suggestions plus the proactive "add N more of X to unlock 1 free / the next slab" hint, computed offline from the TypeScript detection mirror. All mobile scheme reads/writes must be **offline-first** and routed through `SyncEngine` where they mutate.
- **Order persistence** — confirmed schemes are stored on `order_items` (`scheme_id`, `scheme_discount_amount`, `is_scheme_goods`) — columns that already exist. Free-goods lines persist as real order lines.
- **Explainability** — every scheme effect on an order is labelled with the scheme that caused it, on the order form, the order detail screen, and the PDF/print template.

**Out of scope (V1 — do NOT build):**

- **Target-based schemes** (month-to-date volume, clawback rules) — this is the planned "Phase 5" and is deliberately last.
- **Price lists (Phase 3)** — the price-list step stays a pass-through; do not build it here.
- **`customer_level` / `area` scheme targeting** — the `target_type` CHECK is deliberately extensible but V1 ships only `all` and `specific_customers`.
- **Retroactive re-pricing of existing/dispatched orders.** Locked orders (`locked_at` set) are never touched.
- **Automations/notifications** firing on scheme events.
- **Reporting** on scheme uptake (a "scheme performance" report is a future backlog item, not V1).

## 3. User Roles & Permissions

| Role | Can see | Can do | RLS / tenant implications |
| --- | --- | --- | --- |
| **Admin** | The `/schemes` page, all schemes in their account | Create / edit / activate / deactivate / delete schemes and slabs; set product scope and customer targeting | Existing `075` policies already enforce `is_account_member(account_id, 'admin')` for all writes on `schemes`, `scheme_slabs`, `scheme_products`, `scheme_customers`. **Reuse them — do not add new policies.** |
| **Salesman / rep** | Eligible-scheme suggestions on the order form; scheme labels on order detail | Accept / decline suggested schemes while building an order; cannot create or edit scheme definitions | Existing `075` SELECT policies grant read to any `is_account_member(account_id)`. Detection function is `SECURITY INVOKER` so a rep only ever sees their own account's schemes. |
| **Viewer** | Scheme labels on existing orders (read-only) | Nothing | Read-only; no order creation. |

- **No new RLS policies are needed** — migration `075` already shipped complete, correct policies for all four tables. The detection RPC and engine changes must run `SECURITY INVOKER` so tenant isolation is automatic (same as `calculate_order_pricing`).

## 4. Data Model

**No new tables and no new columns are required.** Everything needed already exists (this is why `075` landed the structure early). Antigravity must verify the live schema matches before writing code, but the intended shape is:

- **`schemes`** — `id, account_id, name, scheme_type ∈ {quantity_slab, free_goods, value_slab}, slab_mode ∈ {step_up, repeat}, target_type ∈ {all, specific_customers}, max_free_units_per_order, priority, starts_on, ends_on, active, created_at, updated_at`. CHECKs: dates sane (`ends_on >= starts_on`), free-cap positive. `updated_at` trigger already wired.
- **`scheme_slabs`** — `id, scheme_id, min_qty, max_qty, min_value, max_value, reward_type ∈ {discount_percent, discount_amount, special_price, free_goods}, reward_value, free_product_id, free_qty`. CHECKs: qty/value bounds sane; `free_goods` rows require `free_product_id` + positive `free_qty`.
- **`scheme_products`** — `(scheme_id, product_id)` PK. The products a scheme applies to. **Empty set for a `value_slab` scoped to `all` = whole order.**
- **`scheme_customers`** — `(scheme_id, contact_id)` PK. Only consulted when `target_type = 'specific_customers'`.
- **`order_items`** — already has `scheme_id` (FK → `schemes`, `ON DELETE SET NULL`, wired in `075`), `scheme_discount_amount`, `is_scheme_goods`. No change.

**Migration notes:**

- Migrations are **additive functions only** — no DDL on existing tables is expected. The two new SQL objects are the detection function and the revised `calculate_order_pricing`.
- Follow the repo's timestamped migration convention (`YYYYMMDDHHMMSS_<slug>.sql` in `wacrm-web/supabase/migrations/`, e.g. `20260819xxxxxx_scheme_engine.sql`). Ship a matching `ROLLBACK-scheme-engine.md`.
- **Supabase is on the FREE plan → no branching.** Apply against production with a tested, forced-rollback dry-run, exactly as prior pricing migrations did. **Do not run destructive statements. Never write test/QA rows into production `schemes`** (see the payment-module prod-pollution incident — this is a STOP-AND-ASK if any seed data is contemplated).

**Data-integrity rules the engine must enforce (business logic, not new constraints):**

- A `quantity_slab` / `free_goods` scheme uses the slab's `min_qty`/`max_qty` bounds; a `value_slab` uses `min_value`/`max_value`. Mixed/nonsensical rows are a validation error in the admin form, not something the engine silently tolerates.
- `special_price` reward = the resulting per-unit price is that value (must respect the product floor at the end of the pipeline).
- Only one scheme's line-level reward may attach per order line (resolution below).

## 5. API Contract

### 5.1 New RPC — `detect_eligible_schemes`

```
detect_eligible_schemes(
  p_account_id  uuid,
  p_contact_id  uuid,
  p_lines       jsonb,   -- [{ product_id, quantity }]  (the current draft, NON-free lines only)
  p_as_of       timestamptz DEFAULT now()
) RETURNS jsonb
SECURITY INVOKER
```

- **Filters schemes** to: `active = true` AND `starts_on <= p_as_of::date` AND (`ends_on IS NULL` OR `ends_on >= p_as_of::date`) AND (`target_type = 'all'` OR the contact is in `scheme_customers`).
- **Resolves per line** the best matching `quantity_slab` / `free_goods` scheme (see §8 resolution), and separately evaluates `value_slab` schemes against the qualifying-product subtotal.
- **Response shape:**

```jsonc
{
  "line_schemes": [
    {
      "position": 1,                 // 1-based index into p_lines
      "product_id": "…",
      "scheme_id": "…",
      "scheme_name": "Buy 10 Get 1",
      "scheme_type": "free_goods",   // or quantity_slab
      "reward_type": "free_goods",   // discount_percent | discount_amount | special_price | free_goods
      "reward_value": 0,             // for money rewards
      "matched_slab_id": "…",
      "free_product_id": "…",        // free_goods only
      "free_product_name": "Crate 1L",
      "free_qty": 2,                 // computed via slab_mode + max_free_units_per_order cap
      "scheme_discount_amount": 0,   // for money rewards, the ₹ off this line
      "default_selected": true,      // money=true, free_goods=false
      "nudge": { "units_to_next": 3, "next_reward_label": "1 more free crate" } // null if none
    }
  ],
  "order_schemes": [                 // value_slab, whole-order level
    {
      "scheme_id": "…",
      "scheme_name": "Big Basket 3%",
      "reward_type": "discount_percent",
      "reward_value": 3,
      "qualifying_subtotal": 51000,
      "applies_to_positions": [1,2], // lines the value discount spreads across
      "default_selected": true,
      "nudge": { "value_to_next": 4000, "next_reward_label": "3% off" }
    }
  ],
  "as_of": "…",
  "engine_version": 3
}
```

- **Errors:** invalid `account_id`/`contact_id` → returns empty arrays (not an error) so the order form degrades gracefully. Malformed `p_lines` → `RAISE` with a clear message (mirrors `calculate_order_pricing`'s tolerance of empty arrays).

### 5.2 Revised RPC — `calculate_order_pricing`

- **New optional input** carried on each element of `p_lines`: `scheme_id` (uuid, the confirmed line-level scheme, or null). Free-goods lines appear in `p_lines` as their own elements with `is_scheme_goods: true`, `scheme_id` set, `quantity` = free qty, and are priced to **₹0** by the engine (never from catalogue).
- **New optional input** at the top level: `p_order_schemes jsonb` — the confirmed `value_slab` scheme(s) to apply as a whole-order discount, spread pro-rata across their qualifying lines (reuses the existing `order_discount_share` machinery).
- **Behavior change:** in the scheme step (currently a labelled pass-through), for any line carrying a `scheme_id`, resolve that scheme's reward **deterministically from its slabs at `p_as_of`** and set `scheme_discount_amount` (money) or price the line to ₹0 (free goods). The sequence and the pro-rata order-discount, floor, and classification logic are otherwise unchanged. **Quoted-price-wins is preserved** — the confirmed scheme set is the salesman's promise; the server records its own recompute into `expected_total`/`pricing_variance` and flags `pricing_status='review'` on disagreement, it never overwrites.
- **`engine_version` → 3** on both SQL and the TS mirror. Update `pricing_drift_log` expectations accordingly.
- `create_order` / `update_order` already pass the line array through to `calculate_order_pricing`; they must forward the new `scheme_id` per line and the `p_order_schemes` argument. Idempotency, `locked_at` guard, and SECURITY INVOKER are unchanged.

### 5.3 TypeScript mirror

- Add `detectEligibleSchemes(...)` to `src/lib/pricing/` mirroring the SQL detection exactly, and extend `calculateOrderPricing(...)` to accept confirmed `scheme_id` per line and the order-scheme input. Extend `types.ts` with the new input/output shapes. Both are advisory (offline + preview) — SQL remains authoritative — and must be pinned by `fixtures.ts` with a refreshed `sql-parity.md` run.

## 6. Mobile Behavior

- **Offline is mandatory here.** A salesman building an order in a shop with no signal must still see eligible schemes and nudges. Detection therefore runs **client-side** via the TypeScript mirror against the products/schemes already cached on the device — the mobile order form must not depend on a live `detect_eligible_schemes` round-trip.
  - **Scheme definitions must be cached on the device.** Confirm how the mobile app currently caches `products`/`tax_slabs` for the order form and cache `schemes` + `scheme_slabs` + `scheme_products` + `scheme_customers` the same way. If there is no such cache path, that is a **STOP AND ASK** (do not silently add a new caching mechanism).
- **Writes go through `SyncEngine`.** Confirmed scheme selections and auto-added ₹0 free-goods lines are part of the order create/edit mutation. Order creation on mobile must route through `SyncEngine.enqueueMutation` following the `VisitService.ts` / offline-punch pattern documented in the handbook — **verify the current real state of order-create offline support before writing code; do not assume it exists.** If mobile order create is currently a direct Supabase call, wiring scheme data changes nothing about that risk — flag it, don't paper over it.
- **Quoted-wins on sync:** the confirmed scheme set travels with the queued order; on flush the server recomputes and, on disagreement, stores its own figure and flags `review` — never overwrites the rep's promised total. Same mechanism already used for salesman discounts.
- **No WatermelonDB assumption** (web-only). Use whatever local store the mobile order form already uses.
- **Battery/permissions:** N/A — no background service, no new sensors.

## 7. UI States

**`/schemes` list (web):**
- *Loading* — skeleton rows.
- *Empty* — "No schemes yet. Create your first promotion." with a Create button.
- *Populated* — table: name, type, product scope count, targeting, window (with a live/expired/scheduled badge computed from `starts_on`/`ends_on`/`active`), priority. Row actions: edit, activate/deactivate, delete (with confirm).
- *Permission-denied* (non-admin reaching the route) — hidden from nav and route guarded; show "Admins only."
- *Error* — inline retry banner.

**Scheme create/edit form (web):**
- Type picker drives which slab fields show (qty bounds vs value bounds; reward-type options; free-product picker only for `free_goods`).
- Product-scope multi-select (searchable, from `products`); customer multi-select shown only when `target_type = 'specific_customers'`.
- Slab editor: add/remove rows; inline validation for overlapping/back-to-front bounds before save.
- *Saving* / *save-error* / *validation-error* states explicit.

**Order form (web + mobile) — the suggestion surface:**
- *No eligible schemes* — nothing shown (no empty-state noise).
- *Eligible schemes present* — a "Schemes" panel: money-discount rows pre-checked, free-goods rows unchecked, each labelled with scheme name and effect. Accepting free goods inserts the locked ₹0 line inline in the item list, visibly tagged and non-editable in qty.
- *Nudge* — subtle hint per line/order: "Add 3 more to unlock 1 free crate." Never blocks.
- *Revalidation on edit* — if a change drops eligibility, the scheme un-applies with a toast/inline notice ("Buy-10-Get-1 removed — quantity fell below 10").
- *Offline (mobile)* — suggestions and nudges still render from cached data; a small "offline" indicator; order queues on save.
- *Floor conflict* — if a confirmed scheme + salesman discount breaches the product floor and enforcement is on, the existing floor-violation UI blocks save (scheme discounts are just another layer the floor governs last).

**Order detail + PDF:** each discounted or free line shows its originating scheme name.

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behavior | Severity |
| --- | --- | --- |
| Two schemes match the same product line | Highest `priority` wins; equal priority → higher reward value to the customer; still equal → lowest `scheme_id` (deterministic). Only one attaches. | Blocker (determinism) |
| A `value_slab` and a line-level scheme both qualify | Both apply — value-slab is whole-order and stacks on top of the per-line scheme, per founder decision. | Info |
| `free_qty` computed exceeds `max_free_units_per_order` | Cap the free units at the scheme's max; nudge reflects the capped amount. | Warning |
| `step_up` vs `repeat` | `step_up`: the single highest slab the qty reaches (20 → the 20+ reward). `repeat`: complete sets only (25 with "every 10 → 1 free" = 2 free, remainder ignored). Must match `075` header comments exactly. | Blocker |
| Free product is out of scope / deleted (`free_product_id` set null by FK) | Scheme's free-goods reward is not offered; slab is treated as non-matching; log nothing to the order. | Warning |
| Salesman edits qty below threshold after accepting | Auto-revalidate removes the scheme and (for free goods) removes the ₹0 line, with a notice. | Blocker (correctness) |
| Salesman manually deletes an auto-added free-goods line | Treated as declining that scheme; it stays declined until qty changes re-trigger detection. | Info |
| Scheme expires (`ends_on` passed) between draft and save | Server recompute at save no longer finds it eligible → `pricing_status='review'` with a clear reason; rep's promised price preserved. | Warning |
| Scheme `special_price` drops below product `min_price` with floor enforcement on | Floor check (last step) blocks save exactly as for any discount. | Blocker |
| Multiple `value_slab` schemes qualify | Best single value-slab (highest `priority`, then largest discount) applies; value-slabs do **not** stack with each other. | Warning |
| Offline: device has stale scheme cache | Detection uses cached definitions; server revalidates on sync and flags drift/review if the customer's earned reward changed. Never silently wrong on the server. | Warning |
| Empty `p_lines` / no contact | Detection returns empty arrays; order form shows no schemes; no error. | Info |
| ₹0 free line counted toward a value-slab threshold | Must NOT count — reward lines are excluded from the qualifying subtotal. Guard explicitly. | Blocker |

## 9. Reuse Check

Antigravity **must search for and reuse/extend these before writing anything new**:

- **SQL pricing engine:** `wacrm-web/supabase/migrations/077_calculate_order_pricing.sql` and its later revisions (`082`, `083`, `084`). Extend this function's scheme step — do not fork a parallel pricing path.
- **TS mirror:** `wacrm-web/src/lib/pricing/calculateOrderPricing.ts`, `types.ts`, `fixtures.ts`, `sql-parity.md`, `calculateOrderPricing.test.ts`. Extend, don't replace.
- **Scheme schema:** `wacrm-web/supabase/migrations/075_schemes.sql` — the tables and RLS already exist; reuse the policies verbatim.
- **Existing settings surface:** `wacrm-web/src/components/settings/pricing-schemes-settings.tsx` — turn the disabled "Schemes" block into a link to the new `/schemes` page; do not build CRUD inside the settings panel.
- **Order forms:** web `src/app/(dashboard)/orders/new` + `[id]`, mobile `app/order/new.tsx` + `app/order/edit/[id].tsx`, and the shared `LineItemsEditor` (`src/components/core/LineItemsEditor.tsx`) — the suggestion panel and ₹0 free lines integrate here.
- **Order RPCs:** `create_order` (`078`), `update_order` (`079`, `082`, `085`) — extend to forward `scheme_id` per line and `p_order_schemes`.
- **Mobile offline:** `SyncEngine` (`wacrm-mobile/src/core/SyncEngine/`) and `VisitService.ts` as the offline mutation pattern.
- **Print/PDF:** the `/print/order/<id>` template used by web + mobile Share — add scheme labels there.
- **Naming:** components PascalCase `.tsx`, hooks `use…` camelCase, services PascalCase `.ts`, server actions camelCase from `"use server"` files. Match a real neighbouring file; if a new file doesn't fit, that's an Open Question, not a guess.

## 10. Open Questions

Resolved during scoping on 2026-08-19 — but these are the ones Antigravity is most likely to hit and must **STOP AND ASK** on if reality differs from the assumption:

1. **Mobile scheme caching path.** The spec assumes the mobile order form already caches `products`/`tax_slabs` locally and that `schemes`+children can ride the same path. If no such cache exists, stop and ask before inventing one.
2. **Mobile order-create offline state.** The handbook notes offline support is real only for `contacts`, `site_visits`, and timeline `activities`. Verify whether mobile order create currently routes through `SyncEngine`. If it does not, adding scheme data does not create the gap but does raise the stakes — surface it, don't silently rely on online-only.
3. **`priority` semantics confirmation.** The `075` comment calls `priority` a "deterministic tie-break when more than one scheme matches." Confirm higher number = higher precedence (spec assumes yes) by inspecting any existing usage before relying on it.
4. **Where `/schemes` sits in nav.** Spec says "under the order/catalogue area." Confirm the exact nav group/route convention against the live web nav map rather than guessing a new top-level item.

## 11. Acceptance Criteria (mapped to Definition of Done)

**Functional**
- [ ] Admin can create/edit/activate/deactivate/delete all three scheme types with slabs, product scope, targeting, window, priority, and free-unit cap, with inline validation for insane slabs/dates.
- [ ] `detect_eligible_schemes` returns correct line-level and order-level eligibility for `step_up` and `repeat`, respecting date window, active flag, and customer targeting — verified against hand-computed fixtures.
- [ ] On the order form, money discounts pre-check and free goods opt-in; accepting free goods adds a locked ₹0 line tagged to the scheme; editing qty revalidates and removes newly-ineligible schemes.
- [ ] `calculate_order_pricing` applies the confirmed scheme set in the fixed sequence and produces correct `scheme_discount_amount` / ₹0 lines, value-slab pro-rata on top, floor governing last.
- [ ] Mobile shows the same suggestions and the "add N more" nudge fully offline.
- [ ] Scheme labels appear on order detail and the PDF.

**Code Quality** — TS strict, zero errors, no unjustified `any`; reused the existing engine and RLS rather than forking.
**Architecture** — one pricing source of truth preserved; scheme logic added to the existing function, not a parallel path; SQL authoritative, TS advisory.
**Testing** — vitest fixtures extended and green; **SQL↔TS parity re-verified and `sql-parity.md` updated with the new run**; `step_up`/`repeat`/cap/value-slab/floor-interaction cases all covered; a drift-log check that `engine_version 3` matches on both sides.
**Security** — reused `075` RLS; detection + engine `SECURITY INVOKER`; a rep cannot read or apply another account's schemes; verified with a cross-tenant probe.
**Performance** — detection is a single set-based query per order draft (no N+1 over lines); acceptable for a 20–30 line order.
**Documentation** — `PROJECT.md` pricing section updated to say schemes are live (remove "nothing reads them yet"); a short ADR for the suggest-and-confirm + best-single-per-line decision; `ROLLBACK-scheme-engine.md` written.
**Production Readiness** — additive migration, tested with forced-rollback dry-run against prod; **no test/QA rows written to production `schemes`**; `locked_at` orders untouched; the Catalogue Settings switch now links to a real page instead of claiming "not built."

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything
1. Read the full Engineering Handbook for the current tech stack, architecture principles, and code standards.
2. Read this entire specification, including Open Questions.
3. Search the existing codebase before writing new code — specifically for: `calculate_order_pricing` (SQL migrations 077/082/083/084), `src/lib/pricing/` (`calculateOrderPricing.ts`, `types.ts`, `fixtures.ts`, `sql-parity.md`), `075_schemes.sql`, `create_order`/`update_order` RPCs, `LineItemsEditor.tsx`, `pricing-schemes-settings.tsx`, the web `orders/new` + `[id]` routes, mobile `app/order/new.tsx` + `edit/[id].tsx`, `SyncEngine` + `VisitService.ts`, and the `/print/order` template.
4. Identify the real naming/routing conventions by inspecting actual files — do not assume.
5. **Do not assume offline support exists for order creation.** Verify against the live mobile repo whether order create routes through `SyncEngine.enqueueMutation` (per `VisitService.ts`). If it does not, say so — do not silently ship online-only scheme behavior. Scheme reads on mobile must work from a local cache; if no cache path exists for `products`, stop and ask.

### Step 2 — STOP AND ASK triggers
- Any Open Question (§10) is relevant to the code you're about to write.
- You find existing code that conflicts with this spec (a different pricing path, an existing detection helper, a different `priority` meaning).
- The spec doesn't specify behavior for a case you hit (an error/permission/data edge).
- You are about to introduce a new library, caching mechanism, dependency, or pattern not already used.
- You are about to change a shared component/service/table (`calculate_order_pricing`, `LineItemsEditor`, `create_order`) in a way that could affect other features.
- **Any seed/test data into production `schemes` is contemplated** — always stop and ask (prior prod-pollution incident).

When you stop, ask a specific, answerable question — e.g. "Mobile order create currently calls Supabase directly, not `SyncEngine` — should scheme-bearing orders be part of a broader offline-order-create fix, or ship online-only for now?"

### Step 3 — Implementation rules
- TypeScript strict: zero errors, no `any` without a justifying comment.
- Reuse Before Create / Extend Before Replace — extend `calculate_order_pricing` and the TS mirror; do not fork a second pricing path.
- Match the data model and API contract here exactly. SQL is authoritative; the TS mirror must stay pinned to it via `fixtures.ts` — change one side and you must change and re-verify the other, updating `sql-parity.md`. Bump `engine_version` to 3 on both.
- Respect multi-tenant RLS — reuse `075`'s policies; run detection + engine `SECURITY INVOKER`.
- Preserve offline-first on mobile — suggestions/nudges must degrade gracefully with no connectivity and sync correctly on return; quoted-price-wins on sync is preserved.
- Migrations additive only, timestamped, with a matching `ROLLBACK-*.md`. Free plan = no branching; dry-run against prod with forced rollback; never write test rows to prod.

### Step 4 — Self-verification before declaring done
Check against every Acceptance Criterion (§11), category by category (Functional, Code Quality, Architecture, Testing, Security, Performance, Documentation, Production Readiness). Explicitly re-run and cite the SQL↔TS parity result. If any item can't be verified in your environment (e.g. offline sync on a real device), say so plainly — do not mark it done.

### Step 5 — Report back
1. What was implemented, mapped to this spec's sections.
2. Any deviations and why.
3. Any new conventions discovered/introduced (for the handbook).
4. Any Acceptance Criteria that could not be fully verified and why.
