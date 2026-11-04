-- ============================================================
-- An order could not be saved for a customer with no Customer Level.
--
-- Migration 076 makes `hierarchy_level` mandatory on a customer once an account
-- switches order hierarchy on, and enforces it with a trigger that rejects ANY
-- update to a customer that has no level. That is right for a person editing a
-- customer, and wrong for the columns OZZO maintains by itself.
--
-- `recalc_contact_outstanding` writes two such columns — outstanding_balance and
-- outstanding_updated_at — and it runs from a trigger on orders, payments and
-- contacts. So on a tenant with Customer Level ON, saving an order for a
-- customer who has no level failed with
--
--     Customer Level is required because order hierarchy is enabled ...
--
-- while the person was saving an ORDER and had not touched the customer at all.
-- Deleting the order failed the same way, and so did taking a payment.
--
-- Migration 20261103140000 introduced `is_ozzo_system_write()` for exactly this
-- and used it for the Buying Status write. The outstanding balance predates it
-- and was never retrofitted — it is the same derived-column problem, and it is
-- the one that fires on the commonest action in the product.
--
-- Nothing here changes who may write what: the flag is transaction-local, set
-- immediately before the write and cleared immediately after, and a person
-- editing a customer still meets the enforcement unchanged.
--
-- Found by testing an order save on a hierarchy-enabled tenant, 4 Nov 2026. No
-- tenant has order hierarchy switched on today, so nobody has hit it yet; the
-- first FMCG tenant to switch on primary/secondary would have hit it at once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recalc_contact_outstanding(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_contact_id IS NULL THEN RETURN; END IF;
  PERFORM set_config('wacrm.recalc_outstanding', 'on', true);
  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE contacts
     SET outstanding_balance    = customer_outstanding(p_contact_id),
         outstanding_updated_at = now()
   WHERE id = p_contact_id;
  PERFORM set_config('ozzo.system_write', '', true);
  PERFORM set_config('wacrm.recalc_outstanding', 'off', true);
END;
$$;

COMMENT ON FUNCTION public.recalc_contact_outstanding(uuid) IS
  'Recomputes a customer''s outstanding balance. Runs under is_ozzo_system_write() '
  'because outstanding_balance is a derived column: without it, migration 076''s '
  'Customer Level enforcement rejects the write and the ORDER or PAYMENT that '
  'triggered it fails to save.';

-- The bulk recompute writes the same two derived columns, so it needs the same
-- flag or "Rebuild outstanding" fails on any account with a level-less customer.
CREATE OR REPLACE FUNCTION public.rebuild_account_outstanding(p_account_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('wacrm.recalc_outstanding', 'on', true);
  PERFORM set_config('ozzo.system_write', 'on', true);
  WITH updated AS (
    UPDATE contacts c
       SET outstanding_balance    = customer_outstanding(c.id),
           outstanding_updated_at = now()
     WHERE c.account_id = p_account_id
    RETURNING 1)
  SELECT count(*) INTO v_count FROM updated;
  PERFORM set_config('ozzo.system_write', '', true);
  PERFORM set_config('wacrm.recalc_outstanding', 'off', true);

  RETURN v_count;
END;
$$;
