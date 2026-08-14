-- 20260814170000_strict_financial_rbac.sql

-- 1. Migrate Legacy Role Permissions
-- Rename 'view_credit_limit' to 'view_customer_credit_limit' in existing roles
UPDATE employee_roles
SET permissions = (
  SELECT jsonb_object_agg(
    CASE WHEN key = 'view_credit_limit' THEN 'view_customer_credit_limit' ELSE key END,
    value
  )
  FROM jsonb_each(permissions)
)
WHERE permissions ? 'view_credit_limit';

-- 2. Enforce Customer Credit Limit Modification
CREATE OR REPLACE FUNCTION enforce_customer_credit_permissions()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.credit_limit IS DISTINCT FROM OLD.credit_limit THEN
    IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'manage_customer_credit'::text) THEN
      RAISE EXCEPTION 'Permission denied: manage_customer_credit required to modify credit limit';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_contact_credit_permissions ON contacts;
CREATE TRIGGER trg_enforce_contact_credit_permissions
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_customer_credit_permissions();


-- 3. Update Payment Status Transition Trigger to protect cancel_payments
CREATE OR REPLACE FUNCTION enforce_payment_status_transition()
RETURNS trigger AS $$
BEGIN
  -- Insert Security Check
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('Approved', 'Rejected') THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text) THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;
    IF NEW.status = 'Cancelled' THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'cancel_payments'::text) THEN
        RAISE EXCEPTION 'Permission denied: cancel_payments required';
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
        IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text) THEN
          RAISE EXCEPTION 'Permission denied: approve_payments required';
        END IF;
      END IF;
      
      IF NEW.status = 'Cancelled' THEN
        IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'cancel_payments'::text) THEN
          RAISE EXCEPTION 'Permission denied: cancel_payments required';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_status_transition ON payments;
CREATE TRIGGER trg_payment_status_transition
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payment_status_transition();


-- 4. Update Order Credit Limit to allow overrides
CREATE OR REPLACE FUNCTION is_customer_overdue(p_contact_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN false;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_order_credit_limit()
RETURNS trigger AS $$
DECLARE
  v_outstanding numeric;
  v_limit numeric;
  v_action text;
  v_msg text;
  v_has_override boolean := false;
BEGIN
  -- 1. Evaluate Credit Days (Overdue invoices)
  IF is_customer_overdue(NEW.contact_id) THEN
    SELECT settings->'payments'->>'overdueAction' INTO v_action FROM accounts WHERE id = NEW.account_id;
    
    IF v_action IS NULL THEN
      v_action := 'warn';
    END IF;

    IF v_action != 'ignore' THEN
      v_msg := 'Customer has overdue invoices beyond allowed credit days.';
      IF v_action = 'block' THEN
        RAISE EXCEPTION '%' , v_msg USING ERRCODE = 'P0001';
      ELSE
        -- Log warning in timeline
        INSERT INTO module_activities (
          account_id, user_id, module_name, record_id, action, message, details
        ) VALUES (
          NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_limit_warning', v_msg,
          jsonb_build_object('reason', 'overdue')
        );
      END IF;
    END IF;
  END IF;

  -- 2. Evaluate Credit Limit
  SELECT credit_limit INTO v_limit FROM contacts WHERE id = NEW.contact_id;
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT settings->'payments'->>'creditLimitAction' INTO v_action FROM accounts WHERE id = NEW.account_id;
  IF v_action IS NULL THEN
    v_action := 'warn';
  END IF;

  IF v_action != 'ignore' THEN
    -- Calculate current outstanding balance
    v_outstanding := COALESCE((SELECT opening_balance FROM contacts WHERE id = NEW.contact_id), 0);
    
    v_outstanding := v_outstanding + COALESCE((
      SELECT SUM(total_amount) FROM orders WHERE contact_id = NEW.contact_id AND status = 'Closed' AND id != NEW.id
    ), 0);

    v_outstanding := v_outstanding - COALESCE((
      SELECT SUM(amount) FROM payments WHERE contact_id = NEW.contact_id AND status = 'Approved'
    ), 0);

    -- Check if this new order's amount pushes the balance over the limit
    IF v_outstanding + NEW.total_amount > v_limit THEN
      v_msg := 'Order amount exceeds available credit limit.';
      
      -- Check for override permission before blocking
      IF auth.uid() IS NOT NULL THEN
        v_has_override := has_permission(auth.uid(), NEW.account_id, 'override_credit_limit'::text);
      END IF;

      IF v_action = 'block' AND NOT v_has_override THEN
        RAISE EXCEPTION '%' , v_msg USING ERRCODE = 'P0001';
      ELSE
        -- Log warning in timeline (even if overridden, it's good to log it)
        IF v_action = 'block' AND v_has_override THEN
           v_msg := 'Credit limit exceeded, but order allowed due to user override permission.';
        END IF;

        INSERT INTO module_activities (
          account_id, user_id, module_name, record_id, action, message, details
        ) VALUES (
          NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_limit_warning', v_msg,
          jsonb_build_object('outstanding', v_outstanding, 'order_total', NEW.total_amount, 'limit', v_limit, 'overridden', v_has_override)
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_order_credit_limit ON orders;
CREATE TRIGGER trg_enforce_order_credit_limit
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_order_credit_limit();
