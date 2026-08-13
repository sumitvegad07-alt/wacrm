-- 20260814000004_payment_approval_security.sql

-- 1. Insert the new permission (ignored if it already exists)
-- OZZO usually expects permissions to be added to UI or roles manually or dynamically checked via JSONB.
-- Since has_permission checks the JSONB keys directly (er.permissions ->> p_key), we don't need a strict FK insertion,
-- but we must upgrade the trigger to enforce the security.

-- 2. Update the trigger
CREATE OR REPLACE FUNCTION enforce_payment_status_transition()
RETURNS trigger AS $$
BEGIN
  -- Insert Security Check
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('Approved', 'Rejected') THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments') THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;
  END IF;

  -- Update Security and Transition Rules
  IF TG_OP = 'UPDATE' THEN
    -- Approved payments are read-only, except for cancellation
    IF OLD.status = 'Approved' AND NEW.status != 'Cancelled' THEN
      RAISE EXCEPTION 'Approved payments are read-only. They can only be cancelled.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT payment_status_transition_allowed(OLD.status, NEW.status) THEN
        RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
      END IF;

      IF NEW.status IN ('Approved', 'Rejected') THEN
        IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments') THEN
          RAISE EXCEPTION 'Permission denied: approve_payments required';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_payment_status_transition ON payments;
CREATE TRIGGER trg_enforce_payment_status_transition
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payment_status_transition();

-- Helper for server time timezone-safe calculations
CREATE OR REPLACE FUNCTION get_server_time() RETURNS timestamptz AS $$
  SELECT now();
$$ LANGUAGE sql;
