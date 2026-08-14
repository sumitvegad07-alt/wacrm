-- Payment numbering.
--
-- Superseded: an earlier revision of this file defined `generate_payment_number()`,
-- which derived the next number with MAX(...) + 1 over the account's existing rows.
-- That version was never deployed and should not be revived — it races under
-- concurrent inserts (two collections in the same second get the same number), and
-- its `REGEXP_REPLACE(payment_number, '^PAY-', '')::INT` cast throws outright on the
-- legacy `PAY-<year>-<seq>` rows that already exist in production.
--
-- Production numbers payments through `get_next_payment_number()`, installed by
-- 20260813170000_payment_collection_module.sql, which allocates from the
-- `account_sequences.payment_seq` counter in a single atomic upsert. This file is
-- kept as a no-op so the migration ledger stays contiguous.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'generate_payment_number'
  ) THEN
    DROP FUNCTION IF EXISTS generate_payment_number() CASCADE;
  END IF;
END $$;
