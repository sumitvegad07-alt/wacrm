-- ============================================================
-- `contacts.customer_code` exists on production but no migration ever created
-- it, so the migrations folder cannot rebuild the database. Three migrations
-- read or index the column — including 20261103130000, which puts a UNIQUE
-- INDEX on it and therefore fails outright on a fresh database with
--
--     ERROR: column "customer_code" does not exist
--
-- This is the same drift as `data_scope_extends` (noted in 20261103120000):
-- something added by hand on Mumbai and never written down. Declaring it here
-- is a no-op on production — the column is already there — and makes the chain
-- replayable, which is what let this be found at all: the four modules built on
-- 3 Nov could only be tested locally once the schema could be rebuilt.
--
-- Deliberately NOT unique and NOT null-constrained here: that is the business
-- of the duplicate-prevention setting and of 20261103130000's conditional
-- index, both of which are per-account choices rather than schema facts.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS customer_code text NULL;

COMMENT ON COLUMN public.contacts.customer_code IS
  'The customer''s code. Typed by a person, or minted by trg_set_customer_code '
  'when the account has automatic customer codes switched on.';
