-- ============================================================
-- Stock can catch up with history
--
-- Bug report 2026-11-09, item 9: "Stock is not updating Automatically."
--
-- The engine itself is sound. On account 001001 three Closed orders posted
-- their sale_out rows exactly as designed, the most recent on 2026-10-28. What
-- is missing is any way to CATCH UP, and three ordinary things silently leave
-- stock wrong forever:
--
--   1. Every stock function begins `IF NOT stock_module_enabled(account) THEN
--      RETURN`. So while Stock Management is switched off — which is the
--      default, and how account 001001 sits today — orders close, dispatches
--      go out and products get opening stock, and the ledger records none of
--      it. Switching the module on later does not go back for any of it:
--      closing stock simply starts from whatever the ledger happens to hold.
--
--   2. A product with "Maintain stock" unticked is skipped by
--      `p.track_stock IS TRUE`. Ticking it afterwards re-syncs only its
--      opening row; the orders it already appeared on are never reconciled.
--      ORD-0055 on 001001 is exactly this — closed 2026-11-02, ten units of a
--      product whose track_stock is false, and no ledger row for it.
--
--   3. An order imported, or edited by a path that does not touch `status` or
--      its items, never fires the triggers that would reconcile it.
--
-- `stock_recalculate_account` re-runs the reconciliation the triggers would
-- have run. It is safe to run at any time and as often as you like: the
-- reconcile functions post the DELTA between what stock should be and what is
-- already posted, so a second run posts nothing. It never edits or deletes a
-- ledger row — corrections are new rows, as they are everywhere else here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.stock_recalculate_account()
RETURNS jsonb
-- DEFINER, like the reconcile functions it drives. The opening-stock resync
-- below writes to products, and the right this function checks is
-- `manage_stock` — a stock keeper who may not edit the product catalogue must
-- still be able to recalculate, so the products UPDATE cannot be left to the
-- caller's own RLS. Membership and permission are checked explicitly first.
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account   uuid;
  v_before    bigint;
  v_after     bigint;
  v_orders    int := 0;
  v_dispatch  int := 0;
  v_products  int := 0;
  v_started   timestamptz := clock_timestamp();
  r RECORD;
BEGIN
  SELECT account_id INTO v_account
  FROM public.profiles WHERE user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Definer: nothing else is checking who this is.
  IF NOT public.is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'Not permitted to manage stock' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Same right that guards a manual Stock In / Stock Out.
  IF NOT public.has_permission(auth.uid(), v_account, 'manage_stock') THEN
    RAISE EXCEPTION 'Not permitted to manage stock' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.stock_module_enabled(v_account) THEN
    RAISE EXCEPTION 'Stock Management is switched off for this account'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_before
  FROM public.stock_ledger WHERE account_id = v_account;

  -- 1. Opening rows. A product given opening stock while the module was off
  --    never got one; re-saving the same value fires stock_sync_opening, which
  --    upserts the single opening row rather than adding another.
  FOR r IN
    SELECT id, opening_stock FROM public.products
    WHERE account_id = v_account AND track_stock IS TRUE AND opening_stock IS NOT NULL
  LOOP
    UPDATE public.products SET opening_stock = r.opening_stock WHERE id = r.id;
    v_products := v_products + 1;
  END LOOP;

  -- 2. Orders. stock_reconcile_order decides for itself whether the account's
  --    stock-out event is an order mode, and posts only the difference.
  FOR r IN
    SELECT id FROM public.orders WHERE account_id = v_account
  LOOP
    PERFORM public.stock_reconcile_order(r.id);
    v_orders := v_orders + 1;
  END LOOP;

  -- 3. Dispatches, for accounts whose stock-out event is 'dispatch'. Same
  --    self-checking shape.
  FOR r IN
    SELECT od.id
    FROM public.order_dispatches od
    JOIN public.orders o ON o.id = od.order_id
    WHERE o.account_id = v_account
  LOOP
    PERFORM public.stock_reconcile_dispatch(r.id, v_account);
    v_dispatch := v_dispatch + 1;
  END LOOP;

  SELECT count(*) INTO v_after
  FROM public.stock_ledger WHERE account_id = v_account;

  -- One timeline entry per product that actually moved, because
  -- module_activities.record_id is NOT NULL and a recalculation has no single
  -- record of its own. Only products whose ledger changed are logged, so a
  -- run that finds nothing to do writes nothing.
  INSERT INTO public.module_activities
    (account_id, user_id, module_name, record_id, action, message, details)
  SELECT
    v_account, auth.uid(), 'product', sl.product_id, 'stock_recalculated',
    format('Stock recalculated · %s entries added for this product', count(*)),
    jsonb_build_object(
      'orders', v_orders, 'dispatches', v_dispatch, 'products', v_products,
      'entries_added_total', v_after - v_before)
  FROM public.stock_ledger sl
  WHERE sl.account_id = v_account
    AND sl.created_at >= v_started
  GROUP BY sl.product_id;

  RETURN jsonb_build_object(
    'orders_checked', v_orders,
    'dispatches_checked', v_dispatch,
    'products_checked', v_products,
    'entries_added', v_after - v_before
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.stock_recalculate_account() TO authenticated;

COMMENT ON FUNCTION public.stock_recalculate_account() IS
  'Re-runs stock reconciliation across every order, dispatch and opening balance in the caller''s account. Idempotent — the reconcile functions post deltas, so a second run adds nothing. For catching up after Stock Management is switched on, after an import, or after a product''s "Maintain stock" is ticked.';
