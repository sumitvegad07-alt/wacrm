-- ============================================================
-- OZZO — database changes for the 2026-11-09 bug list
--
-- WHAT THIS IS FOR
--   Bug 12  Changing a deal's stage on mobile said it worked but did not.
--   Bug 13  "Convert to quotation" said "Deal not found or not accessible".
--   Bug 9   Stock could never catch up with orders closed earlier.
--
-- HOW TO RUN IT
--   1. Open your Supabase project and click SQL Editor on the left.
--   2. Click New query.
--   3. Copy EVERYTHING in this file and paste it in.
--   4. Click Run. It should say Success.
--
-- It is safe to run more than once.
-- It only ADDS and REPLACES functions. No table, column or row is changed,
-- and nothing is deleted.
-- ============================================================


-- ============================================================
-- Moving a deal's stage, and converting it, are their own rights
--
-- Bug report 2026-11-09, items 12 and 13. On mobile, a Sales Executive could
-- change a deal's stage and watch the app confirm it, write the timeline entry
-- — and find the stage unchanged, on the detail screen and on the deal list.
-- "Convert to quotation" answered "Deal not found or not accessible" for a deal
-- sitting right there on screen.
--
-- One cause for both. The role holds `move_deal_stage` and
-- `convert_deal_to_quotation`, and the UI gates on exactly those. The DATABASE
-- knows neither: `deals_update` reads
--
--     is_account_member(account_id,'agent') AND has_permission(…,'edit_deals')
--
-- and that role does not have `edit_deals`. So:
--
--   * the stage UPDATE matched zero rows. PostgREST reports no error for an
--     UPDATE that matches nothing, so the client saw success, logged the
--     change and reloaded the unchanged deal.
--   * `convert_deal_to_quotation` opens with `SELECT * FROM deals … FOR UPDATE`
--     as SECURITY INVOKER. A locking SELECT must also satisfy the UPDATE
--     policy, so the row was filtered out and the function raised its own
--     "Deal not found or not accessible" — which was never about the deal
--     existing.
--
-- The fix is NOT to widen `deals_update`: letting anyone who may move a stage
-- rewrite a deal's value, owner and customer is a bigger hole than the bug.
-- Instead each action gets a function that checks its OWN right and touches
-- only what that right covers.
--
-- Both are SECURITY DEFINER with a fixed search_path, and both check account
-- membership explicitly before anything else — a definer function has no RLS
-- to fall back on.
-- ============================================================

-- ------------------------------------------------------------
-- 1. move_deal_stage — the quick stage change, and nothing else
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_deal_stage(p_deal_id uuid, p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account     uuid;
  v_pipeline    uuid;
  v_stage_pipe  uuid;
  v_stage_acct  uuid;
BEGIN
  SELECT account_id, pipeline_id INTO v_account, v_pipeline
  FROM deals WHERE id = p_deal_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  -- Definer: RLS is not doing this for us.
  IF NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  IF NOT (
    has_permission(auth.uid(), v_account, 'move_deal_stage')
    OR has_permission(auth.uid(), v_account, 'edit_deals')
  ) THEN
    RAISE EXCEPTION 'You do not have permission to change the stage of a deal';
  END IF;

  -- The stage must belong to this account AND to this deal's own pipeline, or
  -- a deal could be parked on a stage that its board never displays.
  SELECT ps.pipeline_id, p.account_id INTO v_stage_pipe, v_stage_acct
  FROM pipeline_stages ps
  JOIN pipelines p ON p.id = ps.pipeline_id
  WHERE ps.id = p_stage_id;

  IF v_stage_acct IS DISTINCT FROM v_account THEN
    RAISE EXCEPTION 'That stage does not belong to this account';
  END IF;
  IF v_pipeline IS NOT NULL AND v_stage_pipe IS DISTINCT FROM v_pipeline THEN
    RAISE EXCEPTION 'That stage belongs to a different pipeline';
  END IF;

  UPDATE deals
  SET stage_id = p_stage_id,
      updated_at = now()
  WHERE id = p_deal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_deal_stage(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.move_deal_stage(uuid, uuid) IS
  'Changes ONLY a deal''s stage, gated on move_deal_stage or edit_deals. Exists because deals_update requires edit_deals, which silently turned a stage change into a no-op for roles that hold move_deal_stage alone.';

-- ------------------------------------------------------------
-- 2. convert_deal_to_quotation — same body, honest gate
--
-- Unchanged from migration 092 except for the header and the checks that
-- replace the FOR UPDATE lock. Kept as one CREATE OR REPLACE rather than a
-- wrapper so there is a single definition of what converting does.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_deal_to_quotation(p_deal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal RECORD;
  v_quotation_id uuid;
  v_quotation_num text;
  v_sub_total numeric(15, 2) := 0;
  v_tax_total numeric(15, 2) := 0;
  v_total_amount numeric(15, 2) := 0;
  v_items_count int := 0;
BEGIN
  -- No FOR UPDATE: under the old SECURITY INVOKER definition a locking read
  -- also had to pass the UPDATE policy, so a caller with convert rights but
  -- not edit_deals was told the deal did not exist.
  SELECT * INTO v_deal FROM deals WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  IF NOT is_account_member(v_deal.account_id, 'agent') THEN
    RAISE EXCEPTION 'Deal not found';
  END IF;

  IF NOT (
    has_permission(auth.uid(), v_deal.account_id, 'convert_deal_to_quotation')
    OR has_permission(auth.uid(), v_deal.account_id, 'edit_deals')
  ) THEN
    RAISE EXCEPTION 'You do not have permission to convert a deal to a quotation';
  END IF;

  IF v_deal.is_converted THEN
    RAISE EXCEPTION 'Deal already converted';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(sub_total), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(total), 0)
  INTO v_items_count, v_sub_total, v_tax_total, v_total_amount
  FROM deal_items
  WHERE deal_id = p_deal_id;

  IF v_items_count = 0 OR (v_total_amount = 0 AND v_deal.value > 0) THEN
    v_sub_total := COALESCE(v_deal.value, 0);
    v_total_amount := COALESCE(v_deal.value, 0);
  END IF;

  v_quotation_num := get_next_quotation_number(v_deal.account_id);

  INSERT INTO quotations (
    account_id, user_id, contact_id, lead_id, quotation_number, date,
    sub_total, tax_total, total_amount, status, terms_conditions
  )
  VALUES (
    v_deal.account_id,
    COALESCE(auth.uid(), v_deal.user_id),
    v_deal.contact_id,
    v_deal.lead_id,
    v_quotation_num,
    CURRENT_DATE,
    v_sub_total,
    v_tax_total,
    v_total_amount,
    'Draft',
    COALESCE(v_deal.notes, '')
  )
  RETURNING id INTO v_quotation_id;

  IF v_items_count > 0 THEN
    INSERT INTO quotation_items (
      quotation_id, product_id, product_name, unit, quantity, price, tax_rate, tax_amount, sub_total, total, position
    )
    SELECT
      v_quotation_id, product_id, product_name, COALESCE(unit, '—'), quantity, price, tax_rate, tax_amount, sub_total, total, position
    FROM deal_items
    WHERE deal_id = p_deal_id;
  ELSE
    INSERT INTO quotation_items (
      quotation_id, product_name, unit, quantity, price, tax_rate, tax_amount, sub_total, total, position
    )
    VALUES (
      v_quotation_id,
      COALESCE(v_deal.deal_number, 'Deal') || ' - Sales Opportunity',
      '—',
      1,
      v_total_amount,
      0,
      0,
      v_total_amount,
      v_total_amount,
      0
    );
  END IF;

  UPDATE deals
  SET is_converted = true,
      is_active = false,
      converted_quotation_id = v_quotation_id,
      status = 'won',
      updated_at = now()
  WHERE id = p_deal_id;

  INSERT INTO module_activities (
    account_id, user_id, module_name, record_id, action, message, details, created_at
  )
  SELECT
    account_id, user_id, 'quotation', v_quotation_id, action,
    '[From Deal ' || COALESCE(v_deal.deal_number, 'Deal') || '] ' || COALESCE(message, ''),
    details, created_at
  FROM module_activities
  WHERE (module_name = 'deal' AND record_id = p_deal_id)
     OR (module_name = 'lead' AND record_id = v_deal.lead_id AND v_deal.lead_id IS NOT NULL);

  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
  VALUES
    (v_deal.account_id, COALESCE(auth.uid(), v_deal.user_id), 'quotation', v_quotation_id, 'created', 'Quotation created from converted Deal ' || COALESCE(v_deal.deal_number, p_deal_id::text), jsonb_build_object('deal_id', p_deal_id, 'deal_number', COALESCE(v_deal.deal_number, 'Deal'))),
    (v_deal.account_id, COALESCE(auth.uid(), v_deal.user_id), 'deal', p_deal_id, 'converted', 'Deal converted to Quotation #' || v_quotation_num, jsonb_build_object('quotation_id', v_quotation_id, 'quotation_number', v_quotation_num));

  RETURN v_quotation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_deal_to_quotation(uuid) TO authenticated;


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
