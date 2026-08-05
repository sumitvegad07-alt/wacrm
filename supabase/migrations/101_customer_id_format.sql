-- Change the generate_customer_id function
CREATE OR REPLACE FUNCTION generate_customer_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN lpad(nextval('account_customer_id_seq')::text, 6, '0');
END;
$$;

-- Update existing accounts
UPDATE accounts
SET customer_id = lpad(REPLACE(customer_id, 'CUST-', ''), 6, '0')
WHERE customer_id LIKE 'CUST-%';
