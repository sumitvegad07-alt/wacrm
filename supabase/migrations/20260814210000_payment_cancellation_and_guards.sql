-- Pilot-blocking fixes: cancellation, financial-field guards, date validation,
-- duplicate detection.
--
-- ROOT CAUSES (traced UI -> API -> RPC -> trigger -> constraint -> schema):
--
-- S12b  The Cancel dialog calls update_payment_status with p_cancellation_reason.
--       The deployed function has four parameters and that is not one of them, so
--       PostgREST cannot resolve the call at all. Nothing downstream ever runs.
-- S12   payment_status_transition_allowed() omits ('Approved','Cancelled'), so even a
--       resolvable call could not reverse an approved payment. The trigger's own
--       "Approved payments are read-only, except for cancellation" rule was therefore
--       unreachable code.
-- S12c  There is no cancellation_reason column, no cancelled_by, no cancelled_at.
-- S13   Nothing anywhere requires a reason, so a cancellation records who and when but
--       never why.
-- S3b   enforce_customer_credit_permissions() guards credit_limit only; opening_balance
--       and credit_days are unguarded, letting a rep restate what a customer owes.
-- S19c  payment_date has no bounds, so a collection can be dated 400 days back.
-- S27b  Only the primary key prevents duplicates, which stops a retry but not a human
--       saving the same collection twice.


-- ===========================================================================
-- 1. Cancellation audit columns
-- ===========================================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

COMMENT ON COLUMN payments.cancellation_reason IS
  'Why a payment was cancelled. Mandatory — enforced by enforce_payment_status_transition().';


-- ===========================================================================
-- 2. Allow an approved payment to be reversed
-- ===========================================================================
-- Approved stays otherwise terminal: it cannot go back to Pending, and it cannot be
-- Rejected after the fact. Cancellation is the single, audited reversal path, and it
-- leaves the original row intact rather than deleting anything.
CREATE OR REPLACE FUNCTION payment_status_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('Pending','Approved'), ('Pending','Rejected'), ('Pending','Cancelled'),
    ('Approved','Cancelled')
  );
$$;


-- ===========================================================================
-- 3. Status trigger: mandatory reason, audit stamps, permission, date bounds
-- ===========================================================================
-- Enforcement lives here rather than only in the RPC because the mobile app writes
-- the payments table directly through its offline sync queue and never calls the RPC.
-- A rule that exists only in the RPC does not exist for the field.
CREATE OR REPLACE FUNCTION enforce_payment_status_transition()
RETURNS trigger AS $$
DECLARE
  v_approval_required boolean;
  v_settings jsonb;
  v_backdate_days int;
  v_age_days int;
BEGIN
  SELECT COALESCE(a.settings, '{}'::jsonb) INTO v_settings FROM accounts a WHERE a.id = NEW.account_id;

  IF TG_OP = 'INSERT' THEN
    ---------------------------------------------------------------------
    -- Payment date bounds (S19c)
    ---------------------------------------------------------------------
    IF NEW.payment_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'Payment date cannot be in the future' USING ERRCODE = 'check_violation';
    END IF;

    v_backdate_days := COALESCE((v_settings->'payment_settings'->>'allow_backdate_days')::int, 30);
    v_age_days := CURRENT_DATE - NEW.payment_date;

    IF v_age_days > v_backdate_days THEN
      -- A dated-back collection is legitimate sometimes (cheque handed over last week,
      -- entered today), so it is a permission rather than a hard ban.
      IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), NEW.account_id, 'backdate_payments'::text) THEN
        RAISE EXCEPTION 'Payment date is % days old; limit is % days. backdate_payments permission required.',
          v_age_days, v_backdate_days USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    ---------------------------------------------------------------------
    -- Status guards on creation
    ---------------------------------------------------------------------
    v_approval_required := COALESCE((v_settings->'payment_settings'->>'approval_required')::boolean, true);

    IF NEW.status = 'Approved' AND COALESCE(v_approval_required, true) THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text) THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;

    IF NEW.status = 'Rejected' THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text) THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;

    IF NEW.status = 'Cancelled' THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'cancel_payments'::text) THEN
        RAISE EXCEPTION 'Permission denied: cancel_payments required';
      END IF;
      IF NEW.cancellation_reason IS NULL OR btrim(NEW.cancellation_reason) = '' THEN
        RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = 'check_violation';
      END IF;
      NEW.cancelled_by := COALESCE(NEW.cancelled_by, auth.uid());
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Approved payments are immutable apart from being cancelled.
    IF OLD.status = 'Approved' AND NEW.status <> 'Cancelled' THEN
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
        IF NEW.cancellation_reason IS NULL OR btrim(NEW.cancellation_reason) = '' THEN
          RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = 'check_violation';
        END IF;
        NEW.cancelled_by := COALESCE(NEW.cancelled_by, auth.uid());
        NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ===========================================================================
-- 4. Duplicate detection — warn, never block (S27b)
-- ===========================================================================
-- Same customer, same amount, same payment date, recorded inside a short window.
-- Returned to the caller so the UI can ask "are you sure?", and logged on insert so
-- a duplicate created from mobile or the API is still visible to finance afterwards.
CREATE OR REPLACE FUNCTION check_duplicate_payment(
  p_account_id uuid,
  p_contact_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_exclude_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_window int;
  v_matches jsonb;
BEGIN
  SELECT COALESCE((settings->'payment_settings'->>'duplicate_window_minutes')::int, 60)
    INTO v_window FROM accounts WHERE id = p_account_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'payment_number', payment_number, 'amount', amount,
           'status', status, 'created_at', created_at)), '[]'::jsonb)
    INTO v_matches
  FROM payments
  WHERE account_id = p_account_id
    AND contact_id = p_contact_id
    AND amount = p_amount
    AND payment_date = p_payment_date
    AND status <> 'Cancelled'
    AND (p_exclude_id IS NULL OR id <> p_exclude_id)
    AND created_at >= now() - make_interval(mins => v_window);

  RETURN jsonb_build_object(
    'is_duplicate', jsonb_array_length(v_matches) > 0,
    'window_minutes', v_window,
    'matches', v_matches
  );
END;
$$;

CREATE OR REPLACE FUNCTION log_duplicate_payment_warning()
RETURNS trigger AS $$
DECLARE v_check jsonb;
BEGIN
  v_check := check_duplicate_payment(NEW.account_id, NEW.contact_id, NEW.amount, NEW.payment_date, NEW.id);
  IF (v_check->>'is_duplicate')::boolean THEN
    INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
    VALUES (NEW.account_id, auth.uid(), 'payment', NEW.id, 'duplicate_payment_warning',
            'Possible duplicate collection: same customer, amount and date already recorded.',
            v_check);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_duplicate_payment ON payments;
CREATE TRIGGER trg_log_duplicate_payment
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION log_duplicate_payment_warning();


-- ===========================================================================
-- 5. Replace the status RPC so the Cancel path actually resolves
-- ===========================================================================
-- The old four-argument function is dropped rather than overloaded: keeping both would
-- make a four-named-argument call ambiguous.
DROP FUNCTION IF EXISTS update_payment_status(uuid, text, numeric, text);

CREATE OR REPLACE FUNCTION update_payment_status(
  p_payment_id uuid,
  p_new_status text,
  p_verified_amount numeric DEFAULT NULL,
  p_rejection_reason text DEFAULT NULL,
  p_cancellation_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_payment RECORD;
  v_account_id uuid;
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  v_account_id := v_payment.account_id;

  IF NOT is_account_member(v_account_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_new_status IN ('Approved', 'Rejected')
     AND NOT has_permission(v_uid, v_account_id, 'approve_payments') THEN
    RAISE EXCEPTION 'Permission denied: approve_payments required';
  END IF;

  -- Cancellation was never checked here; it relied entirely on the trigger.
  IF p_new_status = 'Cancelled'
     AND NOT has_permission(v_uid, v_account_id, 'cancel_payments') THEN
    RAISE EXCEPTION 'Permission denied: cancel_payments required';
  END IF;

  IF p_new_status = 'Cancelled'
     AND (p_cancellation_reason IS NULL OR btrim(p_cancellation_reason) = '') THEN
    RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = 'check_violation';
  END IF;

  IF p_new_status <> v_payment.status
     AND NOT payment_status_transition_allowed(v_payment.status, p_new_status) THEN
    RAISE EXCEPTION 'Invalid payment status transition from % to %', v_payment.status, p_new_status;
  END IF;

  UPDATE payments
  SET
    status = p_new_status,
    -- The verified figure is frozen at cancellation so the audit trail still shows
    -- what had been settled before the reversal.
    verified_amount = COALESCE(p_verified_amount, verified_amount),
    approved_by  = CASE WHEN p_new_status = 'Approved'  THEN v_uid ELSE approved_by END,
    approved_at  = CASE WHEN p_new_status = 'Approved'  THEN now() ELSE approved_at END,
    rejected_by  = CASE WHEN p_new_status = 'Rejected'  THEN v_uid ELSE rejected_by END,
    rejected_at  = CASE WHEN p_new_status = 'Rejected'  THEN now() ELSE rejected_at END,
    rejection_reason = CASE WHEN p_new_status = 'Rejected' THEN p_rejection_reason ELSE rejection_reason END,
    cancelled_by = CASE WHEN p_new_status = 'Cancelled' THEN v_uid ELSE cancelled_by END,
    cancelled_at = CASE WHEN p_new_status = 'Cancelled' THEN now() ELSE cancelled_at END,
    cancellation_reason = CASE WHEN p_new_status = 'Cancelled' THEN p_cancellation_reason ELSE cancellation_reason END,
    updated_at = now()
  WHERE id = p_payment_id
  RETURNING jsonb_build_object(
    'id', id, 'status', status, 'verified_amount', verified_amount,
    'approved_by', approved_by, 'approved_at', approved_at,
    'rejected_by', rejected_by, 'rejected_at', rejected_at, 'rejection_reason', rejection_reason,
    'cancelled_by', cancelled_by, 'cancelled_at', cancelled_at, 'cancellation_reason', cancellation_reason
  ) INTO v_result;

  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
  VALUES (
    v_account_id, v_uid, 'payment', p_payment_id, 'payment_status_changed',
    'Payment status changed to ' || p_new_status
      || CASE WHEN p_new_status = 'Cancelled' THEN ' — ' || p_cancellation_reason ELSE '' END,
    jsonb_build_object(
      'old_status', v_payment.status,
      'new_status', p_new_status,
      'verified_amount', p_verified_amount,
      'rejection_reason', p_rejection_reason,
      'cancellation_reason', p_cancellation_reason
    )
  );

  RETURN v_result;
END;
$$;


-- ===========================================================================
-- 6. Protect every customer financial field, not just the credit limit
-- ===========================================================================
-- Reuses permissions that already exist in the registry rather than inventing new
-- ones: manage_customer_credit covers the credit terms (limit and days), and
-- edit_opening_balance covers the carried-forward balance.
CREATE OR REPLACE FUNCTION enforce_customer_credit_permissions()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF NEW.credit_limit IS DISTINCT FROM OLD.credit_limit
       AND NOT has_permission(auth.uid(), NEW.account_id, 'manage_customer_credit'::text) THEN
      RAISE EXCEPTION 'Permission denied: manage_customer_credit required to modify credit limit';
    END IF;

    IF NEW.credit_days IS DISTINCT FROM OLD.credit_days
       AND NOT has_permission(auth.uid(), NEW.account_id, 'manage_customer_credit'::text) THEN
      RAISE EXCEPTION 'Permission denied: manage_customer_credit required to modify credit days';
    END IF;

    IF NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
       AND NOT has_permission(auth.uid(), NEW.account_id, 'edit_opening_balance'::text) THEN
      RAISE EXCEPTION 'Permission denied: edit_opening_balance required to modify opening balance';
    END IF;
  END IF;

  -- Creation is governed by create_contacts; a customer has to be opened with its terms.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_contact_credit_permissions ON contacts;
CREATE TRIGGER trg_enforce_contact_credit_permissions
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_customer_credit_permissions();
