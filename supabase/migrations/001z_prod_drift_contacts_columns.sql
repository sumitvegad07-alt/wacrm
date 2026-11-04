-- ============================================================
-- Columns that exist on production but were never written down.
--
-- WHY THE ODD FILENAME. These have to be declared BEFORE the migrations that
-- read them, and the earliest consumer is 20261005140000. `001z_` sorts after
-- `001_initial_schema.sql` (which creates `contacts`) and before `002_` under
-- both byte order and locale collation, which is the whole requirement.
--
-- WHY THIS FILE AND NOT 20261104110000. That migration — written yesterday for
-- exactly this reason — declares `contacts.customer_code`, but it sorts AFTER
-- `20261103130000_automatic_master_codes.sql`, which puts a UNIQUE INDEX on the
-- column. So on a fresh database the index still fails with
--
--     ERROR: column "customer_code" does not exist
--
-- and the chain still cannot rebuild. A column declaration only helps the
-- migrations that come after it. 20261104110000 is left in place because it may
-- already be applied on Mumbai and `ADD COLUMN IF NOT EXISTS` twice is free.
--
-- Same drift as `data_scope_extends` (noted in 20261103120000): added by hand on
-- Mumbai and never recorded. Declaring them here is a no-op on production.
--
-- Found by rebuilding the schema from scratch to test the area-mapping
-- migration — 236 failures at first, which is what an unreplayable chain looks
-- like once you actually try it rather than trusting the last note about it.
-- ============================================================

-- Read by 20261005140000 (territory customer counts), the Customers list, the
-- customer form's parent picker and the report engine.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.contacts.is_active IS
  'False for a soft-deleted / deactivated customer. Lists, pickers and counts exclude them; '
  'their history is kept. Prod-only drift until 001z declared it.';

-- Read by 20261103130000 (which indexes it), 20260929155000 and the importer.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS customer_code text NULL;

COMMENT ON COLUMN public.contacts.customer_code IS
  'The customer''s code. Typed by a person, or minted by trg_set_customer_code when the account '
  'has automatic customer codes switched on.';
