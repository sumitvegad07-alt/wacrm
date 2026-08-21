-- ============================================================================
-- Stock Management v1
-- Spec: docs/engineering/specifications/stock-management-v1.md
-- Rollback: supabase/migrations/ROLLBACK-stock-management.md
--
-- Model: closing stock is DERIVED, never stored — exactly like payment
-- outstanding (opening balance + Closed orders - Approved payments).
--   Closing stock = SUM(stock_ledger.quantity)  [signed rows, live rollup]
--
-- The module ships OFF for every account (module_settings.stock defaults false).
-- Every trigger no-ops unless the owning account has the module enabled, so this
-- migration cannot affect a single existing order, dispatch or product save until
-- a tenant deliberately opts in from Catalogue Settings.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. products: opening stock + per-product tracking flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS opening_stock numeric,
  ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;

-- Legacy products.stock is left untouched and deprecated (empty in prod; the no-
-- destructive-drop rule keeps it). The product form stops writing it.

-- ---------------------------------------------------------------------------
-- 2. stock_ledger — immutable, append-only audit trail AND the math source
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity     numeric NOT NULL,                    -- signed: + inward, - outward
  entry_type   text NOT NULL,                       -- opening|manual_in|manual_out|sale_out|reversal
  reason_code  text,
  source_type  text,                                -- opening|manual|order|dispatch
  source_id    uuid,                                -- order_id / dispatch_id
  source_ref   text,                                -- snapshot of order/dispatch number
  posted_mode  text,                                -- stock_out_event a sale_out was posted under
  reverses_id  uuid REFERENCES public.stock_ledger(id) ON DELETE SET NULL,
  notes        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stock_ledger_entry_type_chk
    CHECK (entry_type IN ('opening','manual_in','manual_out','sale_out','reversal')),
  CONSTRAINT stock_ledger_source_type_chk
    CHECK (source_type IS NULL OR source_type IN ('opening','manual','order','dispatch')),
  -- Manual movements must carry a reason from the fixed list; other rows are free.
  -- NOTE the explicit IS NOT NULL: a bare `reason_code IN (...)` evaluates to
  -- NULL (not FALSE) when reason_code is NULL, and a CHECK only rejects FALSE, so
  -- a null reason would slip through. IS NOT NULL forces the FALSE.
  CONSTRAINT stock_ledger_manual_reason_chk
    CHECK (
      entry_type NOT IN ('manual_in','manual_out')
      OR (reason_code IS NOT NULL AND reason_code IN (
        'Sales Return','Damage','Expiry','Theft/Loss','Stock Correction',
        'Physical Count Adjustment','Transfer In','Transfer Out'
      ))
    )
);

-- One opening row per product (the single mutable baseline, resynced by trigger).
CREATE UNIQUE INDEX IF NOT EXISTS stock_ledger_one_opening_per_product
  ON public.stock_ledger (product_id) WHERE entry_type = 'opening';

-- Closing-stock rollup: SUM(quantity) GROUP BY product_id.
CREATE INDEX IF NOT EXISTS stock_ledger_account_product_idx
  ON public.stock_ledger (account_id, product_id);

-- Reconcile lookups by source document.
CREATE INDEX IF NOT EXISTS stock_ledger_source_idx
  ON public.stock_ledger (account_id, source_type, source_id);

-- RLS: read within tenant. There is deliberately NO update/delete policy — the
-- ledger is append-only; corrections are new rows. Trigger/definer functions
-- bypass RLS to post rows on behalf of an order/dispatch actor.
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_ledger_select ON public.stock_ledger;
CREATE POLICY stock_ledger_select ON public.stock_ledger
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS stock_ledger_insert ON public.stock_ledger;
CREATE POLICY stock_ledger_insert ON public.stock_ledger
  FOR INSERT WITH CHECK (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- 3. Small helpers
-- ---------------------------------------------------------------------------

-- Is the Stock module enabled for this account?
CREATE OR REPLACE FUNCTION public.stock_module_enabled(p_account_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((module_settings->>'stock')::boolean, false)
  FROM public.accounts WHERE id = p_account_id;
$$;

-- The configured stock-out event for this account (default order_closed).
CREATE OR REPLACE FUNCTION public.stock_out_event(p_account_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(settings->'stock_settings'->>'stock_out_event', 'order_closed')
  FROM public.accounts WHERE id = p_account_id;
$$;

-- Live closing stock for one product (SUM of the ledger). Source of truth.
CREATE OR REPLACE FUNCTION public.stock_closing(p_product_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(quantity), 0)
  FROM public.stock_ledger WHERE product_id = p_product_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Opening-stock sync (products -> the single opening ledger row)
--    The opening row is the one intentionally-mutable baseline: it is not a
--    historical movement, so resyncing it in place is correct.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_sync_opening()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.stock_module_enabled(NEW.account_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.track_stock IS FALSE OR NEW.opening_stock IS NULL OR NEW.opening_stock = 0 THEN
    DELETE FROM public.stock_ledger
      WHERE product_id = NEW.id AND entry_type = 'opening';
    RETURN NEW;
  END IF;

  INSERT INTO public.stock_ledger
    (account_id, product_id, quantity, entry_type, source_type)
  VALUES
    (NEW.account_id, NEW.id, NEW.opening_stock, 'opening', 'opening')
  ON CONFLICT (product_id) WHERE (entry_type = 'opening')
  DO UPDATE SET quantity = EXCLUDED.quantity, created_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_sync_opening ON public.products;
CREATE TRIGGER trg_stock_sync_opening
  AFTER INSERT OR UPDATE OF opening_stock, track_stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.stock_sync_opening();

-- ---------------------------------------------------------------------------
-- 5. Reconcile an ORDER's stock consumption (order_created / order_closed modes)
--    Idempotent: posts only the DELTA between the target consumption and what is
--    already net-posted for this order, as new immutable rows. Never edits rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_reconcile_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid;
  v_status  text;
  v_ref     text;
  v_event   text;
  v_consumes boolean;
  r RECORD;
  v_delta numeric;
  v_reason text;
BEGIN
  SELECT account_id, status, order_number
    INTO v_account, v_status, v_ref
  FROM public.orders WHERE id = p_order_id;
  IF v_account IS NULL THEN RETURN; END IF;
  IF NOT public.stock_module_enabled(v_account) THEN RETURN; END IF;

  v_event := public.stock_out_event(v_account);
  -- This function owns ONLY the order-based modes. Under 'dispatch' it does
  -- nothing, so flipping the setting never retro-touches order-mode history.
  IF v_event NOT IN ('order_created','order_closed') THEN RETURN; END IF;

  IF v_event = 'order_created' THEN
    v_consumes := v_status NOT IN ('Cancelled','Rejected');
  ELSE -- order_closed
    v_consumes := v_status = 'Closed';
  END IF;

  IF v_consumes AND v_status IN ('Cancelled','Rejected') THEN
    v_reason := 'Order ' || v_status;
  END IF;

  -- product_ids = union of (products currently on the order) and (products that
  -- already have order-mode sale_out/reversal rows for this order, e.g. a line
  -- that was removed on edit or a now-cancelled order).
  FOR r IN
    WITH involved AS (
      SELECT DISTINCT oi.product_id
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL AND p.track_stock IS TRUE
      UNION
      SELECT DISTINCT sl.product_id
      FROM public.stock_ledger sl
      WHERE sl.source_type = 'order' AND sl.source_id = p_order_id
        AND sl.posted_mode IN ('order_created','order_closed')
    ),
    target AS (
      SELECT i.product_id,
        CASE WHEN v_consumes THEN
          -1 * COALESCE((
            SELECT SUM(oi.quantity) FROM public.order_items oi
            WHERE oi.order_id = p_order_id AND oi.product_id = i.product_id
          ), 0)
        ELSE 0 END AS target_qty
      FROM involved i
    ),
    posted AS (
      SELECT i.product_id,
        COALESCE((
          SELECT SUM(sl.quantity) FROM public.stock_ledger sl
          WHERE sl.source_type = 'order' AND sl.source_id = p_order_id
            AND sl.product_id = i.product_id
            AND sl.posted_mode IN ('order_created','order_closed')
        ), 0) AS posted_qty
      FROM involved i
    )
    SELECT t.product_id, t.target_qty - p.posted_qty AS delta
    FROM target t JOIN posted p ON p.product_id = t.product_id
    WHERE t.target_qty - p.posted_qty <> 0
  LOOP
    v_delta := r.delta;
    INSERT INTO public.stock_ledger
      (account_id, product_id, quantity, entry_type, reason_code,
       source_type, source_id, source_ref, posted_mode)
    VALUES
      (v_account, r.product_id, v_delta,
       CASE WHEN v_delta < 0 THEN 'sale_out' ELSE 'reversal' END,
       CASE WHEN v_delta > 0 THEN COALESCE(v_reason, 'Order Adjustment') ELSE NULL END,
       'order', p_order_id, v_ref, v_event);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Reconcile a DISPATCH's stock consumption (dispatch mode)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_reconcile_dispatch(p_dispatch_id uuid, p_account_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event text;
  v_ref   text;
  r RECORD;
  v_delta numeric;
BEGIN
  IF p_account_id IS NULL THEN RETURN; END IF;
  IF NOT public.stock_module_enabled(p_account_id) THEN RETURN; END IF;

  v_event := public.stock_out_event(p_account_id);
  IF v_event <> 'dispatch' THEN RETURN; END IF;

  SELECT dispatch_number INTO v_ref
  FROM public.order_dispatches WHERE id = p_dispatch_id;  -- NULL if dispatch deleted

  FOR r IN
    WITH involved AS (
      SELECT DISTINCT oi.product_id
      FROM public.dispatch_items di
      JOIN public.order_items oi ON oi.id = di.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      WHERE di.dispatch_id = p_dispatch_id AND oi.product_id IS NOT NULL AND p.track_stock IS TRUE
      UNION
      SELECT DISTINCT sl.product_id
      FROM public.stock_ledger sl
      WHERE sl.source_type = 'dispatch' AND sl.source_id = p_dispatch_id
        AND sl.posted_mode = 'dispatch'
    ),
    target AS (
      SELECT i.product_id,
        -1 * COALESCE((
          SELECT SUM(di.quantity)
          FROM public.dispatch_items di
          JOIN public.order_items oi ON oi.id = di.order_item_id
          WHERE di.dispatch_id = p_dispatch_id AND oi.product_id = i.product_id
        ), 0) AS target_qty
      FROM involved i
    ),
    posted AS (
      SELECT i.product_id,
        COALESCE((
          SELECT SUM(sl.quantity) FROM public.stock_ledger sl
          WHERE sl.source_type = 'dispatch' AND sl.source_id = p_dispatch_id
            AND sl.product_id = i.product_id AND sl.posted_mode = 'dispatch'
        ), 0) AS posted_qty
      FROM involved i
    )
    SELECT t.product_id, t.target_qty - p.posted_qty AS delta
    FROM target t JOIN posted p ON p.product_id = t.product_id
    WHERE t.target_qty - p.posted_qty <> 0
  LOOP
    v_delta := r.delta;
    INSERT INTO public.stock_ledger
      (account_id, product_id, quantity, entry_type, reason_code,
       source_type, source_id, source_ref, posted_mode)
    VALUES
      (p_account_id, r.product_id, v_delta,
       CASE WHEN v_delta < 0 THEN 'sale_out' ELSE 'reversal' END,
       CASE WHEN v_delta > 0 THEN 'Dispatch Adjustment' ELSE NULL END,
       'dispatch', p_dispatch_id, v_ref, 'dispatch');
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Trigger glue
-- ---------------------------------------------------------------------------

-- orders: (re)consume on create and on any status change.
CREATE OR REPLACE FUNCTION public.stock_on_order_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.stock_reconcile_order(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_on_order ON public.orders;
CREATE TRIGGER trg_stock_on_order
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.stock_on_order_change();

-- order_items: qty/line changes (via update_order) re-reconcile the parent order.
CREATE OR REPLACE FUNCTION public.stock_on_order_item_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.stock_reconcile_order(COALESCE(NEW.order_id, OLD.order_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_on_order_item ON public.order_items;
CREATE TRIGGER trg_stock_on_order_item
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.stock_on_order_item_change();

-- dispatch_items: new/removed dispatch lines (incl. cascade delete when a whole
-- dispatch is cancelled) reconcile the dispatch. account_id is derived from the
-- order behind the line, which always survives a dispatch deletion.
CREATE OR REPLACE FUNCTION public.stock_on_dispatch_item_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dispatch uuid;
  v_order_item uuid;
  v_account uuid;
BEGIN
  v_dispatch   := COALESCE(NEW.dispatch_id, OLD.dispatch_id);
  v_order_item := COALESCE(NEW.order_item_id, OLD.order_item_id);
  SELECT o.account_id INTO v_account
  FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.id = v_order_item;
  PERFORM public.stock_reconcile_dispatch(v_dispatch, v_account);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_on_dispatch_item ON public.dispatch_items;
CREATE TRIGGER trg_stock_on_dispatch_item
  AFTER INSERT OR UPDATE OR DELETE ON public.dispatch_items
  FOR EACH ROW EXECUTE FUNCTION public.stock_on_dispatch_item_change();

-- ---------------------------------------------------------------------------
-- 8. Manual adjustments (Stock In / Stock Out) — permission-gated RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_adjust(
  p_product_id uuid,
  p_quantity   numeric,
  p_direction  text,          -- 'in' | 'out'
  p_reason_code text,
  p_notes      text DEFAULT NULL,
  p_ledger_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_account uuid;
  v_signed  numeric;
  v_type    text;
  v_id      uuid;
BEGIN
  SELECT account_id INTO v_account FROM public.products WHERE id = p_product_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.has_permission(auth.uid(), v_account, 'manage_stock') THEN
    RAISE EXCEPTION 'Not permitted to manage stock' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'Direction must be in or out' USING ERRCODE = 'check_violation';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent replay (offline queue): return the existing row untouched.
  IF p_ledger_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.stock_ledger WHERE id = p_ledger_id;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('ledger_id', v_id, 'closing_stock', public.stock_closing(p_product_id));
    END IF;
  END IF;

  v_signed := CASE WHEN p_direction = 'in' THEN abs(p_quantity) ELSE -abs(p_quantity) END;
  v_type   := CASE WHEN p_direction = 'in' THEN 'manual_in' ELSE 'manual_out' END;

  INSERT INTO public.stock_ledger
    (id, account_id, product_id, quantity, entry_type, reason_code,
     source_type, notes, created_by)
  VALUES
    (COALESCE(p_ledger_id, gen_random_uuid()), v_account, p_product_id, v_signed,
     v_type, p_reason_code, 'manual', p_notes, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ledger_id', v_id, 'closing_stock', public.stock_closing(p_product_id));
END;
$$;

-- "Delete" a manual entry = post an offsetting reversal row (never a physical
-- delete). Refuses a second reversal of the same row.
CREATE OR REPLACE FUNCTION public.stock_reverse_entry(p_ledger_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v RECORD;
  v_id uuid;
BEGIN
  SELECT * INTO v FROM public.stock_ledger WHERE id = p_ledger_id;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Ledger entry not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.has_permission(auth.uid(), v.account_id, 'manage_stock') THEN
    RAISE EXCEPTION 'Not permitted to manage stock' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v.entry_type NOT IN ('manual_in','manual_out') THEN
    RAISE EXCEPTION 'Only manual entries can be reversed here' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_ledger WHERE reverses_id = p_ledger_id) THEN
    RAISE EXCEPTION 'Entry already reversed' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.stock_ledger
    (account_id, product_id, quantity, entry_type, reason_code,
     source_type, reverses_id, notes, created_by)
  VALUES
    (v.account_id, v.product_id, -v.quantity, 'reversal', 'Stock Correction',
     'manual', p_ledger_id, 'Reversal of manual entry', auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ledger_id', v_id, 'closing_stock', public.stock_closing(v.product_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.stock_adjust(uuid,numeric,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_reverse_entry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_closing(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. stock_positions — per-product snapshot for the order form, stock screen
--    and report. security_invoker so the ledger/products RLS applies to the
--    caller. Only stock-tracked products appear.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stock_positions
WITH (security_invoker = on) AS
SELECT
  p.account_id,
  p.id   AS product_id,
  p.name AS product_name,
  p.sku,
  p.unit,
  p.active,
  COALESCE(SUM(sl.quantity) FILTER (WHERE sl.entry_type = 'opening'), 0)                       AS opening,
  COALESCE(SUM(sl.quantity) FILTER (WHERE sl.quantity > 0 AND sl.entry_type <> 'opening'), 0)  AS total_in,
  COALESCE(-SUM(sl.quantity) FILTER (WHERE sl.quantity < 0), 0)                                AS total_out,
  COALESCE(SUM(sl.quantity), 0)                                                                AS closing,
  MAX(sl.created_at)                                                                           AS last_movement_at
FROM public.products p
LEFT JOIN public.stock_ledger sl ON sl.product_id = p.id
WHERE p.track_stock IS TRUE
GROUP BY p.account_id, p.id, p.name, p.sku, p.unit, p.active;

GRANT SELECT ON public.stock_positions TO authenticated;
