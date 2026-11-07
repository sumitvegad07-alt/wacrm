-- ============================================================
-- Where a portal order came from.
--
-- The Orders list resolves the salesman by looking orders.user_id up in
-- profiles IN THE BROWSER. A portal customer has no profiles row, so without
-- this column a portal order shows a blank salesman — not broken, just
-- mysterious, and mysterious is how a number stops being trusted.
--
-- Written by portal_place_order in Plan 3. Read by the Orders list now.
--
-- ON DELETE SET NULL: an order must outlive the customer who placed it. The
-- sibling column orders.contact_id already does this (068_orders_module.sql).
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS placed_by_portal_contact_id uuid NULL
    REFERENCES public.contacts(id) ON DELETE SET NULL;

-- ADD COLUMN IF NOT EXISTS does not change an existing column, so a re-run (or
-- a database that already has the first version of this file) keeps the old
-- NO ACTION constraint. Drop whatever foreign key sits on this column, found by
-- lookup rather than by guessing its generated name, then re-add it by name.
-- Re-running the file drops and re-adds the same constraint, so it ends in the
-- same state.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.orders'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.contacts'::regclass
       AND c.conkey = ARRAY(
             SELECT a.attnum FROM pg_attribute a
              WHERE a.attrelid = 'public.orders'::regclass
                AND a.attname = 'placed_by_portal_contact_id')
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_placed_by_portal_contact_id_fkey
    FOREIGN KEY (placed_by_portal_contact_id)
    REFERENCES public.contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.placed_by_portal_contact_id IS
  'The customer who placed this order through the DMS portal. NULL means a '
  'member of staff placed it. Drives the "Placed via" column. If the customer '
  'is deleted, the order survives and this goes back to NULL (ON DELETE SET NULL).';

-- The account-scoped index serves the Orders list. It leads with account_id, so
-- it cannot serve a lookup on this column alone, which is what a contact
-- delete needs to find referencing orders. This index serves that path.
CREATE INDEX IF NOT EXISTS orders_placed_by_portal_idx
  ON public.orders (account_id, placed_by_portal_contact_id)
  WHERE placed_by_portal_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_placed_by_portal_contact_fk_idx
  ON public.orders (placed_by_portal_contact_id)
  WHERE placed_by_portal_contact_id IS NOT NULL;
