CREATE OR REPLACE FUNCTION update_payment_status(
  p_payment_id UUID,
  p_new_status TEXT,
  p_verified_amount NUMERIC(15, 2) DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_payment RECORD;
  v_account_id UUID;
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  -- Get payment and verify existence
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  
  v_account_id := v_payment.account_id;

  -- Verify account membership
  IF NOT is_account_member(v_account_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check permission for approval/rejection
  IF p_new_status IN ('Approved', 'Rejected') AND NOT has_permission(v_uid, v_account_id, 'approve_payments') THEN
    RAISE EXCEPTION 'Permission denied: approve_payments required';
  END IF;

  -- Check if transition is valid
  IF p_new_status != v_payment.status AND NOT payment_status_transition_allowed(v_payment.status, p_new_status) THEN
    RAISE EXCEPTION 'Invalid payment status transition from % to %', v_payment.status, p_new_status;
  END IF;

  -- Perform update
  UPDATE payments
  SET 
    status = p_new_status,
    verified_amount = COALESCE(p_verified_amount, verified_amount),
    approved_by = CASE WHEN p_new_status = 'Approved' THEN v_uid ELSE approved_by END,
    approved_at = CASE WHEN p_new_status = 'Approved' THEN NOW() ELSE approved_at END,
    rejected_by = CASE WHEN p_new_status = 'Rejected' THEN v_uid ELSE rejected_by END,
    rejected_at = CASE WHEN p_new_status = 'Rejected' THEN NOW() ELSE rejected_at END,
    rejection_reason = CASE WHEN p_new_status = 'Rejected' THEN p_rejection_reason ELSE rejection_reason END,
    updated_at = NOW()
  WHERE id = p_payment_id
  RETURNING jsonb_build_object(
    'id', id,
    'status', status,
    'verified_amount', verified_amount,
    'approved_by', approved_by,
    'approved_at', approved_at,
    'rejected_by', rejected_by,
    'rejected_at', rejected_at,
    'rejection_reason', rejection_reason
  ) INTO v_result;

  -- Log module activity
  INSERT INTO module_activities (
    account_id, user_id, module_name, record_id, action, message, details
  ) VALUES (
    v_account_id, v_uid, 'payment', p_payment_id,
    'payment_status_changed',
    'Payment status changed to ' || p_new_status,
    jsonb_build_object(
      'old_status', v_payment.status,
      'new_status', p_new_status,
      'verified_amount', p_verified_amount,
      'rejection_reason', p_rejection_reason
    )
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
