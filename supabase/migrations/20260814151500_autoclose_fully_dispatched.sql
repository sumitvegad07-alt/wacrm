-- Auto-close orders when fully dispatched instead of just marking as "Dispatched"
CREATE OR REPLACE FUNCTION public.sync_order_dispatch_status()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_order_id uuid;
  v_current text;
  v_any_delivered boolean;
  v_has_remaining boolean;
  v_new text;
BEGIN
  SELECT od.order_id INTO v_order_id FROM order_dispatches od
  WHERE od.id = COALESCE(NEW.dispatch_id, OLD.dispatch_id);
  IF v_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT status INTO v_current FROM orders WHERE id = v_order_id;
  -- Only touch orders that are in a dispatchable lifecycle position, plus Closed
  -- (so if we delete a dispatch from a closed order, it can fall back to Part Dispatch).
  IF v_current IS NULL OR v_current NOT IN ('Approved','Part Dispatch','Dispatched','Closed') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_any_delivered := EXISTS (
    SELECT 1 FROM dispatch_items di JOIN order_dispatches od ON od.id = di.dispatch_id
    WHERE od.order_id = v_order_id AND di.quantity > 0
  );
  v_has_remaining := EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = v_order_id
      AND oi.quantity > COALESCE((
        SELECT SUM(di.quantity) FROM dispatch_items di JOIN order_dispatches od ON od.id = di.dispatch_id
        WHERE di.order_item_id = oi.id
      ), 0)
  );

  IF NOT v_any_delivered THEN v_new := 'Approved';
  ELSIF v_has_remaining THEN v_new := 'Part Dispatch';
  ELSE v_new := 'Closed'; -- Auto-close logic!
  END IF;

  PERFORM set_config('app.order_status_system', '1', true);
  UPDATE orders
     SET status = v_new,
         locked_at = CASE WHEN v_any_delivered THEN COALESCE(locked_at, now()) ELSE NULL END
   WHERE id = v_order_id;
  PERFORM set_config('app.order_status_system', '', true);

  RETURN COALESCE(NEW, OLD);
END;
$$;
