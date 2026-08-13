CREATE OR REPLACE FUNCTION generate_payment_number()
RETURNS TRIGGER AS $$
DECLARE
    next_num INT;
    prefix TEXT := 'PAY-';
BEGIN
    SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(payment_number, '^PAY-', '') AS INT)), 0) + 1
    INTO next_num
    FROM payments
    WHERE account_id = NEW.account_id;

    NEW.payment_number := prefix || LPAD(next_num::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
