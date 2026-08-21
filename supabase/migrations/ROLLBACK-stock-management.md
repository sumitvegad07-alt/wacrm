# Rollback — Stock Management v1

Migrations: `20260821120000_stock_management.sql` + `stock_management_reason_check_fix`.

The module ships OFF (`module_settings.stock` defaults false) and every trigger no-ops
while disabled, so a rollback is only needed if the design itself must be withdrawn. Run as
the service role.

```sql
-- Triggers
DROP TRIGGER IF EXISTS trg_stock_on_dispatch_item ON public.dispatch_items;
DROP TRIGGER IF EXISTS trg_stock_on_order_item   ON public.order_items;
DROP TRIGGER IF EXISTS trg_stock_on_order        ON public.orders;
DROP TRIGGER IF EXISTS trg_stock_sync_opening    ON public.products;

-- Functions
DROP FUNCTION IF EXISTS public.stock_on_dispatch_item_change();
DROP FUNCTION IF EXISTS public.stock_on_order_item_change();
DROP FUNCTION IF EXISTS public.stock_on_order_change();
DROP FUNCTION IF EXISTS public.stock_sync_opening();
DROP FUNCTION IF EXISTS public.stock_reconcile_dispatch(uuid, uuid);
DROP FUNCTION IF EXISTS public.stock_reconcile_order(uuid);
DROP FUNCTION IF EXISTS public.stock_reverse_entry(uuid);
DROP FUNCTION IF EXISTS public.stock_adjust(uuid, numeric, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.stock_closing(uuid);
DROP FUNCTION IF EXISTS public.stock_out_event(uuid);
DROP FUNCTION IF EXISTS public.stock_module_enabled(uuid);

-- Table (append-only ledger; drops all stock history)
DROP TABLE IF EXISTS public.stock_ledger;

-- products columns (safe: opening_stock/track_stock only, dormant legacy `stock` untouched)
ALTER TABLE public.products DROP COLUMN IF EXISTS track_stock;
ALTER TABLE public.products DROP COLUMN IF EXISTS opening_stock;

-- Settings left in accounts.settings.stock_settings / module_settings.stock are inert
-- once the code paths are gone; optional cleanup:
-- UPDATE public.accounts SET module_settings = module_settings - 'stock',
--   settings = settings - 'stock_settings';
```

Verified 2026-08-21: full scenario dry-run (opening → order-created/closed/dispatch consume →
edit → cancel/reversal → manual in/out with reason enforcement → non-tracked exclusion) passed
in a rolled-back transaction against production; zero rows persisted.
