# Feature Specification: Product Stock Management v1

**Status:** Confirmed (founder decisions locked 2026-08-21)
**Module:** CRM / Catalogue (new sub-module)
**Date:** 2026-08-21
**Built by:** Claude Code directly (not Antigravity), same as Leave Management / Location Trust / Scheme Management.

---

## 1. Feature Overview

- **Problem:** WACRM tracks what customers *order* but not what stock the company *has*. A `products.stock` column exists but is dormant (0 of 108 products carry a value) and is a free-form number with no history — it cannot answer "how much is left" or "why". Salesmen booking orders have no visibility of availability and can oversell.
- **Business justification:** Distribution/FMCG field-sales customers (WACRM's core market) live and die by stock. Knowing closing stock at order time prevents overselling and dead promises; a stock ledger gives the audit trail an SMB needs for shrinkage/damage/returns.
- **Target use case:** An admin sets opening stock and records purchases as "Stock In". As orders flow, stock depletes automatically. A field rep creating an order sees each product's closing stock inline. An admin reviews a stock report and can explain any number document-by-document.

**Governing design principle — "just like payment outstanding":** Outstanding is never stored; it is recomputed live as `opening balance + Closed orders − Approved payments` (`src/lib/payments/financials.ts`). Stock mirrors this exactly:

> **Closing stock = SUM of signed rows in `stock_ledger`** (opening + inward − outward − reversals), computed live, never a stored counter that can drift.

## 2. Scope

**In scope (v1):**
- Catalogue Settings toggle **"Enable Stock Management"** (`module_settings.stock`, opt-in, default OFF).
- Two admin-configurable behaviours (in `accounts.settings.stock_settings`):
  - **Stock-out event** — which event depletes stock: `order_created` | `order_closed` | `dispatch` (default `order_closed`, mirroring outstanding). Changing it is **future-only**.
  - **Restrict on insufficient stock** — boolean (default OFF): when ON, block an order line whose quantity exceeds available closing stock.
- Single company-wide stock pool per product.
- Per-product **"Maintain stock"** flag (`products.track_stock`, default ON) + **Opening stock** (`products.opening_stock`).
- `stock_ledger` immutable audit table; closing stock derived by SUM.
- Manual **Stock In / Stock Out** with mandatory reason codes: Sales Return, Damage, Expiry, Theft/Loss, Stock Correction, Physical Count Adjustment, Transfer In, Transfer Out.
- **Automatic reversals:** cancelled/rejected/reversed order returns stock; cancelled/deleted dispatch returns stock; "deleting" a stock-out posts an offsetting reversal row. Never a physical delete.
- Closing stock shown on the **web AND mobile** order forms (mobile = cached best-effort snapshot).
- New **Stock report** with three views: Closing stock position · Stock movement ledger · Low/out-of-stock list.
- Permissions `view_stock`, `manage_stock`.

**Out of scope (v1) — logged, deliberately deferred:**
- Per-warehouse/godown stock; per-salesman (van) stock.
- Batch / expiry-date / serial tracking.
- A full Purchase Order / GRN document module (v1 inward = opening stock + manual Stock In).
- Stock valuation in ₹ (weighted-average / FIFO cost).
- Multi-location transfers as real documents (Transfer In/Out exist only as manual reason codes for the single pool).
- Reorder-level automation / low-stock WhatsApp alerts (report only shows the list).

## 3. User Roles & Permissions

| Role | Can see | Can do | RLS / tenant |
|---|---|---|---|
| Owner / Admin | Everything | Enable module, set both settings, set opening stock, create Stock In/Out, view report | Bypass via role; `manage_stock` implied |
| Employee with `manage_stock` | Stock screens + report | Set opening stock, create Stock In/Out adjustments | Scoped to `account_id` |
| Employee with `view_stock` | Stock screens + report + closing stock on order form | Read only | Scoped to `account_id` |
| Employee without either | Closing stock still shown on order form (needed to sell) | Cannot open the Stock screen or report | Scoped |
| Viewer (system role) | SELECT only | — | RLS SELECT only |

- `manage_stock` implies `view_stock`. Owner/Admin/superadmin bypass, consistent with `has_permission()`.
- **The ledger is server-authoritative.** Manual adjustments go through an RPC that checks `has_permission(..., 'manage_stock')` → 42501, so a hidden button cannot be bypassed via REST (the payment/leave lesson).
- Reversal ledger rows are written by SECURITY DEFINER triggers (the order/dispatch actor was already authorised for that document; re-checking `manage_stock` on them would wrongly block a legitimate cancellation).

## 4. Data Model

### 4.1 `products` (additions)
- `opening_stock numeric NULL` — starting balance, entered on the product form (the "opening balance" equivalent). Editing it re-syncs the single `opening` ledger row (trigger, §5.4).
- `track_stock boolean NOT NULL DEFAULT true` — products with it OFF (services, made-to-order) show no stock, are excluded from the report, and never block an order.
- Legacy `products.stock` is **left untouched and deprecated** (empty in prod; not dropped per the no-destructive-drop rule). The product form stops writing it.

### 4.2 `stock_ledger` (new — immutable audit + math source)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK `default gen_random_uuid()` | |
| `account_id` | uuid NOT NULL | tenant |
| `product_id` | uuid NOT NULL → `products(id)` ON DELETE CASCADE | closing stock is moot once a product is gone |
| `quantity` | numeric NOT NULL | **signed**: `+` inward, `−` outward |
| `entry_type` | text NOT NULL CHECK in (`opening`,`manual_in`,`manual_out`,`sale_out`,`reversal`) | |
| `reason_code` | text NULL | mandatory for `manual_in`/`manual_out` (CHECK), set to source reason for auto-reversals |
| `source_type` | text NULL CHECK in (`opening`,`manual`,`order`,`dispatch`) | what caused the row |
| `source_id` | uuid NULL | order_id / dispatch_id (NULL for opening/manual) |
| `source_ref` | text NULL | snapshot of order_number/dispatch_number for the ledger report |
| `posted_mode` | text NULL | the `stock_out_event` under which a `sale_out` row was posted; enforces future-only (§5.3) |
| `reverses_id` | uuid NULL → `stock_ledger(id)` | set on `reversal` rows |
| `notes` | text NULL | |
| `created_by` | uuid NULL | auth user; NULL for trigger-posted rows |
| `created_at` | timestamptz NOT NULL DEFAULT now() | immutable; **no `updated_at`** |

**Constraints / indexes:**
- Partial unique `(product_id) WHERE entry_type='opening'` — one opening row per product.
- Index `(account_id, product_id)` — the closing-stock rollup (`SUM(quantity) GROUP BY product_id`).
- Index `(account_id, source_type, source_id)` — reconcile lookups.
- Reason-code CHECK: `entry_type IN ('manual_in','manual_out')` ⇒ `reason_code IS NOT NULL AND btrim(reason_code) <> ''`.
- Reason codes are validated against a fixed list in app + a CHECK: `('Sales Return','Damage','Expiry','Theft/Loss','Stock Correction','Physical Count Adjustment','Transfer In','Transfer Out')` (auto-reversals may also use `Order Cancelled`/`Dispatch Cancelled`).
- **No UPDATE/DELETE policy** — the table is append-only; corrections are new rows.

**RLS:** enable; `SELECT` = `is_account_member(account_id)`; `INSERT` = `is_account_member(account_id)` **but** direct client inserts are unnecessary because all writes go through SECURITY-scoped RPCs/triggers. No UPDATE/DELETE policy (append-only). Reversal/auto rows are written by SECURITY DEFINER functions.

### 4.3 Settings (`accounts.settings.stock_settings` jsonb)
```json
{ "stock_out_event": "order_closed", "restrict_on_insufficient": false }
```
`module_settings.stock` (boolean, default false) gates visibility, exactly like `scheme`. Add `"stock"` to `CONFIGURABLE_MODULES` + `DEFAULT_MODULE_SETTINGS` in `src/app/api/account/module-settings/route.ts` and the `ModuleSettings` type in `src/hooks/use-auth`.

## 5. API Contract (RPCs — all SECURITY-appropriate, WHERE-qualified for pg_safeupdate)

### 5.1 `stock_adjust(p_product_id uuid, p_quantity numeric, p_direction text, p_reason_code text, p_notes text, p_ledger_id uuid DEFAULT NULL) → jsonb`
- SECURITY INVOKER. Checks `has_permission(auth.uid(), account, 'manage_stock')` → 42501.
- `p_direction` ∈ (`in`,`out`); writes `entry_type` `manual_in`/`manual_out`, signed quantity.
- Requires a non-blank `p_reason_code` from the allowed list → 23514 otherwise.
- Idempotent on `p_ledger_id` (offline replay returns the same row).
- Returns `{ ledger_id, closing_stock }`.

### 5.2 `stock_reverse_entry(p_ledger_id uuid) → jsonb`
- "Delete" a manual entry = post an offsetting `reversal` row (never a physical delete). Permission-gated. Idempotent (refuses a second reversal of the same row via unique `reverses_id`).

### 5.3 `stock_reconcile_order(p_order_id uuid)` / `stock_reconcile_dispatch(p_dispatch_id uuid)` — internal, SECURITY DEFINER
- Compute the **target** outward quantity per product for the document under the **current** `stock_out_event`:
  - `order_created`: order consumes unless `status IN ('Cancelled','Rejected')`.
  - `order_closed`: order consumes iff `status = 'Closed'`.
  - `dispatch`: consumption is per-dispatch (`dispatch_items`), independent of order status.
- Compare target against the **net already-posted** `sale_out` for that `(source_type, source_id, product_id)` (posts minus reversals). Post the **delta** as new immutable rows — a `sale_out` top-up (negative qty) or a `reversal` (positive qty). **Never edit/delete existing rows.**
- **Future-only guard:** order-mode reconcile only manages rows whose `posted_mode IN ('order_created','order_closed')`; dispatch reconcile only manages `posted_mode='dispatch'`. So flipping the setting never retro-reverses history, and an edit to an old order won't cross modes.
- Skips products where `track_stock=false` or `product_id IS NULL` (deleted/detached product).

### 5.4 Triggers
- `products` AFTER INSERT OR UPDATE OF `opening_stock`,`track_stock` → upsert/void the single `opening` ledger row (delta vs existing opening, as a correcting row, keeping immutability — or update the one opening row in place since it is not a transaction, decision in build: opening row is the one mutable-by-resync exception, documented).
- `orders` AFTER INSERT OR UPDATE OF `status` → `stock_reconcile_order` (when event is order-based).
- `order_items` AFTER INSERT/UPDATE/DELETE → `stock_reconcile_order` (item qty changed via `update_order`).
- `dispatch_items` AFTER INSERT/UPDATE/DELETE → `stock_reconcile_dispatch` + reconcile parent order status side-effects.
- `order_dispatches` AFTER DELETE (cancel path) → reconcile so cancelled dispatch returns stock.
- All triggers no-op when the module is disabled (`module_settings.stock` false) — a guard read at the top.

### 5.5 Closing-stock read (no RPC needed)
`SELECT product_id, SUM(quantity) AS closing FROM stock_ledger WHERE account_id=? [AND product_id = ANY(?)] GROUP BY product_id`. One grouped query feeds the order form, product list, and report. `src/lib/stock/financials.ts` will hold the pure TS helper + a `fetchClosingStock(db, accountId, productIds?)`, mirroring `financials.ts`.

## 6. Mobile Behavior

- **Closing stock is a cached, best-effort snapshot on mobile.** On order-form open (online), fetch the grouped closing-stock for the loaded products and cache in AsyncStorage per account; show it inline. Offline, show the last cached value with a subtle "as of <time>" so a rep is never misled that it is live.
- **Block setting offline:** when `restrict_on_insufficient` is ON and the rep is offline, enforce against the cached snapshot but allow override is NOT given — instead the block is advisory offline (warn, allow) because a stale cache must not strand a real sale. Online, the block is hard (checked against fresh closing stock at save). This is called out to the founder as the honest offline behaviour.
- Orders are created via the `create_order` RPC (existing). Stock depletion is a **server-side** trigger/reconcile — nothing new queues on mobile for the ledger itself; when the queued order syncs, the server reconciles stock. No mobile SyncEngine changes for the ledger.
- No mobile Stock-management screen in v1 (adjustments are an admin/web action). Mobile only *reads* closing stock on the order form.

## 7. UI States

- **Catalogue Settings:** toggle Off (collapsed) / On (reveals the two settings + "Manage stock" link). Plan-gated like scheme if a plan ceiling is later applied (v1: no plan gate).
- **Product form:** when module ON, "Maintain stock" switch + "Opening stock" number (hidden when module OFF or switch off). Loading / saving / error toasts as existing form.
- **Stock screen (`/stock`):** loading skeleton · empty (no tracked products) · populated table (Product · Opening · In · Out · Closing, closing red when ≤0) · adjust dialog · permission-denied (no `view_stock`).
- **Stock ledger / movement view:** per-product drill or global, date-filtered; empty state; each row links to its source order/dispatch.
- **Order form line:** closing stock chip next to product (green/amber/red); when block ON and qty>available → inline error, save blocked; when block OFF → amber warning, save allowed.
- **Report:** the three tabs, each with loading/empty/populated.

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behaviour | Severity |
|---|---|---|
| Module disabled | Triggers no-op; no ledger rows written; no stock UI anywhere | Info |
| Admin flips stock-out event after movements exist | Future documents use new rule; existing rows untouched (posted_mode guard) | Warning |
| Order edited (`update_order` replaces items) | Reconcile posts only the delta; no double-count | Blocker |
| Order Cancelled/Rejected after consuming | Reconcile posts reversal → stock returns | Blocker |
| Dispatch deleted/cancelled | Reconcile returns its stock | Blocker |
| Product deleted | Ledger rows CASCADE away; closing rollup unaffected for others | Info |
| `track_stock=false` product on an order | No sale_out posted; no block | Info |
| Manual out with no reason | Rejected (23514) both client + DB | Blocker |
| Two reps order the last unit offline | Both may save (advisory offline); server reconciles → stock can go negative (shown red). No overselling *hidden* | Warning |
| Opening stock edited down below already-consumed | Closing may go negative; shown red, not blocked | Warning |
| `pg_safeupdate` unqualified write in an RPC | Prevented — every mutating statement is WHERE-qualified and REST-tested | Blocker |
| Reconcile fires when module OFF | Guard returns early | Info |

## 9. Reuse Check

Search/extend before writing new:
- `src/lib/payments/financials.ts` — the derivation + `fetch*Financials` pattern to mirror for `src/lib/stock/financials.ts`.
- `pricing-schemes-settings.tsx` (Catalogue Settings) — add the Enable Stock Management toggle + settings inline here.
- `module-settings/route.ts` + `use-auth` `ModuleSettings` — module gating.
- `has_permission()` SQL + `hasPermission` client — permission gates; add keys to `permissions-registry.ts` and the roles editor.
- `order-form.tsx` (web) + mobile order form — closing-stock display + block hook.
- `product-form.tsx` — opening stock + track_stock inputs.
- Report engine (`src/lib/reports/*`, `reports/<name>/page.tsx`) — the Stock report follows the per-page pattern; where its math (SUM ledger) doesn't fit the generic document-pivot engine, build a purpose-page (like some existing reports) rather than forcing it.
- `account_sequences` + numbering triggers — pattern reference only (ledger has no external number in v1).
- Sidebar (`src/components/layout/sidebar.tsx`) + header route map — nav + page title registration (the "three registrations" gotcha for settings; nav for `/stock`).

## 10. Open Questions

None blocking — all four founder forks + three follow-ups resolved 2026-08-21. Two items to verify live during build (not decisions):
1. Exact dispatch "cancel" mechanism — `order_dispatches` has no `status` column, so a cancelled dispatch = a **deleted** `order_dispatches`/`dispatch_items` row. Confirm the delete path and hook reconcile there. (Verified: dispatch has no status; reversal keys off DELETE.)
2. Default of `stock_out_event` — set to `order_closed` to match outstanding; revisit if the founder prefers `dispatch`.

## 11. Acceptance Criteria (mapped to Definition of Done)

- **Functional:** enabling the module reveals settings; opening stock + Stock In/Out change closing stock; the chosen stock-out event depletes stock; cancel/reject/dispatch-cancel returns it; order form shows closing stock (web+mobile); block setting behaves per §7; report shows all three views.
- **Code Quality:** no `any` without justification; TS strict; `npm run typecheck` + `npm run build` clean (real output pasted).
- **Architecture:** closing stock is derived (SUM), never a stored counter; ledger append-only; RPCs WHERE-qualified and REST-tested (200 not 400); triggers idempotent (order edit posts delta, verified in a rolled-back transaction).
- **Testing:** vitest for `src/lib/stock/financials.ts`; DB scenario suite run in a **rolled-back transaction** against prod (open → in → order-consume → edit → cancel-return → manual out → reversal → closing reconciles to expected) with real output recorded; SQL↔TS parity if a TS mirror computes closing.
- **Security:** RLS on `stock_ledger`; `manage_stock` enforced in the RPC (42501), not UI-only; cross-tenant SELECT returns `[]`.
- **Performance:** closing rollup is one grouped query (indexed); no N+1 on the order form.
- **Documentation:** PROJECT.md gets a Stock Management section; this spec + a ROLLBACK file committed.
- **Production Readiness:** migration applied additively (`IF NOT EXISTS`); rollback SQL written; module ships OFF so no existing account is affected until they opt in.

## 12. Build Plan (executed by Claude Code, in verified slices)

1. **Migration** — products columns, `stock_ledger` (+RLS, constraints, indexes), reason-code/entry CHECKs, RPCs (`stock_adjust`, `stock_reverse_entry`, `stock_reconcile_order`, `stock_reconcile_dispatch`), triggers, `has_permission` keys. Dry-run in a rolled-back transaction with a full scenario harness; then `apply_migration`. Write ROLLBACK file.
2. **Settings + gating** — `stock` in CONFIGURABLE_MODULES/defaults/type; Enable Stock Management toggle + the two settings in Catalogue Settings; permission keys in registry + roles editor.
3. **Product form** — Maintain stock + Opening stock inputs.
4. **Stock screen** (`/stock`) — closing table + adjust dialog + ledger drill; nav + route + title.
5. **Order form (web)** — closing-stock chip + block per setting; `src/lib/stock/financials.ts`.
6. **Stock report** — closing position / movement ledger / low-stock.
7. **Mobile** — cached closing-stock snapshot on the order form + advisory/hard block.
8. **Docs** — PROJECT.md section; verify `typecheck`/`build`; update task-backlog + memory.

Each slice: real command output, no fabricated checks (AGENTS.md absolute rules 1–2).
