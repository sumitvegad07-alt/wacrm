# ROLLBACK — Multi Unit v1 (`20260908130000_multi_unit_v1.sql`)

Applied to production 2026-09-08. This migration is **100% additive** and every function
change is a no-op when `conversion_factor = 1`, so leaving it in place is harmless even if the
feature is never turned on. Roll back only if a defect is found.

## What it changed
- New helper `multi_unit_enabled(uuid)`.
- New table `product_unit_conversions` (+ RLS, indexes, updated_at trigger).
- New columns: `order_items.{entered_unit_id, conversion_factor, base_quantity, base_unit_price}`,
  `dispatch_items.{conversion_factor, base_quantity}`, `schemes.qty_unit_basis`.
- Rewrote 5 functions (engine_version 3 → 4): `calculate_order_pricing`, `create_order`,
  `update_order`, `stock_reconcile_order`, `stock_reconcile_dispatch`, `detect_eligible_schemes`.

## To roll back the FUNCTIONS only (safest — reverts behaviour, keeps columns/table dormant)
Re-apply the pre-migration function bodies (engine_version 3). They are preserved in the
git history of this repo immediately before commit for `20260908130000`. Because the new
columns are additive and unused by the v3 bodies, restoring the v3 functions fully reverts
behaviour while leaving the columns in place (harmless, all default/nullable).

```sql
-- restore v3 bodies (copy from git: the versions live in the migrations that created them —
-- calculate_order_pricing/create_order/update_order: order + scheme migrations;
-- stock_reconcile_order/_dispatch: stock-management migration;
-- detect_eligible_schemes: scheme-engine migration). Re-run each CREATE OR REPLACE.
```

## To fully remove (only if you must drop the schema)
Run AFTER restoring v3 functions, and ONLY if no account has multi_unit data:
```sql
-- Safety check: refuse if any real multi-unit data exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_unit_conversions)
     OR EXISTS (SELECT 1 FROM public.order_items WHERE base_quantity IS NOT NULL AND conversion_factor <> 1)
  THEN RAISE EXCEPTION 'Multi-unit data exists — remove/settle it before dropping columns.'; END IF;
END $$;

ALTER TABLE public.order_items
  DROP COLUMN IF EXISTS entered_unit_id,
  DROP COLUMN IF EXISTS conversion_factor,
  DROP COLUMN IF EXISTS base_quantity,
  DROP COLUMN IF EXISTS base_unit_price;
ALTER TABLE public.dispatch_items
  DROP COLUMN IF EXISTS conversion_factor,
  DROP COLUMN IF EXISTS base_quantity;
ALTER TABLE public.schemes DROP COLUMN IF EXISTS qty_unit_basis;
DROP TABLE IF EXISTS public.product_unit_conversions;
DROP FUNCTION IF EXISTS public.multi_unit_enabled(uuid);
-- Also remove the toggle from any account that set it:
-- UPDATE public.accounts SET settings = settings #- '{extra_settings,multi_unit_enabled}';
```

## Verification performed at apply time (2026-09-08, all against production, rolled back)
- Backward-compat: re-priced all 38 existing orders with v4; 37 identical to stored, the 38th
  (ORD-0001, a pre-pricing-engine legacy order with NULL price_list_price/tax) explained by
  its current product price/tax, not by the engine change.
- Multi-unit pricing: 2 × factor 12 → base 24, line ₹3,600, total ₹3,672 (2% tax), engine v4.
- Stock: order line 2 BOX (base 24) deducted −24 from `stock_ledger`, not −2.
- Scheme basis: min_qty 20, base 24 qualifies (₹360 = 150×24×10%); switched to 'entered',
  entered qty 2 correctly does NOT qualify.
