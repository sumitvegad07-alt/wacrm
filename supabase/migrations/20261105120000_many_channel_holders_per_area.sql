-- ============================================================
-- Secondary Sales — an area may hold MANY holders at a level.
--
-- Spec: docs/engineering/specifications/secondary-sales-v1.md
--
-- WHAT WAS WRONG. 20261104130000 keyed customer_channel_parents on
-- (territory_id, hierarchy_level), i.e. ONE Distributor per area, one Stockist
-- per area. The founder tested it and said plainly what any FMCG company
-- knows: "you can not have only 1 stockiest in one area, you can not have only
-- 1 distributor in one area."
--
-- He is right, and the constraint was never a claim about how many
-- distributors exist. It was about making the mapping ANSWERABLE. Area mapping
-- has to fill in "who supplies this dealer?" without anybody typing. With one
-- holder that answer is certain. With three it is not, and a wrong guess puts
-- real money under the wrong distributor in every secondary-sales report. So
-- the old migration chose "allow one, override the rare second by hand" rather
-- than "guess".
--
-- WHAT THIS CHANGES. The right fix is neither to guess nor to forbid:
--
--   * An area may hold ANY number of holders at ANY level.
--   * Exactly one holder at the level above  -> filled in automatically, as now.
--   * Two or more                            -> the customer stays UNMAPPED and
--                                               is counted as "needs a choice".
--                                               An admin picks from just those
--                                               holders on the Mapping screen.
--
-- The automatic path is therefore unchanged for every tenant who really does
-- have one distributor per area, and the ambiguous case becomes a short,
-- honest question instead of a silent wrong answer.
--
-- AMBIGUITY DOES NOT FALL BACK UP THE TREE. If the nearest area holds three
-- Distributors the resolver returns NULL and STOPS. It does not then try the
-- City, because the City's answer is not more correct than the three in front
-- of it — only further away. Same reasoning as the walk-up-never-down rule in
-- 20261104130000.
--
-- PICKING IS LOCKING. There is no new column for "the admin chose this one".
-- contacts.parent_locked already means "a human set this, resync must not
-- overwrite it", which is exactly what choosing one of three distributors is.
--
-- Blast radius: one primary key widened, two functions replaced, one added. No
-- data is deleted — every existing row stays legal under the wider key.
-- ============================================================

-- ── 1. Many holders per level per area ───────────────────────
-- The old key allowed one row per (area, level). Widening it to include the
-- holder lets an area list three Distributors while still refusing to list the
-- same Distributor there twice.
ALTER TABLE public.customer_channel_parents
  DROP CONSTRAINT IF EXISTS customer_channel_parents_pkey;

ALTER TABLE public.customer_channel_parents
  ADD CONSTRAINT customer_channel_parents_pkey
  PRIMARY KEY (territory_id, hierarchy_level, parent_contact_id);

-- The resolver reads by (area, level) and counts; the old PK used to serve
-- that lookup and no longer leads with both columns alone.
CREATE INDEX IF NOT EXISTS ccp_territory_level_idx
  ON public.customer_channel_parents (territory_id, hierarchy_level);

COMMENT ON TABLE public.customer_channel_parents IS
  'Who supplies a given level in a given area: "in 150 Feet Ring Road the Distributors are C and '
  'D". hierarchy_level is the level the HOLDER occupies, not the child''s. A customer at level L '
  'looks for rows at level L-1, walking up from their own area. One holder -> mapped '
  'automatically. Several -> the customer needs a human choice and stays unmapped until then.';

-- ── 2. Resolve: one answer, or no answer ─────────────────────
-- Replaces 20261104130000 §4. The walk, the depth cap, the self-check and the
-- loop-check are unchanged; what is new is that the nearest area is now asked
-- HOW MANY holders it has, and two or more means "no automatic answer".
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
  v_count int;
  v_found uuid;
  v_up    uuid;
  v_updep int  := 0;
BEGIN
  -- Level 1 is the top of the chain and has no supplier. No level means the
  -- question cannot be answered yet; no area means there is nothing to look in.
  IF p_account_id IS NULL OR p_level IS NULL OR p_level <= 1 OR p_territory_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Up the territory tree; the nearest area that holds the level at all wins.
  -- MAX_DEPTH 8 matches src/lib/territories/coverage.ts; OZZO's deepest
  -- hierarchy is 5.
  WHILE v_cur IS NOT NULL AND v_depth < 8 LOOP
    -- array_agg, not min(): PostgreSQL has no min() for uuid, and the first
    -- draft of this used one. It reached the test harness and died there with
    -- "function min(uuid) does not exist" — one scan, both answers, and the
    -- element is only read when the count says there is exactly one.
    SELECT count(*), (array_agg(parent_contact_id))[1]
      INTO v_count, v_found
      FROM public.customer_channel_parents
     WHERE territory_id = v_cur
       AND hierarchy_level = p_level - 1;

    -- Two or more holders here: there is no single correct supplier, and
    -- guessing would put this customer's orders under the wrong company. Stop
    -- — do NOT carry on up to the City, whose answer is merely further away,
    -- not more correct. The customer is reported as needing a choice instead.
    IF v_count > 1 THEN
      RETURN NULL;
    END IF;

    IF v_count = 1 THEN
      -- Found but illegal (themselves, a loop) also leaves them unmapped
      -- rather than falling back to an ancestor area's holder.
      IF v_found = p_child_id THEN
        RETURN NULL;                     -- nobody supplies themselves
      END IF;

      -- No loops: walking the holder's own supply chain must never arrive back
      -- at this customer. Only the holder's ancestors are read, all of which
      -- already exist, so this is safe inside a BEFORE INSERT trigger — which
      -- is the whole reason it is inline instead of is_legal_customer_parent.
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

COMMENT ON FUNCTION public.resolve_channel_parent(uuid, uuid, int, uuid) IS
  'The supplier area mapping would assign, or NULL. NULL means one of: top of the chain, no '
  'level, no area, nobody holds the level above anywhere up the tree, SEVERAL holders do (ask a '
  'human), or the only candidate is the customer themselves / would close a supply loop.';

-- ── 3. Who COULD supply this customer ────────────────────────
-- The short list the Mapping screen offers when there is more than one holder.
-- Same walk as the resolver, so the list is exactly the set the resolver
-- refused to choose between — never a wider "everybody at that level".
CREATE OR REPLACE FUNCTION public.channel_parent_candidates(
  p_account_id   uuid,
  p_territory_id uuid,
  p_level        int
)
RETURNS TABLE (contact_id uuid, holder_territory_id uuid)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_cur   uuid := p_territory_id;
  v_depth int  := 0;
  v_hits  int;
BEGIN
  IF p_account_id IS NULL OR p_level IS NULL OR p_level <= 1 OR p_territory_id IS NULL THEN
    RETURN;
  END IF;

  WHILE v_cur IS NOT NULL AND v_depth < 8 LOOP
    SELECT count(*) INTO v_hits
      FROM public.customer_channel_parents c
     WHERE c.territory_id = v_cur AND c.hierarchy_level = p_level - 1;

    IF v_hits > 0 THEN
      RETURN QUERY
        SELECT c.parent_contact_id, c.territory_id
          FROM public.customer_channel_parents c
         WHERE c.territory_id = v_cur AND c.hierarchy_level = p_level - 1;
      RETURN;
    END IF;

    SELECT t.parent_id INTO v_cur FROM public.territories t WHERE t.id = v_cur;
    v_depth := v_depth + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.channel_parent_candidates(uuid, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.channel_parent_candidates(uuid, uuid, int) TO authenticated;

COMMENT ON FUNCTION public.channel_parent_candidates(uuid, uuid, int) IS
  'The holders of level L-1 in the nearest area up the tree that has any — exactly the set '
  'resolve_channel_parent would pick from. SECURITY INVOKER so a rep sees only their own scope.';

-- ── 4. "Needs a choice" is its own number ────────────────────
-- Rebuilt from 20261104130000 §8 with one count added. Without it a customer
-- in a three-distributor area is indistinguishable on the settings card from a
-- customer nobody has mapped at all, and the admin has no idea a question is
-- waiting for them.
CREATE OR REPLACE FUNCTION public.secondary_sales_setup_status(p_account_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',        count(*),
    'no_level',     count(*) FILTER (WHERE hierarchy_level IS NULL),
    'no_parent',    count(*) FILTER (WHERE parent_id IS NULL AND COALESCE(hierarchy_level, 1) > 1),
    'no_area',      count(*) FILTER (WHERE territory_id IS NULL),
    'locked',       count(*) FILTER (WHERE parent_locked),
    -- Unmapped AND the system can see more than one candidate for them. A
    -- deliberate subset of no_parent, so the screen can say "9 unmapped, 4 of
    -- them waiting on you to choose".
    --
    -- The candidate walk is wrapped in a CASE rather than left as a third AND
    -- term. SQL does not promise left-to-right evaluation, so a planner that
    -- chose to test the sub-query first would run a territory walk for every
    -- customer on the account — including the mapped majority, for whom the
    -- answer cannot matter. CASE forces the cheap tests to decide first. This
    -- function is read on the Customers list on every visit, so that is the
    -- difference between an aggregate over the unmapped few and one over all
    -- of them.
    'needs_choice', count(*) FILTER (
                      WHERE CASE
                              WHEN parent_id IS NOT NULL THEN false
                              WHEN COALESCE(hierarchy_level, 1) <= 1 THEN false
                              WHEN territory_id IS NULL THEN false
                              ELSE (SELECT count(*) FROM public.channel_parent_candidates(
                                      account_id, territory_id, hierarchy_level)) > 1
                            END)
  )
    FROM public.contacts
   WHERE account_id = p_account_id
     AND COALESCE(is_active, true);
$$;

REVOKE ALL ON FUNCTION public.secondary_sales_setup_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.secondary_sales_setup_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.secondary_sales_setup_status(uuid) IS
  'Counts that say whether secondary sales is really configured: customers with no level (their '
  'orders classify as Direct), no supplier above level 1, no area, hand-locked, and needs_choice '
  '— unmapped only because their area holds several possible suppliers.';
