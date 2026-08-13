-- Payment Collection Module Migration

-- 1. Create payment_types table
CREATE TABLE IF NOT EXISTS payment_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_payment_types_account_id ON payment_types(account_id);

ALTER TABLE payment_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payment types are viewable by account members"
  ON payment_types FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY "Payment types can be created by account members"
  ON payment_types FOR INSERT
  WITH CHECK (is_account_member(account_id));

CREATE POLICY "Payment types can be updated by account members"
  ON payment_types FOR UPDATE
  USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

CREATE POLICY "Payment types can be deleted by admins"
  ON payment_types FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE TRIGGER update_payment_types_updated_at
  BEFORE UPDATE ON payment_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- 2. Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  payment_number TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  verified_amount NUMERIC(15, 2),
  payment_type_id UUID REFERENCES payment_types(id) ON DELETE SET NULL,
  payment_type TEXT NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_number TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('visit','customer','admin','import','api')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),
  site_visit_id UUID REFERENCES site_visits(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  invoice_id UUID,
  erp_reference TEXT,
  erp_sync_status TEXT,
  receipt_number TEXT,
  receipt_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, payment_number)
);

CREATE INDEX IF NOT EXISTS idx_payments_account_id ON payments(account_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_contact_id ON payments(contact_id);
CREATE INDEX IF NOT EXISTS idx_payments_account_date ON payments(account_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_source ON payments(source);
CREATE INDEX IF NOT EXISTS idx_payments_site_visit_id ON payments(site_visit_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payments are viewable by account members"
  ON payments FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY "Payments can be created by account members"
  ON payments FOR INSERT
  WITH CHECK (is_account_member(account_id));

CREATE POLICY "Payments can be updated by account members"
  ON payments FOR UPDATE
  USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- NO DELETE POLICY - Financial records are never physically deleted

CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- 3. Create payment_attachments table
CREATE TABLE IF NOT EXISTS payment_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  content_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_attachments_payment_id ON payment_attachments(payment_id);

ALTER TABLE payment_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payment attachments are viewable by account members"
  ON payment_attachments FOR SELECT
  USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_attachments.payment_id AND is_account_member(p.account_id)));

CREATE POLICY "Payment attachments can be created by account members"
  ON payment_attachments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_attachments.payment_id AND is_account_member(p.account_id)));

CREATE POLICY "Payment attachments can be updated by account members"
  ON payment_attachments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_attachments.payment_id AND is_account_member(p.account_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_attachments.payment_id AND is_account_member(p.account_id)));

CREATE POLICY "Payment attachments can be deleted by account members"
  ON payment_attachments FOR DELETE
  USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_attachments.payment_id AND is_account_member(p.account_id)));


-- 4. Create payment_custom_values table
CREATE TABLE IF NOT EXISTS payment_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(payment_id, custom_field_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_custom_values_payment_id ON payment_custom_values(payment_id);

ALTER TABLE payment_custom_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payment custom values are viewable by account members"
  ON payment_custom_values FOR SELECT
  USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_custom_values.payment_id AND is_account_member(p.account_id)));

CREATE POLICY "Payment custom values can be created by account members"
  ON payment_custom_values FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_custom_values.payment_id AND is_account_member(p.account_id)));

CREATE POLICY "Payment custom values can be updated by account members"
  ON payment_custom_values FOR UPDATE
  USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_custom_values.payment_id AND is_account_member(p.account_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_custom_values.payment_id AND is_account_member(p.account_id)));

CREATE POLICY "Payment custom values can be deleted by account members"
  ON payment_custom_values FOR DELETE
  USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_custom_values.payment_id AND is_account_member(p.account_id)));


-- 5. Contact financial fields
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(15, 2);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS credit_days INTEGER;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(15, 2) DEFAULT 0;


-- 6. Account sequences extension
ALTER TABLE account_sequences ADD COLUMN IF NOT EXISTS payment_seq BIGINT DEFAULT 0;


-- 7. Auto-numbering function
CREATE OR REPLACE FUNCTION get_next_payment_number(p_account_id UUID)
RETURNS TEXT AS $$
DECLARE v_seq BIGINT; v_year TEXT;
BEGIN
  v_year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  INSERT INTO account_sequences (account_id, payment_seq)
  VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
  SET payment_seq = account_sequences.payment_seq + 1
  RETURNING payment_seq INTO v_seq;
  RETURN 'PAY-' || v_year || '-' || LPAD(v_seq::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_set_payment_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.payment_number IS NULL OR NEW.payment_number = '' THEN
    NEW.payment_number := get_next_payment_number(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_payment_number_trigger
  BEFORE INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_payment_number();


-- 8. Status transition function
CREATE OR REPLACE FUNCTION payment_status_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('Pending','Approved'), ('Pending','Rejected'), ('Pending','Cancelled')
  );
$$;


-- 9. update_payment_status RPC
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
    v_account_id, v_uid, 'payment', p_payment_id::text,
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


-- 10. enforce_payment_status_transition trigger
CREATE OR REPLACE FUNCTION enforce_payment_status_transition()
RETURNS trigger AS $$
BEGIN
  -- Only check if status is changing
  IF NEW.status != OLD.status THEN
    -- Check if transition is allowed
    IF NOT payment_status_transition_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
    END IF;

    -- Security: Only allow approval/rejection via the UI/API if the user has permission
    IF NEW.status IN ('Approved', 'Rejected') AND auth.uid() IS NOT NULL THEN
      IF NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments') THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_payment_status_transition
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payment_status_transition();


-- 11. Task table extension
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_payment_id ON tasks(payment_id);
