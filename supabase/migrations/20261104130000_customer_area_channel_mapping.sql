-- ============================================================
-- Secondary Sales — mapping the channel BY AREA.
--
-- Spec: docs/engineering/specifications/secondary-sales-v1.md
--
-- WHY THIS EXISTS, WHEN 20261103160000 SHIPPED YESTERDAY. That migration maps
-- a customer's supplier from their BEAT. Asked how the levels above the bottom
-- one should get their parent, the founder answered that in his model the thing
-- assigned to both the salesman and the customer IS the area:
--
--   "in our system beat/route is not a different — Area/territory is Beat/route
--    simple. For example 150 feet ring road is area assigned to salesman and
--    same assigned to customer."
--
-- Checked in the database, the code and the screens. He is right about the
-- layer he is describing and it already exists: territories +
-- employee_area_assignments + contacts.territory_id. He is not right that a
-- beat is the same record — the Route wizard builds a beat "from a salesman's
-- territory customers" and skips anyone "outside territory", so a beat is a
-- subset of an area with a visit order and a weekday attached. One area holds
-- many beats; a customer can have an area and no beat at all.
--
-- So the two are NOT merged. What is wrong is that yesterday's mapping hangs
-- off the beat while the channel model is geographic. This migration adds the
-- geographic mapping. Beat mode keeps working untouched so no tenant breaks.
--
-- WHAT THE NEW TABLE SAYS. One row per area per level: "in 150 Feet Ring Road,
-- the Distributor is C". Keyed by the level the PARENT holds, not the child's,
-- because that is how the founder states it and it makes one row per level per
-- area. A customer's parent is then whoever holds the level directly above
-- them, in their area. Dealer -> Distributor -> Stockist -> Super Stockist,
-- which is his "hierarchy should follow the channel".
--
-- THE LOOKUP WALKS UP ONLY, AND THAT IS DELIBERATE. Area is not mandatory
-- (24dbf73), so a customer may be tagged only to a City; walking up lets the
-- chain be set once at City level and inherited by every area under it, which
-- is the main path for most tenants rather than a convenience.
--
-- It does NOT then look down, unlike employee_covered_territory_ids and
-- src/lib/territories/coverage.ts, which look up and then down. A customer
-- tagged to a City whose three child areas each have a different Distributor
-- has NO correct supplier, and guessing one would put real money under the
-- wrong distributor in a channel report. "Who covers this customer" tolerates a
-- best guess; "who supplies this customer" does not. Such a customer stays
-- unmapped and is counted on the Mapping screen until somebody answers it.
--
-- THE 076 TRAP, THIRD TIME. trg_enforce_contact_hierarchy_level refuses any
-- update to a level-less customer on an account with hierarchy on. The fan-out
-- below writes contacts.parent_id for many rows at once, so it sets the
-- ozzo.system_write marker from 20261103140000. Without it a single level-less
-- customer would take down the admin's whole save.
--
-- TRIGGER ORDER MATTERS. Among BEFORE triggers Postgres fires in name order, so
-- trg_area_parent_sync ("a") must and does sort before
-- trg_enforce_customer_parent ("e") — the value this one computes is then
-- validated by that one on INSERT.
--
-- Blast radius: one new table, one nullable-defaulted boolean on contacts, and
-- triggers that return immediately unless the account has chosen 'area'.
-- ============================================================

-- ── 1. A hand-set parent that area resync must not overwrite ─
-- The area model says one area has one holder per level. The real case it
-- cannot express is one area that genuinely holds two Distributors. This is the
-- escape hatch, and it mirrors buying_status_locked (20261103140000) — a
-- pattern already in the product rather than a new idea.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS parent_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contacts.parent_locked IS
  'True when a human set parent_id by hand and area mapping must leave it alone. Always false '
  'while mapping is off or manual (where a human owns the column anyway). Same shape as '
  'buying_status_locked: a derived value that somebody has deliberately overridden.';

-- ── 2. Who holds which level in which area ───────────────────
CREATE TABLE IF NOT EXISTS public.customer_channel_parents (
  account_id        uuid NOT NULL REFERENCES public.accounts(id)    ON DELETE CASCADE,
  territory_id      uuid NOT NULL REFERENCES public.territories(id) ON DELETE CASCADE,
  hierarchy_level   int  NOT NULL CHECK (hierarchy_level >= 1),
  parent_contact_id uuid NOT NULL REFERENCES public.contacts(id)    ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (territory_id, hierarchy_level)
);

CREATE INDEX IF NOT EXISTS ccp_account_level_idx
  ON public.customer_channel_parents (account_id, hierarchy_level);
CREATE INDEX IF NOT EXISTS ccp_account_parent_idx
  ON public.customer_channel_parents (account_id, parent_contact_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.customer_channel_parents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customer_channel_parents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.customer_channel_parents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_channel_parents_select ON public.customer_channel_parents;
CREATE POLICY customer_channel_parents_select ON public.customer_channel_parents
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS customer_channel_parents_write ON public.customer_channel_parents;
CREATE POLICY customer_channel_parents_write ON public.customer_channel_parents
  FOR ALL USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

COMMENT ON TABLE public.customer_channel_parents IS
  'Who supplies a given level in a given area: "in 150 Feet Ring Road the Distributor is C". '
  'hierarchy_level is the level the PARENT holds, not the child''s. A customer at level L takes '
  'the row at level L-1 found by walking UP from their own territory. One row per level per area.';

-- A row must be internally consistent, or the chain it builds is nonsense.
CREATE OR REPLACE FUNCTION public.enforce_channel_parent_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parent public.contacts;
  v_terr   public.territories;
BEGIN
  SELECT * INTO v_terr FROM public.territories WHERE id = NEW.territory_id;
  IF v_terr.id IS NULL OR v_terr.account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'That area does not belong to this account.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_parent FROM public.contacts WHERE id = NEW.parent_contact_id;
  IF v_parent.id IS NULL OR v_parent.account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'That supplier is not a customer of this account.' USING ERRCODE = '23514';
  END IF;

  -- You cannot hold a level you do not have. Rejecting a level-less customer
  -- here is deliberate: the whole point of the four-step flow is that levels
  -- are filled in BEFORE the chain is drawn, and a silent NULL here would make
  -- every customer under this area resolve to a supplier at the wrong level.
  IF v_parent.hierarchy_level IS NULL THEN
    RAISE EXCEPTION
      'Set a Customer Level on % before making them a supplier for an area.',
      coalesce(v_parent.company, v_parent.name, 'that customer')
      USING ERRCODE = '23514';
  END IF;

  IF v_parent.hierarchy_level <> NEW.hierarchy_level THEN
    RAISE EXCEPTION
      '% is at level %, so they cannot hold level % in an area.',
      coalesce(v_parent.company, v_parent.name, 'That customer'),
      v_parent.hierarchy_level, NEW.hierarchy_level
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_channel_parent_row ON public.customer_channel_parents;
CREATE TRIGGER trg_enforce_channel_parent_row
  BEFORE INSERT OR UPDATE ON public.customer_channel_parents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_channel_parent_row();

-- ── 3. 'area' becomes a mapping mode ─────────────────────────
-- Rebuilt from 20261103160000 with one value added. 'beat' stays accepted so
-- any tenant already on it keeps working; it is simply no longer offered in the
-- UI. Anything unrecognised still reads as off.
CREATE OR REPLACE FUNCTION public.customer_mapping_mode(p_account_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
           WHEN settings -> 'extra_settings' ->> 'customer_mapping_mode' IN ('manual', 'beat', 'area')
             THEN settings -> 'extra_settings' ->> 'customer_mapping_mode'
           ELSE 'off'
         END
    FROM public.accounts WHERE id = p_account_id;
$$;

REVOKE ALL ON FUNCTION public.customer_mapping_mode(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.customer_mapping_mode(uuid) TO authenticated;

COMMENT ON FUNCTION public.customer_mapping_mode(uuid) IS
  'off | manual | beat | area. Anything unrecognised, missing or null reads as off, so a tenant '
  'who has never configured mapping is never affected. beat is legacy: still honoured, no longer '
  'offered on the Secondary Sales screen.';

-- ── 4. Resolving one customer's supplier from their area ─────
-- Takes the values explicitly rather than reading the row, so a BEFORE trigger
-- can call it with NEW.* before anything is written.
CREATE OR REPLACE FUNCTION public.resolve_channel_parent(
  p_account_id   uuid,
  p_territory_id uuid,
  p_level        int,
  p_child_id     uuid
)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cur   uuid := p_territory_id;
  v_depth int  := 0;
  v_found uuid;
  v_up    uuid;
  v_updep int  := 0;
BEGIN
  -- Level 1 is the top of the chain and has no supplier. No level means the
  -- question cannot be answered yet; no area means there is nothing to look in.
  IF p_account_id IS NULL OR p_level IS NULL OR p_level <= 1 OR p_territory_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Up the territory tree, nearest answer wins. MAX_DEPTH 8 matches
  -- src/lib/territories/coverage.ts; the deepest hierarchy OZZO offers is 5.
  WHILE v_cur IS NOT NULL AND v_depth < 8 LOOP
    SELECT parent_contact_id INTO v_found
      FROM public.customer_channel_parents
     WHERE territory_id = v_cur
       AND hierarchy_level = p_level - 1;

    IF v_found IS NOT NULL THEN
      -- Found but illegal (themselves, a loop) leaves them UNMAPPED rather
      -- than carrying on up. The nearest area is the intended answer; falling
      -- back to the city's would quietly supply them through somebody else.
      --
      -- Checked INLINE rather than through is_legal_customer_parent, because
      -- this runs in a BEFORE INSERT trigger where the child row does not exist
      -- in `contacts` yet. That function reads the child row, finds nothing and
      -- returns false, so every newly created customer came out unmapped until
      -- a later edit happened to re-resolve them — which is exactly what the
      -- E16 scenario caught.
      --
      -- The level rule needs no check here at all: enforce_channel_parent_row
      -- has already guaranteed the holder's own hierarchy_level equals
      -- p_level - 1, so a parent above the child is true by construction.
      IF v_found = p_child_id THEN
        RETURN NULL;                     -- nobody supplies themselves
      END IF;

      -- No loops: walking the holder's own supply chain must never arrive back
      -- at this customer. Only the parent's ancestors are read, all of which
      -- are rows that already exist, so this is safe before INSERT.
      v_up := v_found;
      WHILE v_up IS NOT NULL AND v_updep < 10000 LOOP
        SELECT parent_id INTO v_up FROM public.contacts WHERE id = v_up;
        IF v_up = p_child_id THEN
          RETURN NULL;
        END IF;
        v_updep := v_updep + 1;
      END LOOP;

      RETURN v_found;
    END IF;

    SELECT parent_id INTO v_cur FROM public.territories WHERE id = v_cur;
    v_depth := v_depth + 1;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_channel_parent(uuid, uuid, int, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_channel_parent(uuid, uuid, int, uuid) TO authenticated;

-- ── 4b. A NEW customer may be created WITH a supplier ────────
-- Found by the E16 scenario. enforce_customer_parent (20261103160000) ends with
--
--     IF NOT is_legal_customer_parent(NEW.id, NEW.parent_id) THEN ... loop
--
-- and is_legal_customer_parent starts by reading the CHILD row out of
-- `contacts`. In a BEFORE INSERT trigger that row does not exist yet, so the
-- lookup finds nothing, the function returns false, and the insert is refused
-- with "Supply loop: X would end up being supplied through themselves."
--
-- So in manual mapping mode, saving a brand-new customer with "Supplied By"
-- filled in has never worked — the customer form writes parent_id on INSERT
-- (contact-form.tsx), and every such save was rejected with an error about a
-- loop that cannot exist. Nothing pointed at the new row yet, because there was
-- no row.
--
-- Rebuilt here with the loop test done by walking the PARENT's chain looking
-- for NEW.id. That needs only rows that already exist, so it is correct on
-- INSERT and UPDATE alike. The account and level guards above it are unchanged
-- and already use NEW directly.
--
-- is_legal_customer_parent itself is left alone: returning false for a child
-- that does not exist is the right answer for a validator. The rule is that it
-- must not be called before the row is there.
CREATE OR REPLACE FUNCTION public.enforce_customer_parent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parent public.contacts;
  v_up     uuid;
  v_depth  int := 0;
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

  v_up := v_parent.parent_id;
  WHILE v_up IS NOT NULL AND v_depth < 10000 LOOP
    IF v_up = NEW.id THEN
      RAISE EXCEPTION
        'Supply loop: % would end up being supplied through themselves.',
        coalesce(NEW.company, NEW.name, 'this customer')
        USING ERRCODE = '23514';
    END IF;
    SELECT parent_id INTO v_up FROM public.contacts WHERE id = v_up;
    v_depth := v_depth + 1;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── 5. Area mode: the trigger that owns parent_id ────────────
-- BEFORE, not AFTER: it sets the value in the row being written instead of
-- issuing a second UPDATE, which keeps it out of the 076 enforcement path
-- entirely and costs nothing. Fires on territory_id, hierarchy_level and
-- parent_locked — never on parent_id, so it cannot re-trigger itself.
CREATE OR REPLACE FUNCTION public.contacts_area_parent_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF customer_mapping_mode(NEW.account_id) <> 'area' THEN
    RETURN NEW;                          -- manual mode: a human owns this column
  END IF;
  IF NEW.parent_locked THEN
    RETURN NEW;                          -- deliberately overridden, leave it
  END IF;

  NEW.parent_id := resolve_channel_parent(
    NEW.account_id, NEW.territory_id, NEW.hierarchy_level, NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_area_parent_sync ON public.contacts;
CREATE TRIGGER trg_area_parent_sync
  BEFORE INSERT OR UPDATE OF territory_id, hierarchy_level, parent_locked
  ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_area_parent_sync();

-- ── 6. A channel row changing re-parents everyone under it ───
-- Only the level directly below the row's own, and only inside that area's
-- subtree. A descendant area with its own row at the same level still wins,
-- because resolve_channel_parent takes the nearest answer.
CREATE OR REPLACE FUNCTION public.channel_parents_fanout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acct  uuid := COALESCE(NEW.account_id, OLD.account_id);
  v_terr  uuid := COALESCE(NEW.territory_id, OLD.territory_id);
  v_level int  := COALESCE(NEW.hierarchy_level, OLD.hierarchy_level);
BEGIN
  IF customer_mapping_mode(v_acct) <> 'area' THEN
    RETURN NULL;
  END IF;

  -- The 076 marker: one level-less customer caught by this UPDATE would
  -- otherwise reject the admin's entire save.
  PERFORM set_config('ozzo.system_write', 'on', true);

  WITH RECURSIVE sub AS (
    SELECT id FROM public.territories WHERE id = v_terr
    UNION ALL
    SELECT t.id FROM public.territories t JOIN sub ON t.parent_id = sub.id
  )
  UPDATE public.contacts c
     SET parent_id = resolve_channel_parent(c.account_id, c.territory_id, c.hierarchy_level, c.id)
   WHERE c.account_id = v_acct
     AND c.parent_locked = false
     AND c.hierarchy_level = v_level + 1
     AND c.territory_id IN (SELECT id FROM sub);

  PERFORM set_config('ozzo.system_write', '', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_channel_parents_fanout ON public.customer_channel_parents;
CREATE TRIGGER trg_channel_parents_fanout
  AFTER INSERT OR DELETE OR UPDATE OF parent_contact_id, hierarchy_level, territory_id
  ON public.customer_channel_parents
  FOR EACH ROW EXECUTE FUNCTION public.channel_parents_fanout();

-- ── 7. Re-map a whole account ────────────────────────────────
-- Used when the admin switches TO area mode, and by the settings screen to say
-- how many parents would change before anything is written. Mirrors
-- resync_account_beat_parents (20261103160000).
CREATE OR REPLACE FUNCTION public.resync_account_area_parents(
  p_account_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed bigint := 0;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'Only an admin may re-map customers' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_changed
    FROM public.contacts c
   WHERE c.account_id = p_account_id
     AND c.parent_locked = false
     AND c.parent_id IS DISTINCT FROM
         resolve_channel_parent(c.account_id, c.territory_id, c.hierarchy_level, c.id);

  IF p_dry_run THEN
    RETURN jsonb_build_object('would_change', v_changed, 'changed', 0, 'dry_run', true);
  END IF;

  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE public.contacts c
     SET parent_id = resolve_channel_parent(c.account_id, c.territory_id, c.hierarchy_level, c.id)
   WHERE c.account_id = p_account_id
     AND c.parent_locked = false
     AND c.parent_id IS DISTINCT FROM
         resolve_channel_parent(c.account_id, c.territory_id, c.hierarchy_level, c.id);
  PERFORM set_config('ozzo.system_write', '', true);

  RETURN jsonb_build_object('would_change', v_changed, 'changed', v_changed, 'dry_run', false);
END;
$$;

REVOKE ALL ON FUNCTION public.resync_account_area_parents(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.resync_account_area_parents(uuid, boolean) TO authenticated;

-- ── 8. Is this actually set up? ──────────────────────────────
-- Secondary sales is not working just because the switch is on: a customer with
-- no level classifies as 'direct' and a customer with no parent has no channel.
-- Both screens show these two numbers instead of letting a tenant believe it is
-- configured while every order reports as Direct.
CREATE OR REPLACE FUNCTION public.secondary_sales_setup_status(p_account_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',      count(*),
    'no_level',   count(*) FILTER (WHERE hierarchy_level IS NULL),
    'no_parent',  count(*) FILTER (WHERE parent_id IS NULL AND COALESCE(hierarchy_level, 1) > 1),
    'no_area',    count(*) FILTER (WHERE territory_id IS NULL),
    'locked',     count(*) FILTER (WHERE parent_locked)
  )
    FROM public.contacts
   WHERE account_id = p_account_id
     AND COALESCE(is_active, true);
$$;

REVOKE ALL ON FUNCTION public.secondary_sales_setup_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.secondary_sales_setup_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.secondary_sales_setup_status(uuid) IS
  'Counts that say whether secondary sales is really configured: customers with no level (their '
  'orders classify as Direct), with no supplier above level 1, with no area (so area mapping '
  'cannot reach them), and hand-locked. SECURITY INVOKER so a rep sees only their own scope.';
