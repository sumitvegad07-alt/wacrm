-- ============================================================
-- 20261005130000_outstanding_rule_and_stored_balance.sql
--
-- Two founder decisions from 2026-10-05, in one migration because they touch
-- the same maths:
--
--  1. WHICH orders count as money owed, and which payments count as received,
--     is the account's choice. Until now it was hard-wired to
--     `orders.status = 'Closed'` minus `payments.status = 'Approved'`, written
--     out separately in the credit-limit trigger, the overdue check and six
--     places in the web app.
--
--  2. Outstanding is STORED, not re-derived on every screen.
--     Founder: "why outstanding is not stored anywhere, it must be stored."
--     The ledger stays the source of truth — `customer_outstanding()` can
--     recompute any customer, or a whole account, at any moment — but the answer
--     now lives on `contacts.outstanding_balance`, maintained by triggers. That
--     makes the customer list sortable and filterable by what people owe, which
--     was impossible before.
--
-- Defaults reproduce the old behaviour exactly ({'Closed'} / {'Approved'}), so
-- no account's figures move until an admin changes the setting in Settings.
--
-- Mirrors src/lib/payments/outstanding-config.ts. The status lists live in both
-- places deliberately: the database must enforce the rule without trusting the
-- client, and the client must apply it without a round trip. Change them
-- together.
-- ============================================================

-- ── 1. The account's rule ────────────────────────────────────
-- Unknown statuses are dropped and the canonical order is imposed, so a bad or
-- hand-edited setting cannot make the maths unpredictable. An empty result falls
-- back to the old behaviour rather than counting nothing: a half-written setting
-- must never silently zero every customer's balance.

CREATE OR REPLACE FUNCTION public.outstanding_order_statuses(p_account_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(
      (SELECT array_agg(k.s ORDER BY k.ord)
         FROM unnest(ARRAY['Pending','Approved','Part Dispatch','Dispatched','Closed','Cancelled','Rejected'])
              WITH ORDINALITY AS k(s, ord)
        WHERE k.s IN (
          SELECT jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(a.settings->'outstanding_settings'->'order_statuses') = 'array'
                        THEN a.settings->'outstanding_settings'->'order_statuses'
                        ELSE '[]'::jsonb END)
            FROM accounts a WHERE a.id = p_account_id
        )),
      ARRAY[]::text[]),
    ARRAY['Closed']);
$$;

CREATE OR REPLACE FUNCTION public.outstanding_payment_statuses(p_account_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(
      (SELECT array_agg(k.s ORDER BY k.ord)
         FROM unnest(ARRAY['Pending','Approved','Cancelled','Rejected'])
              WITH ORDINALITY AS k(s, ord)
        WHERE k.s IN (
          SELECT jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(a.settings->'outstanding_settings'->'payment_statuses') = 'array'
                        THEN a.settings->'outstanding_settings'->'payment_statuses'
                        ELSE '[]'::jsonb END)
            FROM accounts a WHERE a.id = p_account_id
        )),
      ARRAY[]::text[]),
    ARRAY['Approved']);
$$;

-- ── 2. The one calculation ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.customer_outstanding(p_contact_id uuid)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account uuid; v_opening numeric; v_orders numeric; v_payments numeric;
BEGIN
  SELECT account_id, COALESCE(opening_balance, 0)
    INTO v_account, v_opening
    FROM contacts WHERE id = p_contact_id;

  IF v_account IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_orders
    FROM orders
   WHERE contact_id = p_contact_id
     AND status = ANY (outstanding_order_statuses(v_account));

  -- An approver may verify a different figure than the rep collected; the
  -- verified figure wins once present. NULL means "not yet verified", not zero.
  SELECT COALESCE(SUM(COALESCE(verified_amount, amount)), 0) INTO v_payments
    FROM payments
   WHERE contact_id = p_contact_id
     AND status = ANY (outstanding_payment_statuses(v_account));

  RETURN v_opening + v_orders - v_payments;
END;
$$;

COMMENT ON FUNCTION public.customer_outstanding(uuid) IS
  'Source of truth for what a customer owes, under the account''s own rule. contacts.outstanding_balance is a cache of this and can always be rebuilt from it.';

-- ── 3. The stored balance ────────────────────────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS outstanding_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_updated_at timestamptz;

-- Sorting and filtering the customer list by what people owe is the whole point
-- of storing it.
CREATE INDEX IF NOT EXISTS idx_contacts_account_outstanding
  ON public.contacts (account_id, outstanding_balance);

-- Nobody writes this column by hand. It is a derived figure, and a client that
-- could PATCH it could make the list disagree with the ledger. Only
-- recalc_contact_outstanding may set it, which it signals with a transaction
-- local flag.
CREATE OR REPLACE FUNCTION public.tg_protect_outstanding_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('wacrm.recalc_outstanding', true), '') <> 'on' THEN
    NEW.outstanding_balance := OLD.outstanding_balance;
    NEW.outstanding_updated_at := OLD.outstanding_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_outstanding_balance ON public.contacts;
CREATE TRIGGER protect_outstanding_balance
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_protect_outstanding_balance();

CREATE OR REPLACE FUNCTION public.recalc_contact_outstanding(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_contact_id IS NULL THEN RETURN; END IF;
  PERFORM set_config('wacrm.recalc_outstanding', 'on', true);
  UPDATE contacts
     SET outstanding_balance   = customer_outstanding(p_contact_id),
         outstanding_updated_at = now()
   WHERE id = p_contact_id;
  PERFORM set_config('wacrm.recalc_outstanding', 'off', true);
END;
$$;

-- ── 4. Keeping it current ────────────────────────────────────
-- Dispatching goods moves the ORDER's status, so the orders trigger already
-- covers the "on dispatch" rule — no separate dispatch trigger is needed.
--
-- Known side effect: contacts already carries a `set_updated_at` BEFORE UPDATE
-- trigger, so a recalc bumps the customer's `updated_at`. Writing an order or a
-- payment therefore marks that customer as changed, and delta-sync clients (the
-- mobile app) will re-pull the row. The row genuinely did change, the payload is
-- one small record, and the order/payment write already triggers a sync of its
-- own — but it is a real increase in sync chatter and worth knowing about.

CREATE OR REPLACE FUNCTION public.tg_recalc_outstanding_from_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_contact_outstanding(OLD.contact_id);
    RETURN OLD;
  END IF;
  PERFORM recalc_contact_outstanding(NEW.contact_id);
  -- A re-pointed order leaves the previous customer owing less.
  IF TG_OP = 'UPDATE' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN
    PERFORM recalc_contact_outstanding(OLD.contact_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_recalc_outstanding_from_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_contact_outstanding(OLD.contact_id);
    RETURN OLD;
  END IF;
  PERFORM recalc_contact_outstanding(NEW.contact_id);
  IF TG_OP = 'UPDATE' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN
    PERFORM recalc_contact_outstanding(OLD.contact_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recalc_outstanding_on_order ON public.orders;
CREATE TRIGGER recalc_outstanding_on_order
  AFTER INSERT OR DELETE OR UPDATE OF status, total_amount, contact_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_outstanding_from_order();

DROP TRIGGER IF EXISTS recalc_outstanding_on_payment ON public.payments;
CREATE TRIGGER recalc_outstanding_on_payment
  AFTER INSERT OR DELETE OR UPDATE OF status, amount, verified_amount, contact_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_outstanding_from_payment();

-- Opening balance is part of the figure, so editing it must restate the cache.
-- Guarded on a real change so the recalc's own UPDATE cannot re-enter.
CREATE OR REPLACE FUNCTION public.tg_recalc_outstanding_from_opening()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM recalc_contact_outstanding(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS recalc_outstanding_on_opening ON public.contacts;
CREATE TRIGGER recalc_outstanding_on_opening
  AFTER UPDATE OF opening_balance ON public.contacts
  FOR EACH ROW
  WHEN (OLD.opening_balance IS DISTINCT FROM NEW.opening_balance)
  EXECUTE FUNCTION public.tg_recalc_outstanding_from_opening();

-- ── 5. Rebuilding a whole account ────────────────────────────
-- Called by Settings when an admin changes the rule. Without this the stored
-- figures would keep answering the old question.
CREATE OR REPLACE FUNCTION public.rebuild_account_outstanding(p_account_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('wacrm.recalc_outstanding', 'on', true);
  WITH updated AS (
    UPDATE contacts c
       SET outstanding_balance   = customer_outstanding(c.id),
           outstanding_updated_at = now()
     WHERE c.account_id = p_account_id
    RETURNING 1)
  SELECT count(*) INTO v_count FROM updated;
  PERFORM set_config('wacrm.recalc_outstanding', 'off', true);

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_account_outstanding(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_account_outstanding(uuid) TO authenticated;

-- ── 6. The existing checks follow the account's rule ─────────
-- Both of these named 'Closed'/'Approved' in their own source. Only the status
-- predicates change; the enforcement logic around them is untouched.

CREATE OR REPLACE FUNCTION public.is_customer_overdue(p_contact_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_credit_days int;
  v_opening numeric;
  v_paid numeric;
  v_rec record;
  v_days_old int;
  v_account uuid;
BEGIN
  SELECT credit_days, opening_balance, account_id
    INTO v_credit_days, v_opening, v_account
    FROM contacts WHERE id = p_contact_id;
  IF v_credit_days IS NULL OR v_credit_days <= 0 THEN
    RETURN false;
  END IF;

  v_opening := COALESCE(v_opening, 0);

  SELECT COALESCE(SUM(COALESCE(verified_amount, amount)), 0) INTO v_paid
  FROM payments
  WHERE contact_id = p_contact_id
    AND status = ANY (public.outstanding_payment_statuses(v_account));

  -- Payments settle oldest debt first: opening balance, then orders by date.
  IF v_paid >= v_opening THEN
    v_paid := v_paid - v_opening;
  ELSE
    v_paid := 0;
  END IF;

  FOR v_rec IN
    SELECT total_amount, created_at FROM orders
    WHERE contact_id = p_contact_id
      AND status = ANY (public.outstanding_order_statuses(v_account))
    ORDER BY created_at ASC
  LOOP
    IF v_paid >= v_rec.total_amount THEN
      v_paid := v_paid - v_rec.total_amount;
    ELSE
      v_paid := 0;
      v_days_old := EXTRACT(DAY FROM (now() - v_rec.created_at));
      IF v_days_old > v_credit_days THEN
        RETURN true;
      END IF;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_order_credit_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings jsonb;
  v_outstanding numeric;
  v_limit numeric;
  v_action text;
  v_enabled boolean;
  v_msg text;
  v_has_override boolean := false;
BEGIN
  SELECT COALESCE(settings, '{}'::jsonb) INTO v_settings FROM accounts WHERE id = NEW.account_id;

  v_enabled := COALESCE((v_settings->'payment_settings'->>'enable_credit_days')::boolean, true);

  IF v_enabled THEN
    v_action := COALESCE(
      v_settings->'payment_settings'->>'credit_days_enforcement',
      v_settings->'payments'->>'overdueAction',
      'warn'
    );

    IF v_action <> 'ignore' AND is_customer_overdue(NEW.contact_id) THEN
      v_msg := 'Customer has overdue invoices beyond allowed credit days.';

      IF auth.uid() IS NOT NULL THEN
        v_has_override := has_permission(auth.uid(), NEW.account_id, 'override_credit_limit'::text);
      END IF;

      IF v_action = 'block' AND NOT v_has_override THEN
        RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001';
      ELSE
        IF v_action = 'block' AND v_has_override THEN
          v_msg := 'Customer overdue, but order allowed by override permission.';
        END IF;
        INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
        VALUES (NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_days_warning', v_msg,
                jsonb_build_object('reason', 'overdue', 'overridden', v_has_override));
      END IF;
    END IF;
  END IF;

  v_enabled := COALESCE((v_settings->'payment_settings'->>'enable_credit_limit')::boolean, true);
  IF NOT v_enabled THEN
    RETURN NEW;
  END IF;

  SELECT credit_limit INTO v_limit FROM contacts WHERE id = NEW.contact_id;
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  v_action := COALESCE(
    v_settings->'payment_settings'->>'credit_limit_enforcement',
    v_settings->'payments'->>'creditLimitAction',
    'warn'
  );

  IF v_action = 'ignore' THEN
    RETURN NEW;
  END IF;

  -- Computed live rather than read from contacts.outstanding_balance: this runs
  -- mid-transaction on the very order being judged, which the cached figure does
  -- not yet reflect. The order under test is excluded so it is not counted twice.
  v_outstanding := COALESCE((SELECT opening_balance FROM contacts WHERE id = NEW.contact_id), 0);

  v_outstanding := v_outstanding + COALESCE((
    SELECT SUM(total_amount) FROM orders
    WHERE contact_id = NEW.contact_id
      AND status = ANY (public.outstanding_order_statuses(NEW.account_id))
      AND id <> NEW.id
  ), 0);

  v_outstanding := v_outstanding - COALESCE((
    SELECT SUM(COALESCE(verified_amount, amount)) FROM payments
    WHERE contact_id = NEW.contact_id
      AND status = ANY (public.outstanding_payment_statuses(NEW.account_id))
  ), 0);

  IF v_outstanding + NEW.total_amount > v_limit THEN
    v_msg := 'Order amount exceeds available credit limit.';

    IF auth.uid() IS NOT NULL THEN
      v_has_override := has_permission(auth.uid(), NEW.account_id, 'override_credit_limit'::text);
    END IF;

    IF v_action = 'block' AND NOT v_has_override THEN
      RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001';
    ELSE
      IF v_action = 'block' AND v_has_override THEN
        v_msg := 'Credit limit exceeded, but order allowed by override permission.';
      END IF;
      INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
      VALUES (NEW.account_id, auth.uid(), 'order', NEW.id, 'credit_limit_warning', v_msg,
              jsonb_build_object('outstanding', v_outstanding, 'order_total', NEW.total_amount,
                                 'limit', v_limit, 'overridden', v_has_override));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 7. The Outstanding report measure that was only ever documented ──
-- The AI connector's catalog advertises
--   fetch_data({ dataset: "outstanding", measures: ["outstanding_amount"] })
-- and calls the data set "outstanding receivables by age bucket". No such
-- measure has ever existed: the `ageing` module only ever had customer_count,
-- days_since_last_order, lifetime_order_count and never_ordered_count — it is a
-- dormancy report, not a receivables one. Any AI or saved report following the
-- documented example failed.
--
-- Storing the balance makes the advertised measure a one-liner, so add it rather
-- than quietly deleting the promise from the catalog.
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type)
VALUES ('ageing', 'outstanding_amount', 'Outstanding', 'SUM(base.outstanding_balance)', 'currency')
ON CONFLICT (module_name, key)
DO UPDATE SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type;

-- ── 8. Backfill ──────────────────────────────────────────────
-- Every existing customer gets a correct figure immediately, under their
-- account's current rule (which is the old behaviour until someone changes it).
DO $$
BEGIN
  PERFORM set_config('wacrm.recalc_outstanding', 'on', true);
  UPDATE contacts c
     SET outstanding_balance   = customer_outstanding(c.id),
         outstanding_updated_at = now();
  PERFORM set_config('wacrm.recalc_outstanding', 'off', true);
END $$;
