-- ROLLBACK for 20260814190000_payment_hardening + 20260814200000_fix_credit_control_settings
-- Captured from production 2026-08-14 before either migration was applied.
--
-- Run this ONLY to restore the prior behaviour. Note that reverting section 1 restores a
-- world-readable attachment bucket, which is the security issue those migrations exist to
-- close — revert it only as an emergency measure, and re-apply as soon as possible.
--
-- NOT reversed here: the payment_attachments.file_url rewrite from full public URL to
-- object path. Restoring the old URL form is unnecessary — the path form works against a
-- public bucket too, since the client builds whichever URL it needs from the path.


-- ---------------------------------------------------------------------------
-- 1. Restore the bucket and its original (permissive) policies
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET public = true,
    file_size_limit = NULL,
    allowed_mime_types = NULL
WHERE id = 'payment_attachments';

DROP POLICY IF EXISTS "payment_attachments_select_own_account" ON storage.objects;
DROP POLICY IF EXISTS "payment_attachments_insert_own_account" ON storage.objects;
DROP POLICY IF EXISTS "payment_attachments_delete_own_account" ON storage.objects;

CREATE POLICY "Public Access"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'payment_attachments'::text);

CREATE POLICY "Authenticated users can upload attachments"
  ON storage.objects FOR INSERT
  WITH CHECK ((bucket_id = 'payment_attachments'::text) AND (auth.role() = 'authenticated'::text));

CREATE POLICY "Users can update their own attachments"
  ON storage.objects FOR UPDATE
  USING ((bucket_id = 'payment_attachments'::text) AND (auth.uid() = owner));

CREATE POLICY "Users can delete their own attachments"
  ON storage.objects FOR DELETE
  USING ((bucket_id = 'payment_attachments'::text) AND (auth.uid() = owner));


-- ---------------------------------------------------------------------------
-- 2. Restore the previous payment status trigger function and BOTH triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_payment_status_transition()
RETURNS trigger AS $$
BEGIN
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

  IF TG_OP = 'UPDATE' THEN
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
DROP TRIGGER IF EXISTS trg_enforce_payment_status_transition ON payments;

CREATE TRIGGER trg_enforce_payment_status_transition
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_status_transition();

CREATE TRIGGER trg_payment_status_transition
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_status_transition();


-- ---------------------------------------------------------------------------
-- 3. Restore the previous credit-limit enforcement
--    (reads settings->'payments'->>'creditLimitAction' / 'overdueAction',
--     which nothing writes — i.e. enforcement effectively disabled again)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_customer_overdue(p_contact_id uuid) RETURNS boolean AS $$
DECLARE
  v_credit_days int; v_opening numeric; v_paid numeric; v_rec record; v_days_old int;
BEGIN
  SELECT credit_days, opening_balance INTO v_credit_days, v_opening FROM contacts WHERE id = p_contact_id;
  IF v_credit_days IS NULL OR v_credit_days <= 0 THEN RETURN false; END IF;
  v_opening := COALESCE(v_opening, 0);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE contact_id = p_contact_id AND status = 'Approved';
  IF v_paid >= v_opening THEN v_paid := v_paid - v_opening; ELSE v_paid := 0; END IF;
  FOR v_rec IN SELECT total_amount, created_at FROM orders WHERE contact_id = p_contact_id AND status = 'Closed' ORDER BY created_at ASC LOOP
    IF v_paid >= v_rec.total_amount THEN
      v_paid := v_paid - v_rec.total_amount;
    ELSE
      v_paid := 0;
      v_days_old := EXTRACT(DAY FROM (now() - v_rec.created_at));
      IF v_days_old > v_credit_days THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION enforce_order_credit_limit()
RETURNS trigger AS $$
DECLARE
  v_outstanding numeric; v_limit numeric; v_action text; v_msg text;
  v_has_override boolean := false;
BEGIN
  IF is_customer_overdue(NEW.contact_id) THEN
    SELECT settings->'payments'->>'overdueAction' INTO v_action FROM accounts WHERE id = NEW.account_id;
    IF v_action IS NULL THEN v_action := 'warn'; END IF;
    IF v_action != 'ignore' THEN
      v_msg := 'Customer has overdue invoices beyond allowed credit days.';
      IF v_action = 'block' THEN
        RAISE EXCEPTION '%' , v_msg USING ERRCODE = 'P0001';
      ELSE
        INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
        VALUES (NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_limit_warning', v_msg,
                jsonb_build_object('reason', 'overdue'));
      END IF;
    END IF;
  END IF;

  SELECT credit_limit INTO v_limit FROM contacts WHERE id = NEW.contact_id;
  IF v_limit IS NULL THEN RETURN NEW; END IF;

  SELECT settings->'payments'->>'creditLimitAction' INTO v_action FROM accounts WHERE id = NEW.account_id;
  IF v_action IS NULL THEN v_action := 'warn'; END IF;

  IF v_action != 'ignore' THEN
    v_outstanding := COALESCE((SELECT opening_balance FROM contacts WHERE id = NEW.contact_id), 0);
    v_outstanding := v_outstanding + COALESCE((
      SELECT SUM(total_amount) FROM orders WHERE contact_id = NEW.contact_id AND status = 'Closed' AND id != NEW.id), 0);
    v_outstanding := v_outstanding - COALESCE((
      SELECT SUM(amount) FROM payments WHERE contact_id = NEW.contact_id AND status = 'Approved'), 0);

    IF v_outstanding + NEW.total_amount > v_limit THEN
      v_msg := 'Order amount exceeds available credit limit.';
      IF auth.uid() IS NOT NULL THEN
        v_has_override := has_permission(auth.uid(), NEW.account_id, 'override_credit_limit'::text);
      END IF;
      IF v_action = 'block' AND NOT v_has_override THEN
        RAISE EXCEPTION '%' , v_msg USING ERRCODE = 'P0001';
      ELSE
        IF v_action = 'block' AND v_has_override THEN
          v_msg := 'Credit limit exceeded, but order allowed due to user override permission.';
        END IF;
        INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
        VALUES (NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_limit_warning', v_msg,
                jsonb_build_object('outstanding', v_outstanding, 'order_total', NEW.total_amount,
                                   'limit', v_limit, 'overridden', v_has_override));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
