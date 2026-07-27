-- 089_part_dispatch_status.sql
-- An order should only become "Dispatched" once EVERY item is fully shipped;
-- a partial shipment now reads "Part Dispatch".
--
-- The old trigger fired on order_dispatches INSERT (before line items existed)
-- and unconditionally set status='Dispatched'. We replace it with a trigger on
-- dispatch_items that recomputes the order's status from actual delivered-vs-
-- ordered quantities: none delivered → Approved, some but not all → Part
-- Dispatch, all → Dispatched. It runs under app.order_status_system so it's
-- exempt from the manage_order_status permission check, but the enforce trigger
-- still validates the transition itself — so the new transitions are whitelisted.

CREATE OR REPLACE FUNCTION public.order_status_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('Pending','Approved'), ('Pending','Rejected'), ('Pending','Cancelled'),
    ('Approved','Dispatched'), ('Approved','Rejected'), ('Approved','Cancelled'),
    ('Approved','Part Dispatch'),
    ('Part Dispatch','Dispatched'), ('Part Dispatch','Approved'),
    ('Part Dispatch','Cancelled'), ('Part Dispatch','Rejected'),
    ('Dispatched','Part Dispatch'), ('Dispatched','Approved')
  );
$$;

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
  -- Only touch orders that are in a dispatchable lifecycle position.
  IF v_current IS NULL OR v_current NOT IN ('Approved','Part Dispatch','Dispatched') THEN
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
  ELSE v_new := 'Dispatched';
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

DROP TRIGGER IF EXISTS trg_lock_order_on_dispatch ON order_dispatches;
DROP TRIGGER IF EXISTS trg_sync_order_dispatch_status ON dispatch_items;
CREATE TRIGGER trg_sync_order_dispatch_status
AFTER INSERT OR UPDATE OR DELETE ON dispatch_items
FOR EACH ROW EXECUTE FUNCTION sync_order_dispatch_status();

-- Backfill: recompute status for every order that already has dispatch lines
-- (fixes orders wrongly marked 'Dispatched' on a partial shipment). The no-op
-- update re-fires the new trigger for each dispatch line.
UPDATE dispatch_items SET quantity = quantity WHERE quantity IS NOT NULL;
