-- Add deal_number to deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_number TEXT;

-- Add deal_seq to account_sequences
ALTER TABLE account_sequences ADD COLUMN IF NOT EXISTS deal_seq BIGINT DEFAULT 0;

-- Function to generate deal number
CREATE OR REPLACE FUNCTION get_next_deal_number(p_account_id UUID)
RETURNS TEXT AS $$
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

-- Trigger to automatically set deal number
CREATE OR REPLACE FUNCTION set_deal_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deal_number IS NULL OR NEW.deal_number = '' THEN
    NEW.deal_number := get_next_deal_number(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_deal_number ON deals;
CREATE TRIGGER trg_set_deal_number
BEFORE INSERT ON deals
FOR EACH ROW EXECUTE FUNCTION set_deal_number();

-- Make contact_id on quotations nullable
ALTER TABLE quotations ALTER COLUMN contact_id DROP NOT NULL;

-- Add lead_id to quotations
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

-- Backfill deal_number for existing deals
DO $$ 
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, account_id FROM deals WHERE deal_number IS NULL
  LOOP
    UPDATE deals SET deal_number = get_next_deal_number(r.account_id) WHERE id = r.id;
  END LOOP;
END $$;
