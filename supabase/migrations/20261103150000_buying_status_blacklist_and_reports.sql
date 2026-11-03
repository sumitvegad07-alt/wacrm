-- ============================================================
-- Buying Status, part two: Blacklist (reason required), and the report
-- dimension + measure the first file left out.
--
-- Founder, 2026-11-03: "add one more status called blacklist and if anyone
-- marks it as a blacklist the reason is mendatary why the customer is marked
-- as blacklist."
--
-- BLACKLIST IS A HUMAN JUDGEMENT, NOT A COUNT. Buyer and Yet to Buy are worked
-- out from order history; Blacklist can only ever be set by a person, and it
-- must survive whatever the orders say afterwards. A blacklisted customer who
-- somehow places an order stays blacklisted — that is the whole point of
-- blacklisting him. So the automatic rule is blocked twice over: by the lock
-- that any manual set applies, and by an explicit guard on the status itself,
-- which holds even if a lock were cleared by some future code path.
--
-- THE REASON IS ENFORCED BY THE DATABASE, not by the form. "Mandatory" written
-- only into a React component is a promise the mobile app, the importer, a
-- future API caller and psql all get to break. A CHECK constraint cannot be
-- gone around:
--
--     buying_status <> 'blacklist' OR btrim(reason) <> ''
--
-- The RPC raises a readable message before the constraint ever fires, so a user
-- sees "Give a reason..." rather than a constraint name — but the constraint is
-- what makes it true.
--
-- Releasing the lock on a blacklisted customer is REFUSED rather than obeyed.
-- Obeying it would hand the row back to the automatic rule, which would quietly
-- turn a blacklisted customer back into a Buyer the next time he was invoiced —
-- unblacklisting someone as a side effect of releasing a lock. To stop
-- blacklisting someone you set a different status, which is a decision somebody
-- makes on purpose and which records who made it.
--
-- Blast radius: one widened CHECK, one new nullable column, and registry rows.
-- Nothing is shown to a tenant who has not switched Buying Status on.
-- ============================================================

-- ── 1. Three statuses, and the reason ────────────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS buying_status_reason text NULL;

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_buying_status_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_buying_status_check
  CHECK (buying_status IN ('buyer', 'yet_to_buy', 'blacklist'));

-- The mandatory reason. Every existing row is buyer/yet_to_buy, so this
-- validates trivially on live data.
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_blacklist_needs_reason;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_blacklist_needs_reason
  CHECK (
    buying_status <> 'blacklist'
    OR COALESCE(btrim(buying_status_reason), '') <> ''
  );

COMMENT ON COLUMN public.contacts.buying_status_reason IS
  'Why this customer was blacklisted. Required whenever buying_status = ''blacklist'' '
  '(contacts_blacklist_needs_reason), and cleared automatically when the status moves away '
  'from blacklist so a stale reason cannot linger on a trading customer.';

-- ── 2. The automatic rule must never overrule a blacklist ────
CREATE OR REPLACE FUNCTION public.recount_buying_status(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_first  timestamptz;
  v_row    public.contacts;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A human has decided this one. The blacklist test is deliberately separate
  -- from the lock: a blacklist outranks order history whatever the lock says.
  IF v_row.buying_status_locked OR v_row.buying_status = 'blacklist' THEN
    RETURN;
  END IF;

  SELECT min(o.date)::timestamptz
    INTO v_first
    FROM public.orders o
   WHERE o.contact_id = p_contact_id
     AND lower(btrim(coalesce(o.status, ''))) NOT IN ('cancelled', 'rejected');

  v_status := CASE WHEN v_first IS NULL THEN 'yet_to_buy' ELSE 'buyer' END;

  IF v_row.buying_status = v_status AND v_row.first_order_at IS NOT DISTINCT FROM v_first THEN
    RETURN;
  END IF;

  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE public.contacts
     SET buying_status = v_status,
         first_order_at = v_first
   WHERE id = p_contact_id;
  PERFORM set_config('ozzo.system_write', '', true);
END;
$$;

-- ── 3. Setting it by hand, now with a reason ─────────────────
-- The signature gains p_reason, so the two-argument version is dropped rather
-- than left behind to be resolved ambiguously.
DROP FUNCTION IF EXISTS public.set_buying_status(uuid, text);

CREATE OR REPLACE FUNCTION public.set_buying_status(
  p_contact_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_account uuid;
  v_profile uuid;
  v_reason  text := NULLIF(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF p_status NOT IN ('buyer', 'yet_to_buy', 'blacklist') THEN
    RAISE EXCEPTION 'Buying Status must be buyer, yet_to_buy or blacklist' USING ERRCODE = '22023';
  END IF;

  -- Readable before the CHECK constraint can fire with a constraint name.
  IF p_status = 'blacklist' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason for blacklisting this customer.' USING ERRCODE = '23514';
  END IF;

  SELECT account_id INTO v_account FROM public.contacts WHERE id = p_contact_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_profile
    FROM public.profiles WHERE user_id = v_uid AND account_id = v_account;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not a member of this account' USING ERRCODE = '42501';
  END IF;

  IF NOT (is_account_member(v_account, 'admin'::account_role_enum)
          OR has_permission(v_uid, v_account, 'manage_buying_status')) THEN
    RAISE EXCEPTION 'Not allowed to set Buying Status' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE public.contacts
     SET buying_status = p_status,
         -- Cleared when the status moves away from blacklist, so a reason
         -- cannot sit on a customer who is trading again.
         buying_status_reason = CASE WHEN p_status = 'blacklist' THEN v_reason ELSE NULL END,
         buying_status_locked = true,
         buying_status_set_by = v_profile,
         buying_status_set_at = now()
   WHERE id = p_contact_id;
  PERFORM set_config('ozzo.system_write', '', true);
END;
$$;

-- Releasing the lock: refused while the customer is blacklisted.
CREATE OR REPLACE FUNCTION public.clear_buying_status_lock(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_status  text;
BEGIN
  SELECT account_id, buying_status INTO v_account, v_status
    FROM public.contacts WHERE id = p_contact_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = '42501';
  END IF;
  IF NOT is_account_member(v_account, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'Only an admin may release a Buying Status set by hand' USING ERRCODE = '42501';
  END IF;

  -- Otherwise the next invoice would quietly turn a blacklisted customer back
  -- into a Buyer — unblacklisting somebody as a side effect.
  IF v_status = 'blacklist' THEN
    RAISE EXCEPTION
      'This customer is blacklisted. Set the status to Buyer or Yet to Buy first — releasing the lock would let order history undo the blacklist.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE public.contacts
     SET buying_status_locked = false,
         buying_status_set_by = NULL,
         buying_status_set_at = NULL
   WHERE id = p_contact_id;
  PERFORM set_config('ozzo.system_write', '', true);

  PERFORM recount_buying_status(p_contact_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_buying_status(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_buying_status(uuid, text, text) TO authenticated;

-- ── 4. Reports ───────────────────────────────────────────────
-- Buying Status as something to group by. `ageing` is already based on
-- contacts, so it reads base; `order` reaches it through the contacts join
-- that module already registers.
INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
  ('ageing', 'buying_status', 'Buying Status',
   $$CASE base.buying_status
       WHEN 'buyer' THEN 'Buyer'
       WHEN 'blacklist' THEN 'Blacklisted'
       ELSE 'Yet to Buy' END$$, '[]'::jsonb),
  ('order', 'buying_status', 'Buying Status',
   $$CASE c.buying_status
       WHEN 'buyer' THEN 'Buyer'
       WHEN 'blacklist' THEN 'Blacklisted'
       ELSE 'Yet to Buy' END$$, '["contacts"]'::jsonb)
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label,
      sql_select = EXCLUDED.sql_select,
      required_joins = EXCLUDED.required_joins;

-- "Buyers opened in period": how many customers bought for the FIRST time
-- inside whatever the report is grouping by. An order is that customer's first
-- exactly when its date equals the first_order_at the trigger maintains, so
-- this needs no window function and no second pass over orders.
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
  ('order', 'buyers_opened', 'Buyers Opened',
   $$COUNT(DISTINCT CASE WHEN c.first_order_at IS NOT NULL
                          AND base.date = c.first_order_at::date
                         THEN base.contact_id END)$$, 'number', '["contacts"]'::jsonb)
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label,
      sql_select = EXCLUDED.sql_select,
      type = EXCLUDED.type,
      required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
  ('ageing', 'buying_status', 'Buying Status',
   'base.buying_status = ($2::jsonb->>''buying_status'')', '[]'::jsonb),
  ('order', 'buying_status', 'Buying Status',
   'c.buying_status = ($2::jsonb->>''buying_status'')', '["contacts"]'::jsonb)
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label,
      sql_where = EXCLUDED.sql_where,
      required_joins = EXCLUDED.required_joins;
