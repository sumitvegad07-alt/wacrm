-- ============================================================
-- Customer mapping — which customer supplies which. Manual, or by beat.
--
-- Founder: "We need customer mapping through the beat mapping and manually
-- both option in our OZZO organisation settings. If admin selects manually,
-- add one field in customer creation — a parent id in customer. If admin
-- selects beat/route mapping, a simple beat/route selection option to map the
-- customers. That is how we will map the primary and secondary channel for
-- sales."
--
-- WHAT WE DID NOT ALREADY HAVE. Checked column by column before designing
-- this, because an earlier plan was shaped by assuming we did. `contacts` has
-- no parent_id and no distributor column. `hierarchy_level` is a NUMBER, and
-- migration 077 shows its only job: level 1 makes an order 'primary', below
-- that 'secondary', unset 'direct'. So the hierarchy has always answered "what
-- KIND of customer is this", never "which distributor serves this dealer", and
-- nothing else answered it either.
--
-- This module therefore replaces nothing. hierarchy_level keeps doing exactly
-- what it does, for every tenant, untouched. What it adds is the thing the
-- product could not say before: an order can already be called primary or
-- secondary, but not THROUGH WHOM.
--
-- ONE COLUMN HOLDS THE ANSWER IN BOTH MODES; THE MODE DECIDES WHO WRITES IT.
--   * manual — a human picks the parent on the customer form.
--   * beat   — a beat is given a parent, and every customer permanently on
--              that beat inherits it, maintained by trigger.
-- Deriving the parent on every read was the alternative: it cannot be indexed,
-- cannot be joined cheaply, and makes every report do the work again. One
-- stored, indexed column that something keeps correct is the better trade.
--
-- ONE-TIME STOPS DO NOT RE-PARENT ANYBODY. route_customers.one_time_date
-- (20261102130000) lets a beat visit a customer for a single day without
-- taking them off the beat they belong to. Only a PERMANENT, non-archived
-- membership sets a parent — which is exactly the predicate of
-- uq_route_customers_one_active_route, so there can only ever be one, and the
-- parent is never ambiguous.
--
-- THE 076 TRAP AGAIN. trg_enforce_contact_hierarchy_level refuses any update
-- to a level-less customer on an account with order hierarchy on. The beat
-- trigger writes contacts.parent_id, so without the marker added in
-- 20261103140000 a route edit would be REJECTED for such a customer. Every
-- system write here goes through is_ozzo_system_write(), same as Buying Status.
--
-- A BAD BEAT CONFIGURATION MUST NOT BLOCK A ROUTE SAVE. The guards below are
-- hard rules for a human writing parent_id — he should be told his pick is
-- wrong. The beat trigger instead checks first and writes NULL when the
-- candidate is not a legal parent, so a mis-set beat leaves customers unmapped
-- (which the Customers list reports as a count) rather than making the beat
-- uneditable.
--
-- Blast radius: one nullable column, one new table, and triggers that return
-- immediately unless the account has chosen a mapping mode. Off by default.
-- ============================================================

-- ── 1. The answer, and the beat's parent ─────────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS parent_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_parent_idx
  ON public.contacts (account_id, parent_id) WHERE parent_id IS NOT NULL;

COMMENT ON COLUMN public.contacts.parent_id IS
  'Which customer supplies this one (distributor → dealer). Written by a human in manual '
  'mapping mode and by trg_route_parent_sync in beat mode; always NULL while mapping is off. '
  'NOT the same thing as hierarchy_level, which says what KIND of customer this is.';

-- Which customer supplies a beat. One parent per beat; a parent may hold many
-- beats, which is why route_id alone is the key.
CREATE TABLE IF NOT EXISTS public.route_parent_customers (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  route_id   uuid NOT NULL REFERENCES public.routes(id)   ON DELETE CASCADE,
  parent_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (route_id)
);

CREATE INDEX IF NOT EXISTS route_parent_customers_parent_idx
  ON public.route_parent_customers (account_id, parent_id);

ALTER TABLE public.route_parent_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS route_parent_customers_select ON public.route_parent_customers;
CREATE POLICY route_parent_customers_select ON public.route_parent_customers
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS route_parent_customers_write ON public.route_parent_customers;
CREATE POLICY route_parent_customers_write ON public.route_parent_customers
  FOR ALL USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

COMMENT ON TABLE public.route_parent_customers IS
  'The customer who supplies a beat. Beat mapping mode copies this onto every customer '
  'permanently on that beat (contacts.parent_id). Keyed by route_id: one parent per beat, '
  'but a parent may supply many beats.';

-- ── 2. The mapping mode ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.customer_mapping_mode(p_account_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
           WHEN settings -> 'extra_settings' ->> 'customer_mapping_mode' IN ('manual', 'beat')
             THEN settings -> 'extra_settings' ->> 'customer_mapping_mode'
           ELSE 'off'
         END
    FROM public.accounts WHERE id = p_account_id;
$$;

REVOKE ALL ON FUNCTION public.customer_mapping_mode(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.customer_mapping_mode(uuid) TO authenticated;

COMMENT ON FUNCTION public.customer_mapping_mode(uuid) IS
  'off | manual | beat. Anything unrecognised, missing or null reads as off, so a tenant who '
  'has never configured mapping is never affected.';

-- ── 3. Is this a legal parent for that customer? ─────────────
-- Used as a hard guard for human writes and as a test before a beat write.
CREATE OR REPLACE FUNCTION public.is_legal_customer_parent(
  p_child_id uuid,
  p_parent_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_child  public.contacts;
  v_parent public.contacts;
  v_cur    uuid;
  v_depth  int := 0;
BEGIN
  IF p_parent_id IS NULL THEN
    RETURN true;                                  -- no parent is always legal
  END IF;
  IF p_child_id = p_parent_id THEN
    RETURN false;                                 -- nobody supplies themselves
  END IF;

  SELECT * INTO v_child  FROM public.contacts WHERE id = p_child_id;
  SELECT * INTO v_parent FROM public.contacts WHERE id = p_parent_id;
  IF v_child.id IS NULL OR v_parent.id IS NULL THEN
    RETURN false;
  END IF;

  -- Tenant isolation. Not in the written spec, but a parent in another
  -- account would leak that account's customer name into this one's reports.
  IF v_child.account_id <> v_parent.account_id THEN
    RETURN false;
  END IF;

  -- A dealer cannot supply a distributor. Only checked when BOTH levels are
  -- set: with order hierarchy off every level is NULL, and the rule cannot
  -- mean anything then. Lower number = higher up (level 1 is the top).
  IF v_child.hierarchy_level IS NOT NULL
     AND v_parent.hierarchy_level IS NOT NULL
     AND v_parent.hierarchy_level >= v_child.hierarchy_level THEN
    RETURN false;
  END IF;

  -- No loops: A supplies B supplies A. Same shape as prevent_manager_cycle
  -- (migration 106), which already guards the employee reporting chain.
  v_cur := v_parent.parent_id;
  WHILE v_cur IS NOT NULL AND v_depth < 10000 LOOP
    IF v_cur = p_child_id THEN
      RETURN false;
    END IF;
    SELECT parent_id INTO v_cur FROM public.contacts WHERE id = v_cur;
    v_depth := v_depth + 1;
  END LOOP;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.is_legal_customer_parent(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_legal_customer_parent(uuid, uuid) TO authenticated;

-- The hard guard, with a readable reason for each way it can fail.
CREATE OR REPLACE FUNCTION public.enforce_customer_parent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parent public.contacts;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A customer cannot be their own supplier.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_parent FROM public.contacts WHERE id = NEW.parent_id;
  IF v_parent.id IS NULL OR v_parent.account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'That supplier is not a customer of this account.' USING ERRCODE = '23514';
  END IF;

  IF NEW.hierarchy_level IS NOT NULL
     AND v_parent.hierarchy_level IS NOT NULL
     AND v_parent.hierarchy_level >= NEW.hierarchy_level THEN
    RAISE EXCEPTION
      'A supplier must sit above this customer in the hierarchy. % is at the same level or below.',
      coalesce(v_parent.company, v_parent.name, 'That customer')
      USING ERRCODE = '23514';
  END IF;

  IF NOT is_legal_customer_parent(NEW.id, NEW.parent_id) THEN
    RAISE EXCEPTION
      'Supply loop: % would end up being supplied through themselves.',
      coalesce(NEW.company, NEW.name, 'this customer')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_customer_parent ON public.contacts;
CREATE TRIGGER trg_enforce_customer_parent
  BEFORE INSERT OR UPDATE OF parent_id ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_parent();

-- ── 4. Beat mode: the trigger that owns parent_id ───────────
-- The parent of one customer, worked out from their permanent beat.
CREATE OR REPLACE FUNCTION public.resync_customer_parent_from_beat(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account   uuid;
  v_candidate uuid;
  v_current   uuid;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN;
  END IF;

  SELECT account_id, parent_id INTO v_account, v_current
    FROM public.contacts WHERE id = p_contact_id;
  IF v_account IS NULL OR customer_mapping_mode(v_account) <> 'beat' THEN
    RETURN;                              -- manual mode: a human owns this column
  END IF;

  -- Permanent, non-archived membership only. one_time_date rows are a visit,
  -- not a home, so they must not change who supplies this customer.
  SELECT rpc.parent_id
    INTO v_candidate
    FROM public.route_customers rc
    JOIN public.route_parent_customers rpc ON rpc.route_id = rc.route_id
   WHERE rc.contact_id = p_contact_id
     AND rc.archived_at IS NULL
     AND rc.one_time_date IS NULL
   LIMIT 1;

  -- A beat whose parent would be illegal for this customer (same customer,
  -- wrong level, a loop) leaves them unmapped rather than breaking the beat.
  IF v_candidate IS NOT NULL
     AND NOT is_legal_customer_parent(p_contact_id, v_candidate) THEN
    v_candidate := NULL;
  END IF;

  IF v_current IS NOT DISTINCT FROM v_candidate THEN
    RETURN;                              -- nothing to do, the common case
  END IF;

  -- The marker from 20261103140000: without it this UPDATE is rejected for a
  -- level-less customer on a hierarchy account, and the ROUTE EDIT fails.
  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE public.contacts SET parent_id = v_candidate WHERE id = p_contact_id;
  PERFORM set_config('ozzo.system_write', '', true);
END;
$$;

-- A customer joining or leaving a beat.
CREATE OR REPLACE FUNCTION public.route_customers_parent_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.contact_id IS NOT NULL THEN
    PERFORM resync_customer_parent_from_beat(OLD.contact_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.contact_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.contact_id IS DISTINCT FROM OLD.contact_id) THEN
    PERFORM resync_customer_parent_from_beat(NEW.contact_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_customers_parent_sync ON public.route_customers;
CREATE TRIGGER trg_route_customers_parent_sync
  AFTER INSERT OR DELETE OR UPDATE OF contact_id, route_id, archived_at, one_time_date
  ON public.route_customers
  FOR EACH ROW EXECUTE FUNCTION public.route_customers_parent_sync();

-- A beat changing hands: every customer on it is re-parented.
CREATE OR REPLACE FUNCTION public.route_parent_changed_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_route uuid := COALESCE(NEW.route_id, OLD.route_id);
  v_id    uuid;
BEGIN
  FOR v_id IN
    SELECT rc.contact_id FROM public.route_customers rc
     WHERE rc.route_id = v_route
       AND rc.archived_at IS NULL
       AND rc.one_time_date IS NULL
  LOOP
    PERFORM resync_customer_parent_from_beat(v_id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_parent_changed_sync ON public.route_parent_customers;
CREATE TRIGGER trg_route_parent_changed_sync
  AFTER INSERT OR DELETE OR UPDATE OF parent_id ON public.route_parent_customers
  FOR EACH ROW EXECUTE FUNCTION public.route_parent_changed_sync();

-- Re-run beat mapping for a whole account. Used when the admin switches TO
-- beat mode, and by the settings screen to say how many parents would change
-- before anything is written.
CREATE OR REPLACE FUNCTION public.resync_account_beat_parents(
  p_account_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed bigint := 0;
  v_id      uuid;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'Only an admin may re-map customers' USING ERRCODE = '42501';
  END IF;

  WITH wanted AS (
    SELECT c.id,
           c.parent_id AS current_parent,
           (SELECT rpc.parent_id
              FROM public.route_customers rc
              JOIN public.route_parent_customers rpc ON rpc.route_id = rc.route_id
             WHERE rc.contact_id = c.id
               AND rc.archived_at IS NULL
               AND rc.one_time_date IS NULL
             LIMIT 1) AS beat_parent
      FROM public.contacts c
     WHERE c.account_id = p_account_id
  )
  SELECT count(*) INTO v_changed
    FROM wanted
   WHERE current_parent IS DISTINCT FROM beat_parent;

  IF p_dry_run THEN
    RETURN jsonb_build_object('would_change', v_changed, 'changed', 0, 'dry_run', true);
  END IF;

  FOR v_id IN SELECT id FROM public.contacts WHERE account_id = p_account_id LOOP
    PERFORM resync_customer_parent_from_beat(v_id);
  END LOOP;

  RETURN jsonb_build_object('would_change', v_changed, 'changed', v_changed, 'dry_run', false);
END;
$$;

REVOKE ALL ON FUNCTION public.resync_account_beat_parents(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.resync_account_beat_parents(uuid, boolean) TO authenticated;

-- The suppliers actually in use, for the Customers list filter. Without this
-- the filter could only offer raw parent_id uuids, which is a dead filter —
-- exactly what the table-filter-row work went through 26 screens to remove.
--
-- SECURITY INVOKER, deliberately: the caller's RLS must apply, so a rep never
-- sees a supplier they could not already see. A definer function here would
-- leak the names of customers outside their area.
CREATE OR REPLACE FUNCTION public.customer_suppliers(p_account_id uuid)
RETURNS TABLE (id uuid, label text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT DISTINCT p.id, COALESCE(NULLIF(btrim(p.company), ''), p.name, 'Unnamed')
    FROM public.contacts c
    JOIN public.contacts p ON p.id = c.parent_id
   WHERE c.account_id = p_account_id
   ORDER BY 2;
$$;

REVOKE ALL ON FUNCTION public.customer_suppliers(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.customer_suppliers(uuid) TO authenticated;

COMMENT ON FUNCTION public.customer_suppliers(uuid) IS
  'Distinct customers who supply at least one other customer, with a display label. Feeds the '
  'Supplied By filter. SECURITY INVOKER so the list is scoped to what the caller may see.';

-- ── 5. Orders remember the parent they were sold through ─────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS parent_contact_id uuid NULL REFERENCES public.contacts(id);

CREATE INDEX IF NOT EXISTS orders_parent_contact_idx
  ON public.orders (account_id, parent_contact_id) WHERE parent_contact_id IS NOT NULL;

COMMENT ON COLUMN public.orders.parent_contact_id IS
  'The customer who supplied this one AT THE TIME OF THE ORDER. A snapshot, never recomputed: '
  'if a dealer moves to a different distributor next March, last year''s orders must still '
  'report under the distributor who actually served them. A report that rewrites its own '
  'history is worse than no report.';

CREATE OR REPLACE FUNCTION public.set_order_parent_contact()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only ever filled in on the way in, and only if nobody supplied it.
  IF NEW.parent_contact_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT parent_id INTO NEW.parent_contact_id
      FROM public.contacts WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_order_parent_contact ON public.orders;
CREATE TRIGGER trg_set_order_parent_contact
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_order_parent_contact();

-- ── 6. Channel reporting ─────────────────────────────────────
INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
  ('order', 'channel', 'Channel',
   $$CASE base.classification
       WHEN 'primary' THEN 'Primary'
       WHEN 'secondary' THEN 'Secondary'
       ELSE 'Direct' END$$, '[]'::jsonb),
  ('order', 'parent_customer', 'Supplied By',
   $$COALESCE(pc.company, pc.name, '-')$$, '["order_parent"]'::jsonb),
  ('ageing', 'parent_customer', 'Supplied By',
   $$COALESCE(pc.company, pc.name, '-')$$, '["ageing_parent"]'::jsonb)
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label,
      sql_select = EXCLUDED.sql_select,
      required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
  ('order',  'order_parent',  'LEFT JOIN contacts pc ON base.parent_contact_id = pc.id'),
  ('ageing', 'ageing_parent', 'LEFT JOIN contacts pc ON base.parent_id = pc.id')
ON CONFLICT (module_name, join_key) DO UPDATE
  SET sql_join = EXCLUDED.sql_join;

-- Primary against secondary is the standard FMCG health check: primary running
-- consistently ahead of secondary is how stock sitting in a distributor's
-- godown shows up, rather than being sold on.
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
  ('order', 'primary_value', 'Primary Value',
   $$COALESCE(SUM(CASE WHEN base.classification = 'primary' THEN base.total_amount ELSE 0 END), 0)$$,
   'currency', '[]'::jsonb),
  ('order', 'secondary_value', 'Secondary Value',
   $$COALESCE(SUM(CASE WHEN base.classification = 'secondary' THEN base.total_amount ELSE 0 END), 0)$$,
   'currency', '[]'::jsonb),
  ('order', 'secondary_to_primary', 'Secondary / Primary %',
   $$ROUND(100.0 * COALESCE(SUM(CASE WHEN base.classification = 'secondary' THEN base.total_amount ELSE 0 END), 0)
        / NULLIF(SUM(CASE WHEN base.classification = 'primary' THEN base.total_amount ELSE 0 END), 0), 1)$$,
   'percent', '[]'::jsonb)
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label,
      sql_select = EXCLUDED.sql_select,
      type = EXCLUDED.type,
      required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
  ('order', 'channel', 'Channel',
   'base.classification = ($2::jsonb->>''channel'')', '[]'::jsonb),
  ('order', 'parent_customer', 'Supplied By',
   'base.parent_contact_id = ($2::jsonb->>''parent_customer'')::uuid', '[]'::jsonb),
  ('ageing', 'parent_customer', 'Supplied By',
   'base.parent_id = ($2::jsonb->>''parent_customer'')::uuid', '[]'::jsonb)
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label,
      sql_where = EXCLUDED.sql_where,
      required_joins = EXCLUDED.required_joins;
