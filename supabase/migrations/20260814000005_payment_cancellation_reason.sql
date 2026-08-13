-- 20260814000005_payment_cancellation_reason.sql

-- 1. Add cancellation_reason column to payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- 2. Update the RPC to accept and enforce cancellation_reason
CREATE OR REPLACE FUNCTION update_payment_status(
  p_payment_id uuid,
  p_new_status text,
  p_verified_amount numeric DEFAULT NULL,
  p_rejection_reason text DEFAULT NULL,
  p_cancellation_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
  v_payment jsonb;
  v_uid uuid := auth.uid();
  v_account_id uuid;
  v_old_status text;
  v_details jsonb := '{}'::jsonb;
BEGIN
  SELECT account_id, status INTO v_account_id, v_old_status FROM payments WHERE id = p_payment_id;
  
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  -- Validate Permissions natively handled by the trigger `trg_enforce_payment_status_transition`
  
  -- Add specific logic for cancellation reasons
  IF p_new_status = 'Cancelled' THEN
    IF p_cancellation_reason IS NULL OR trim(p_cancellation_reason) = '' THEN
      RAISE EXCEPTION 'Cancellation reason is required when cancelling a payment';
    END IF;
    v_details := jsonb_build_object('cancellation_reason', p_cancellation_reason);
  END IF;

  -- Update Payment
  UPDATE payments
  SET 
    status = p_new_status,
    verified_amount = COALESCE(p_verified_amount, verified_amount),
    notes = CASE 
      WHEN p_new_status = 'Rejected' AND p_rejection_reason IS NOT NULL THEN p_rejection_reason 
      ELSE notes 
    END,
    cancellation_reason = CASE
      WHEN p_new_status = 'Cancelled' THEN p_cancellation_reason
      ELSE cancellation_reason
    END,
    updated_at = now()
  WHERE id = p_payment_id
  RETURNING to_jsonb(payments.*) INTO v_payment;

  -- Log module activity
  INSERT INTO module_activities (
    account_id, user_id, module_name, record_id, action, message, details
  ) VALUES (
    v_account_id, v_uid, 'payment', p_payment_id, 'status_changed',
    'Payment status changed to ' || p_new_status || COALESCE(' Reason: ' || p_rejection_reason, '') || COALESCE(' Reason: ' || p_cancellation_reason, ''),
    v_details
  );

  RETURN v_payment;
END;
$function$;
