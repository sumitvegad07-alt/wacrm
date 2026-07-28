-- ============================================================
-- 093_fix_sequence_rls.sql
-- Fix sequence auto-generation RLS issues by setting SECURITY DEFINER
-- and adding INSERT policy on account_sequences
-- ============================================================

-- Add INSERT policy for account_sequences
DROP POLICY IF EXISTS "account_sequences_insert" ON account_sequences;
CREATE POLICY account_sequences_insert ON account_sequences FOR INSERT WITH CHECK (is_account_member(account_id));

-- Re-create get_next_deal_number as SECURITY DEFINER so any user can increment/insert sequence
CREATE OR REPLACE FUNCTION get_next_deal_number(p_account_id UUID)
RETURNS TEXT 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  UPDATE account_sequences
  SET deal_seq = COALESCE(deal_seq, 0) + 1
  WHERE account_id = p_account_id
  RETURNING deal_seq INTO v_seq;
  
  IF v_seq IS NULL THEN
    INSERT INTO account_sequences (account_id, deal_seq)
    VALUES (p_account_id, 1)
    RETURNING 1 INTO v_seq;
  END IF;
  
  RETURN 'DEAL-' || LPAD(v_seq::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Re-create get_next_quotation_number as SECURITY DEFINER
CREATE OR REPLACE FUNCTION get_next_quotation_number(p_account_id UUID)
RETURNS TEXT 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO account_sequences (account_id, quotation_seq)
  VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
  SET quotation_seq = COALESCE(account_sequences.quotation_seq, 0) + 1
  RETURNING quotation_seq INTO v_seq;
  
  RETURN 'QT-' || LPAD(v_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_next_deal_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_quotation_number(UUID) TO authenticated;
