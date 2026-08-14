-- Make credit control actually respond to the settings screen.
--
-- The Payments settings screen stores enforcement under
--   settings.payment_settings.enable_credit_limit      (bool)
--   settings.payment_settings.credit_limit_enforcement ('warn' | 'block')
--   settings.payment_settings.enable_credit_days       (bool)
--   settings.payment_settings.credit_days_enforcement  ('warn' | 'block')
--
-- but `enforce_order_credit_limit` read
--   settings.payments.creditLimitAction
--   settings.payments.overdueAction
--
-- Different parent object, different key names. Nothing ever wrote the keys the
-- trigger read, so every account silently fell back to 'warn' and NO order was
-- ever blocked, however the founder configured it. Verified against production:
-- with "Block Orders" selected, a 999,999 order against a 1,000 limit inserted
-- without complaint; writing the trigger's own key blocked it correctly.
--
-- The settings screen is treated as the source of truth here. The legacy keys are
-- still honoured as a fallback so any account configured against the old shape
-- keeps working.
--
-- Also aligns the money maths with the UI: outstanding uses the verified amount
-- once an approver has set one, so a payment approved at a corrected figure does
-- not free up more credit than actually arrived.

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

  -- COALESCE(verified_amount, amount): an approver may settle a payment at a
  -- different figure than was collected, and the verified one is authoritative.
  SELECT COALESCE(SUM(COALESCE(verified_amount, amount)), 0) INTO v_paid
  FROM payments WHERE contact_id = p_contact_id AND status = 'Approved';

  IF v_paid >= v_opening THEN
    v_paid := v_paid - v_opening;
  ELSE
    v_paid := 0;
  END IF;

  FOR v_rec IN
    SELECT total_amount, created_at FROM orders
    WHERE contact_id = p_contact_id AND status = 'Closed' ORDER BY created_at ASC
  LOOP
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


CREATE OR REPLACE FUNCTION enforce_order_credit_limit()
RETURNS trigger AS $$
DECLARE
  v_settings jsonb;
  v_outstanding numeric;
  v_limit numeric;
  v_action text;
  v_enabled boolean;
  v_msg text;
  v_has_override boolean := false;
BEGIN
  SELECT COALESCE(settings, '{}'::jsonb) INTO v_settings FROM accounts WHERE id = NEW.account_id;

  -- ---------------------------------------------------------------------
  -- 1. Overdue (credit days)
  -- ---------------------------------------------------------------------
  v_enabled := COALESCE((v_settings->'payment_settings'->>'enable_credit_days')::boolean, true);

  IF v_enabled THEN
    v_action := COALESCE(
      v_settings->'payment_settings'->>'credit_days_enforcement',
      v_settings->'payments'->>'overdueAction',   -- legacy shape
      'warn'
    );

    IF v_action <> 'ignore' AND is_customer_overdue(NEW.contact_id) THEN
      v_msg := 'Customer has overdue invoices beyond allowed credit days.';

      IF auth.uid() IS NOT NULL THEN
        v_has_override := has_permission(auth.uid(), NEW.account_id, 'override_credit_limit'::text);
      END IF;

      IF v_action = 'block' AND NOT v_has_override THEN
        RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001';
      ELSE
        IF v_action = 'block' AND v_has_override THEN
          v_msg := 'Customer overdue, but order allowed by override permission.';
        END IF;
        INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
        VALUES (NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_days_warning', v_msg,
                jsonb_build_object('reason', 'overdue', 'overridden', v_has_override));
      END IF;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- 2. Credit limit
  -- ---------------------------------------------------------------------
  v_enabled := COALESCE((v_settings->'payment_settings'->>'enable_credit_limit')::boolean, true);
  IF NOT v_enabled THEN
    RETURN NEW;
  END IF;

  SELECT credit_limit INTO v_limit FROM contacts WHERE id = NEW.contact_id;
  -- A limit of 0 is a real ceiling (cash-only customer); only NULL means "no limit".
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  v_action := COALESCE(
    v_settings->'payment_settings'->>'credit_limit_enforcement',
    v_settings->'payments'->>'creditLimitAction',  -- legacy shape
    'warn'
  );

  IF v_action = 'ignore' THEN
    RETURN NEW;
  END IF;

  v_outstanding := COALESCE((SELECT opening_balance FROM contacts WHERE id = NEW.contact_id), 0);

  v_outstanding := v_outstanding + COALESCE((
    SELECT SUM(total_amount) FROM orders
    WHERE contact_id = NEW.contact_id AND status = 'Closed' AND id <> NEW.id
  ), 0);

  v_outstanding := v_outstanding - COALESCE((
    SELECT SUM(COALESCE(verified_amount, amount)) FROM payments
    WHERE contact_id = NEW.contact_id AND status = 'Approved'
  ), 0);

  IF v_outstanding + NEW.total_amount > v_limit THEN
    v_msg := 'Order amount exceeds available credit limit.';

    IF auth.uid() IS NOT NULL THEN
      v_has_override := has_permission(auth.uid(), NEW.account_id, 'override_credit_limit'::text);
    END IF;

    IF v_action = 'block' AND NOT v_has_override THEN
      RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001';
    ELSE
      IF v_action = 'block' AND v_has_override THEN
        v_msg := 'Credit limit exceeded, but order allowed by override permission.';
      END IF;
      INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
      VALUES (NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_limit_warning', v_msg,
              jsonb_build_object('outstanding', v_outstanding, 'order_total', NEW.total_amount,
                                 'limit', v_limit, 'overridden', v_has_override));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
