# Rollback plan — Scheme Engine / Pricing Phase 4 (`20260819160000_scheme_engine.sql`)

Additive in spirit, but with one important exception: this migration **`CREATE OR REPLACE`s an
existing function**, `calculate_order_pricing`. Rolling back is therefore not "drop the new
things" — it is "restore the previous definition of that function." No table, column, or row is
altered or dropped by this migration.

## What this migration changes

1. **NEW** `detect_eligible_schemes(uuid, uuid, jsonb, timestamptz)` — pure read, proposes schemes.
2. **NEW** `_scheme_reward_label(text, numeric, numeric, text)` — a tiny label helper.
3. **REPLACED** `calculate_order_pricing(uuid, uuid, jsonb, jsonb, timestamptz [, jsonb])` —
   upgraded from engine_version 2 to 3. **A sixth optional parameter `p_order_schemes jsonb
   DEFAULT NULL` is added.** Because it is optional, every existing 5-argument call site keeps
   working unchanged, and with no scheme inputs the function returns byte-identical money to v2
   (only `engine_version` reads 3 instead of 2).

Nothing reads the scheme tables in *this* migration — the admin UI, order-form suggestions, and
`create_order`/`update_order` forwarding land in later slices. So on its own this migration only
makes the two functions available; it does not change any order that is created today.

## Level 1 — neutralise behaviour, keep the functions

The new functions are inert until something calls them. If a later slice has started calling
`detect_eligible_schemes` and you want to switch schemes off account-wide without dropping code,
deactivate every scheme (they are then never eligible):

```sql
UPDATE schemes SET active = false WHERE account_id = '<ACCOUNT_ID>';
```

Detection returns empty; `calculate_order_pricing` receives no scheme inputs and prices exactly
as engine_version 2 did.

## Level 2 — full teardown (restore engine_version 2)

Order matters: restore the old pricing function **first** (so nothing is left calling a dropped
helper), then drop the new objects.

```sql
-- 1. Restore calculate_order_pricing to its engine_version 2 body.
--    Copy the CREATE OR REPLACE FUNCTION block verbatim from
--    supabase/migrations/084_per_unit_amount_discount.sql and run it here.
--    (That file is the last authoritative v2 definition — 5 params, engine_version 2.)

-- 2. Drop the sixth-parameter overload if Postgres kept it as a separate signature.
--    Re-running 084 replaces the 5-arg signature in place, but the 6-arg variant this
--    migration created is a DISTINCT overload and must be dropped explicitly:
DROP FUNCTION IF EXISTS calculate_order_pricing(uuid, uuid, jsonb, jsonb, timestamptz, jsonb);

-- 3. Drop the new scheme functions.
DROP FUNCTION IF EXISTS detect_eligible_schemes(uuid, uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS _scheme_reward_label(text, numeric, numeric, text);
```

> ⚠️ Step 2 is the subtle one. `calculate_order_pricing` now exists as **two overloads** (5-arg
> from 084, 6-arg from this migration). Postgres routes a 5-arg call to the 5-arg function and a
> 6-arg call to the 6-arg one. Re-running 084 fixes the 5-arg body but leaves the 6-arg overload
> in place, so you must drop the 6-arg signature explicitly or callers passing `p_order_schemes`
> will still hit v3 logic.

**Do not drop** the `schemes`, `scheme_slabs`, `scheme_products`, `scheme_customers` tables — they
predate this migration (migration 075) and hold any scheme definitions an admin has entered. This
migration never touched them.

## What a teardown does not undo

Nothing persistent. This migration writes no rows and consumes no sequences; it only defines
functions. After a Level 2 teardown the database is exactly as it was before the migration, with
`calculate_order_pricing` back at engine_version 2 and the scheme tables untouched.

## Verifying a clean state after teardown

```sql
-- Expect engine_version 2 and no scheme discount on a plain order.
SELECT (calculate_order_pricing('<ACCOUNT_ID>', NULL,
        '[{"product_id":"<ANY_PRODUCT>","quantity":1}]'::jsonb) ->> 'engine_version');  -- => 2
-- Expect: function does not exist.
SELECT to_regprocedure('detect_eligible_schemes(uuid, uuid, jsonb, timestamptz)');       -- => NULL
```
