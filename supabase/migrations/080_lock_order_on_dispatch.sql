-- ============================================================
-- 080_lock_order_on_dispatch.sql
-- Once an order is dispatched it is a record, not a draft. Set
-- orders.locked_at on the first dispatch so update_order refuses to edit
-- it thereafter.
--
-- A trigger (not app code) guarantees this regardless of who creates the
-- dispatch — web, a future mobile dispatch flow, or a direct insert.
--
-- Behaviour-changing but zero risk to existing data: there are 0
-- dispatches in production. Phase 1 added the locked_at column; nothing
-- wrote it until now.
-- ============================================================

CREATE OR REPLACE FUNCTION lock_order_on_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  UPDATE orders
  SET locked_at = now()
  WHERE id = NEW.order_id AND locked_at IS NULL;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_lock_order_on_dispatch ON order_dispatches;
CREATE TRIGGER trg_lock_order_on_dispatch
AFTER INSERT ON order_dispatches
FOR EACH ROW EXECUTE FUNCTION lock_order_on_dispatch();
