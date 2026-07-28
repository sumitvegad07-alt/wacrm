-- ============================================================
-- 094_safe_sequence_account.sql
-- Ensure set_deal_number and set_quotation_number triggers
-- safely resolve account_id if it is omitted on INSERT.
-- ============================================================

CREATE OR REPLACE FUNCTION set_deal_number()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF NEW.deal_number IS NULL OR NEW.deal_number = '' THEN
    v_account_id := NEW.account_id;
    IF v_account_id IS NULL THEN
      SELECT account_id INTO v_account_id FROM profiles WHERE id = auth.uid();
      NEW.account_id := v_account_id;
    END IF;
    IF v_account_id IS NOT NULL THEN
      NEW.deal_number := get_next_deal_number(v_account_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_quotation_number()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF NEW.quotation_number IS NULL OR NEW.quotation_number = '' THEN
    v_account_id := NEW.account_id;
    IF v_account_id IS NULL THEN
      SELECT account_id INTO v_account_id FROM profiles WHERE id = auth.uid();
      NEW.account_id := v_account_id;
    END IF;
    IF v_account_id IS NOT NULL THEN
      NEW.quotation_number := get_next_quotation_number(v_account_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
