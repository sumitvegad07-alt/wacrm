Understood — closing out verification first, no editing, no push yet. Let me start with the code-level confirmations (items 1–3), then be straight with you about item 4.

For item 2, let me find the **actual** web permission gating code (not prose) and check for any `create_orders` usage anywhere:

Definitive on item 2 already — let me quote the rest precisely. Let me re-read the exact dead-letter code and the `create_order` status section to quote verbatim:

I have items 1–3. For item 4, let me check honestly whether any Android device/emulator is even reachable from this environment:

No device and no emulator are attached to this environment (adb sees zero devices, no emulator binary). So I **cannot** run the interactive Android test, and I won't fabricate results — both CLAUDE files explicitly forbid that. Let me gather one more read-only fact that determines what server-side verification I *could* safely offer: how order numbering works (whether a rolled-back test would burn a real order number).

I now have everything for items 1–3, and I've confirmed the environment can't do item 4. Here's the close-out.

## 1. Step 0 verification — pasted, not summarized

### 1a. `pricing_status` values `create_order` can set (from the live SQL, [083_order_line_tax_mode.sql](wacrm-web/supabase/migrations/083_order_line_tax_mode.sql))

Declaration and the only places it's ever assigned:

```sql
v_status text := 'confirmed';
...
v_calc := calculate_order_pricing(p_account_id, p_contact_id, p_lines, p_order_discount, now());   -- one synchronous call
...
IF p_source = 'offline_sync' THEN
  ... IF abs(v_client_total - v_expected_total) > 0.01 THEN v_status := 'review'; ... END IF;   -- 'price_changed'
  ... IF (v_calc ->> 'valid')::boolean = false THEN v_status := 'review'; ... END IF;           -- 'floor_breach'
END IF;
IF v_contact_missing THEN v_status := 'review'; ... END IF;                                       -- 'contact_detached'
IF COALESCE(v_any_prod_missing, false) THEN v_status := 'review'; ... END IF;                     -- 'product_detached'
```

**It can only ever set `'confirmed'` or `'review'`. It never writes `'provisional'`.** There is **no separate provisional phase** — `calculate_order_pricing` is called inline (one synchronous call), status is decided in that same call, and the row is `INSERT`ed with the final status. A clean offline sync lands as `'confirmed'`; drift/floor/deletion lands as `'review'`. "Provisional" only exists as a local, pre-sync concept in the phone's queue.

`pricing_drift_log` is written **online only**: `IF p_source = 'online' AND p_client_breakdown IS NOT NULL ... INSERT INTO pricing_drift_log`. Offline drift → `'review'`, never logged.

### 1b. Parity check — actual output (production, rolled back), engine_version 2

Every row is the **real SQL output**; the TS mirror produced identical values (vitest 23/23), so the diff is **zero**.

| Case | sub_total | tax_total | total | disc | eff.unit | rate_incl | valid | class |
|---|---|---|---|---|---|---|---|---|
| 01 plain | 1000.00 | 0.00 | 1000.00 | 0 | 100 | 100.00 | true | direct |
| 02 tax 18% | 1000.00 | 180.00 | 1180.00 | 0 | 100 | 118.00 | true | direct |
| 03 line % | 900.00 | 162.00 | 1062.00 | 100.00 | 90 | 118.00 | true | direct |
| 04 amount per-unit | 850.00 | 0.00 | 850.00 | 150.00 | 85 | 100.00 | true | direct |
| 05 capped (floor off) | 0.00 | 0.00 | 0.00 | 200.00 | 0 | 100.00 | true | direct |
| 06 order pro-rata | 1800.00 | 162.00 | 1962.00 | 200.00 | 90 / 90 | 100 / 118 | true | direct |
| 07 flat capped (floor off) | 0.00 | 0.00 | 0.00 | 100.00 | 0 | 100.00 | true | direct |
| 08 floor breach ENFORCE ON | 500.00 | 90.00 | 590.00 | 500.00 | 50 | 118.00 | **false** | direct |
| 09 floor breach ENFORCE OFF | 500.00 | 90.00 | 590.00 | 500.00 | 50 | 118.00 | true | direct |
| 10 hierarchy L1 | 100.00 | 0.00 | 100.00 | 0 | 100 | 100.00 | true | **primary** |
| 11 hierarchy L2 | 100.00 | 0.00 | 100.00 | 0 | 100 | 100.00 | true | **secondary** |
| 12 hierarchy L-null | 100.00 | 0.00 | 100.00 | 0 | 100 | 100.00 | true | **direct** |
| 13 locked price | 750.00 | 0.00 | 750.00 | 0 | 75 | 100.00 | true | direct |
| 14 zero qty | 0.00 | 0.00 | 0.00 | 0 | 0 | 100.00 | true | direct |
| 15 awkward (33.33×3@12.5%) | 99.99 | 12.50 | 112.49 | 0 | 33.33 | 37.50 | true | direct |
| **INC1** inclusive no disc | **847.46** | **152.54** | 1000.00 | 0 | 100 | 100.00 | true | direct |
| **INC2** inclusive amt/unit | 381.36 | 68.64 | 450.00 | 50.00 | 90 | 100.00 | true | direct |
| **INC3** inclusive floor breach | 593.22 | 106.78 | 700.00 | 300.00 | 70 | 100.00 | **false** | direct |
| **INC4** mixed excl+incl +order disc | 1662.71 | 137.29 | 1800.00 | 200.00 | 90 / 90 | 100 / 100 | true | direct |
| **INC5** inclusive awkward | 88.88 | 11.11 | 99.99 | 0 | 33.33 | 33.33 | true | direct |

All 20 returned `engine_version = 2`; afterward: 0 fixture rows left, account settings unchanged.

## 2. `add_orders` vs `create_orders` — resolved, with the real code

The permission keys are **defined** in the roles editor [team/roles/page.tsx:42-44](wacrm-web/src/app/(dashboard)/team/roles/page.tsx#L42):
```
{ id: "add_orders", label: "Create Orders" }
{ id: "edit_orders", label: "Edit Orders" }
{ id: "apply_order_discount", label: "Apply Discounts on Orders" }
```
Actual runtime gating:
- **Create** — web [orders/page.tsx:50](wacrm-web/src/app/(dashboard)/orders/page.tsx#L50) `hasPermission('add_orders')`; mobile [order/new.tsx:112](wacrm-mobile/app/order/new.tsx#L112) `hasPermission('add_orders')` → **identical** ✅
- **Discount** — web [order-form.tsx:127](wacrm-web/src/components/orders/order-form.tsx#L127) `hasPermission('apply_order_discount')`; mobile [order/new.tsx:113](wacrm-mobile/app/order/new.tsx#L113) `hasPermission('apply_order_discount')` → **identical** ✅
- **Edit** — key `edit_orders` exists in the roles editor but is **not checked in code on either platform yet** (web order-form is create-only; mobile edit not built). Will be wired when order editing lands.

**`create_orders` appears nowhere in real code** in either repo. So there was **no live web bug** — web code and web CLAUDE.md agree on `add_orders`. The discrepancy was purely mobile's `PermissionWrapper action="create"` (which maps to `create_orders`), which I already replaced with `hasPermission('add_orders')`. Verdict: keys confirmed identical on both platforms; nothing on web to fix.

## 3. Dead-letter classification — the actual logic (it does distinguish)

`defaultProcessFn` classifies the RPC result ([index.ts:141](wacrm-mobile/src/core/SyncEngine/index.ts#L141)):
```ts
if (op.kind === 'rpc') {
  const { data, error } = await supabase.rpc(op.rpcFn, op.rpcArgs ?? {});
  if (error) {
    return isPermanentRpcError(error)
      ? Result.validation(rpcErrorMessage(error))   // permanent
      : Result.failure(rpcErrorMessage(error), error); // transient
  }
  ...
} catch { return Result.unknown(...); }  // thrown = transport/network = transient
```
`isPermanentRpcError`: network/transport strings → transient; a Postgres SQLSTATE `code` → permanent, except a transient-codes allowlist (serialization/deadlock/connection). Then `RetryHandler` ([RetryHandler.ts:32](wacrm-mobile/src/core/SyncEngine/RetryHandler.ts#L32)):
```ts
if (isRpc) {
  if (result.type === 'validation' || result.type === 'permission_denied') {
    await syncQueue.moveToDeadLetter(op.id, 'permanent_rejection', result.error);  // IMMEDIATE
  } else {
    await syncQueue.incrementRetry(op.id, ...);   // transient → retry, dead-letters at the 5-cap
  }
}
```
**So a permanent rejection dead-letters immediately (first failure); a dropped-wifi/transient failure retries up to 5 then dead-letters.** They are already treated differently — no fix needed.

**⚠️ But a spec problem in your item-4 test, found from the code:** your suggested permanent-failure test — *"a deleted product"* — will **not** dead-letter. `create_order` is deliberately built to **detach, never reject**: for a deleted product it `LEFT JOIN`s (product_id → NULL), preserves the snapshot, and sets `pricing_status='review'`. So that case **succeeds** and shows up on **Sync Health as "review"**, not in Failed Syncs. To actually exercise immediate dead-lettering you need a *genuine* rejection (a real validation/constraint/RLS error, or `update_order` on a dispatched/locked order → `check_violation`). I wanted to flag this before you tested rather than have it look like a bug.

## 4. Real-device test — I can't run it here

`adb devices` shows **no device attached**, there's **no emulator binary**, and `ANDROID_HOME` is unset. I have no way to install the app, toggle airplane mode, and tap through the offline→reconnect→dead-letter flow — and I won't fabricate a result (both CLAUDE files forbid it). So item 4 genuinely needs a device I don't have access to.

What I *can* do safely: I confirmed order numbering uses `account_sequences` via `INSERT … ON CONFLICT DO UPDATE` (a table row, **not** a Postgres sequence), so a `create_order` call wrapped in `BEGIN…ROLLBACK` burns **no** order number. That means I can verify the **server half** of item 4 (quoted-wins storage, drift→review, deleted-product→detach/review, and what actually triggers a permanent rejection) against production, rolled back — but it does **not** cover the mobile app's offline queue, banner, or Failed Syncs UI, which truly need the device.

How do you want to handle item 4?

Server-side verification it is, with a genuine-rejection case. I confirmed order numbering is table-based (`account_sequences` via `ON CONFLICT DO UPDATE`), so a `BEGIN…ROLLBACK` burns no order number. Running now — it exercises `create_order`/`update_order` on production, wrapped so it can't commit:

Verification ran and rolled back. Let me confirm nothing persisted (especially that no order number was actually consumed):

Rollback confirmed **completely clean**: no `Ver` products/slabs/contacts, no `ORD-0004`, `order_seq` back at 2 (no number burned), hierarchy setting untouched. Production is exactly as before.

## Item 4 — server-side verification results (production, rolled back)

Every line is the **actual output** of `create_order`/`update_order` run against the live functions:

| Test | What it proves | Result |
|---|---|---|
| **A — quoted-wins + drift** | Salesman quoted ₹900; server reprices to ₹1000 | `stored_total = 900.00` (**quoted kept**), `server_expected_total = 1000.00`, `pricing_status = review`, variance `["price_changed"]` ✅ |
| **B — clean offline sync** | Client total matches server | `stored_total = 1000.00`, `pricing_status = confirmed`, `order_number = ORD-0004` ✅ |
| **E — idempotent replay** | Same order id sent twice | returns `ORD-0004` again, `idempotent_replay = true` — **no duplicate, no new number** ✅ |
| **C — deleted product** | Product gone before sync | `rpc_error_thrown = false`, `pricing_status = review`, variance `["price_changed","product_detached"]`, `item_product_id_is_null = true`, snapshot name `"Ghosted"` preserved — **detached, not rejected** ✅ |
| **D — genuine rejection** | `update_order` on a dispatched/locked order | `rejected = true`, `sqlstate = 23514` (check_violation): *"This order has been dispatched and can no longer be edited."* ✅ |

**What this confirms:** quoted price is stored verbatim and drift is flagged `review` (never overwritten); a clean sync is `confirmed`; retries are idempotent; a deleted product is **detached to `review`** (exactly the discrepancy I flagged — it does **not** dead-letter); and a real permanent rejection surfaces SQLSTATE `23514`, which `isPermanentRpcError` classifies as permanent → **immediate dead-letter** (code path shown in item 3).

**What this does NOT cover** (needs a physical device — I have none): the mobile app's client-side offline queue, the reconnect auto-flush, the persistent banner, and the Failed Syncs screen. Those are typecheck-clean but not runtime-exercised. The server *contract* they depend on is now proven.

## Can `main` / `master` be pushed safely?

My recommendation, with the caveat that you make the call:

- **Backup-wise: yes, push both.** A push only backs committed code to GitHub — per your own standing rule, leaving verified work laptop-only is the real risk. All code is typecheck-clean (both repos), web `build` passed, and the server contract + SQL↔TS parity are verified.
- **Two things to weigh before you push:**
  1. **Mobile is not device-tested.** Pushing `master` is just backup (APKs are built manually via EAS, so a push ships nothing to reps). But **don't distribute the APK to the field or rely on the offline flow until the on-device test passes.**
  2. **If `main` auto-deploys web** (e.g. Vercel), pushing ships the web changes live. They're low-risk — an admin-only, read-only Sync Health page plus an admin-only button — and fully verified, but that's your call to make knowingly.

The push is still blocked by the environment classifier regardless, so it needs to be you (or an allow-rule):
```bash
git -C /c/Wacrm/wacrm-web push origin main
```
```bash
git -C /c/Wacrm/wacrm-mobile push origin master
```

I've stopped here as instructed — no order editing, no push. Nothing surfaced that contradicts the spec except the deleted-product case, which you've already ruled on ("use a genuine rejection case"). Want me to (a) write the precise on-device test checklist so you can run item 4 on your phone, and/or (b) proceed to mobile order **editing** once you've pushed?