-- 20260814000003_enforce_order_credit_limit.sql

-- 1. Helper function to check if a customer is overdue
CREATE OR REPLACE FUNCTION is_customer_overdue(p_contact_id uuid) RETURNS boolean AS $$
DECLARE
  v_credit_days int;
  v_opening numeric;
  v_paid numeric;
  v_rec record;
  v_days_old int;
BEGIN
  SELECT credit_days, opening_balance INTO v_credit_days, v_opening FROM contacts WHERE id = p_contact_id;
  IF v_credit_days IS NULL OR v_credit_days <= 0 THEN
    RETURN false;
  END IF;

  v_opening := COALESCE(v_opening, 0);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE contact_id = p_contact_id AND status = 'Approved';

  IF v_paid >= v_opening THEN
    v_paid := v_paid - v_opening;
  ELSE
    v_paid := 0;
  END IF;

  FOR v_rec IN SELECT total_amount, created_at FROM orders WHERE contact_id = p_contact_id AND status = 'Closed' ORDER BY created_at ASC LOOP
    IF v_paid >= v_rec.total_amount THEN
      v_paid := v_paid - v_rec.total_amount;
    ELSE
      v_paid := 0;
      v_days_old := EXTRACT(DAY FROM (now() - v_rec.created_at));
      IF v_days_old > v_credit_days THEN
        RETURN true;
      END IF;
    END IF;
  END LOOP;

  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. Create the credit limit and days enforcement function
CREATE OR REPLACE FUNCTION enforce_order_credit_limit()
RETURNS trigger AS $$
DECLARE
  v_outstanding numeric;
  v_limit numeric;
  v_action text;
  v_days_action text;
  v_msg text;
BEGIN
  -- 1. Evaluate Credit Days (Overdue)
  SELECT settings->'payments'->>'creditDaysAction' INTO v_days_action FROM accounts WHERE id = NEW.account_id;
  IF v_days_action IS NULL THEN
    v_days_action := 'warn';
  END IF;

  IF v_days_action != 'ignore' AND is_customer_overdue(NEW.contact_id) THEN
    v_msg := 'Customer has overdue invoices exceeding credit days limit.';
    IF v_days_action = 'block' THEN
      RAISE EXCEPTION '%' , v_msg USING ERRCODE = 'P0002';
    ELSIF v_days_action = 'warn' THEN
      INSERT INTO module_activities (
        account_id, user_id, module_name, record_id, action, message, details
      ) VALUES (
        NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_days_warning', v_msg,
        jsonb_build_object('contact_id', NEW.contact_id)
      );
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
    -- Outstanding = Closed Orders - Approved Payments + Opening Balance
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
      IF v_action = 'block' THEN
        RAISE EXCEPTION '%' , v_msg USING ERRCODE = 'P0001';
      ELSE
        -- Log warning in timeline
        INSERT INTO module_activities (
          account_id, user_id, module_name, record_id, action, message, details
        ) VALUES (
          NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_limit_warning', v_msg,
          jsonb_build_object('outstanding', v_outstanding, 'order_total', NEW.total_amount, 'limit', v_limit)
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach the trigger to the orders table
DROP TRIGGER IF EXISTS trg_enforce_order_credit_limit ON orders;
CREATE TRIGGER trg_enforce_order_credit_limit
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_order_credit_limit();
