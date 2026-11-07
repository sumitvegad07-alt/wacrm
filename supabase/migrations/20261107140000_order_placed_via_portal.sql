-- ============================================================
-- Where a portal order came from.
--
-- The Orders list resolves the salesman by looking orders.user_id up in
-- profiles IN THE BROWSER. A portal customer has no profiles row, so without
-- this column a portal order shows a blank salesman — not broken, just
-- mysterious, and mysterious is how a number stops being trusted.
--
-- Written by portal_place_order in Plan 3. Read by the Orders list now.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS placed_by_portal_contact_id uuid NULL
    REFERENCES public.contacts(id);

COMMENT ON COLUMN public.orders.placed_by_portal_contact_id IS
  'The customer who placed this order through the DMS portal. NULL means a '
  'member of staff placed it. Drives the "Placed via" column.';

CREATE INDEX IF NOT EXISTS orders_placed_by_portal_idx
  ON public.orders (account_id, placed_by_portal_contact_id)
  WHERE placed_by_portal_contact_id IS NOT NULL;
