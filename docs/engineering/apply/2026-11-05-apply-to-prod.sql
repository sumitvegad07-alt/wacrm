-- ============================================================
-- APPLY TO PRODUCTION (Mumbai) — 2026-11-05
--
-- Two migrations, in this order, in ONE transaction. Generated from:
--   supabase/migrations/20261105120000_many_channel_holders_per_area.sql
--   supabase/migrations/20261105130000_route_rights_simplified_and_field_rules.sql
--
-- Verified against a throwaway PostgreSQL 17.6 with all 292 migrations
-- applied: 119/119 scenarios pass (scripts/run-db-tests.sh).
--
-- Safe to re-run: every object is CREATE OR REPLACE / IF NOT EXISTS, and the
-- two backfills skip rows that already hold what they would add.
-- ============================================================

BEGIN;

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


-- ============================================================
-- Route rights: 20 tickboxes become 9. Plus two new field rules.
--
-- WHY. The founder opened Roles → Route Management and found twenty
-- checkboxes across four sub-headings: "currently it is too much confusing...
-- we have rights for route and customers in those routes which creates
-- confusion to me also IDK about my clients how will they feel".
--
-- He is right. Nobody grants "Reorder customers" but withholds "Remove
-- customers" — they are the same job (editing a route), split into separate
-- switches because the Route SDK enumerated every RPC rather than every
-- decision an admin actually makes.
--
-- THE SHAPE. Nine rights, each one a decision somebody really takes:
--
--   view_routes               See routes, health and executions
--   add_routes                Create a route (cloning is creating one)
--   edit_routes               Change a route: its customers, their order,
--                             its schedule
--   delete_routes             Delete or archive a route
--   approve_routes            Assign routes to staff and approve/reject them
--   execute_route             Run a route: start, check in, complete
--   modify_route_sequence     Skip a stop or visit out of the planned order
--   restrict_off_route_visits Block visits to customers not on today's route
--   optimize_routes           Use the nearest-customer suggestion (new)
--
-- HOW THE RETIRED KEYS KEEP WORKING. Migrations 110 and 111 check the granular
-- keys inside the RPCs (`_route_assert_editable(..., 'add_route_customers')`
-- and friends). Rewriting eleven RPCs to rename a string is pure risk for no
-- gain, so instead has_permission learns a route alias map: asked for a retired
-- key, it also accepts the surviving one. The RPCs are not touched at all, and
-- a tenant who still has an old key ticked keeps working either way.
--
-- AND THE ROLES THAT ALREADY EXIST. A role holding 'reorder_route_customers'
-- but not 'edit_routes' would silently lose the ability the moment the UI stops
-- offering the old key. §3 backfills every such role first: any retired key set
-- true grants its survivor. Nobody loses anything on deploy day.
--
-- TWO NEW FIELD RULES (founder item 3). Check-out selfie and visit feedback
-- become rights, next to the punch-in selfie rule that is already one, and both
-- are ON by default — §4 backfills them onto every existing role, and the roles
-- editor ticks them for new roles. Admin can untick either.
--
-- Blast radius: one function replaced, two UPDATEs over employee_roles. No
-- table, policy or RPC is altered.
-- ============================================================



-- ── 1. The alias map ─────────────────────────────────────────
-- Retired key -> the right that now covers it. Kept as a function rather than a
-- table so it ships and rolls back with the code that depends on it, and so
-- has_permission stays a single inlinable SQL expression.
CREATE OR REPLACE FUNCTION public.route_permission_alias(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_key
    -- Editing a route IS managing the customers on it and when it runs.
    WHEN 'manage_route_customers'  THEN 'edit_routes'
    WHEN 'add_route_customers'     THEN 'edit_routes'
    WHEN 'remove_route_customers'  THEN 'edit_routes'
    WHEN 'reorder_route_customers' THEN 'edit_routes'
    WHEN 'manage_route_schedule'   THEN 'edit_routes'
    -- A clone is a new route; an archive is a soft delete.
    WHEN 'clone_routes'            THEN 'add_routes'
    WHEN 'archive_routes'          THEN 'delete_routes'
    -- Seeing the approvals queue is part of approving; assigning in the
    -- planner is the same manager decision.
    WHEN 'view_route_approvals'    THEN 'approve_routes'
    WHEN 'assign_routes'           THEN 'approve_routes'
    -- Health and executions are read-only views of routes you can already see.
    WHEN 'view_route_health'       THEN 'view_routes'
    WHEN 'view_route_executions'   THEN 'view_routes'
    -- Skipping a stop and visiting out of order are the same freedom.
    WHEN 'skip_route_stop'         THEN 'modify_route_sequence'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.route_permission_alias(text) IS
  'Retired granular route permission -> the simplified right that now covers it, or NULL if the '
  'key was never a route key. Lets migrations 110/111 keep checking their original key strings '
  'while the Roles editor offers nine rights instead of twenty.';

-- ── 2. has_permission honours it ─────────────────────────────
-- Rebuilt from 20260823140000. Everything there is unchanged; one OR branch is
-- added at the end. Order matters only for readability — it is an OR chain.
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_account_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.employee_roles er ON er.id = p.employee_role_id
    WHERE p.user_id = p_user_id
      AND p.account_id = p_account_id
      AND coalesce(p.status, 'active') = 'active'
      AND (
        p.account_role IN ('owner','admin')
        OR p.is_superadmin = true
        OR (er.permissions ->> 'all') = 'true'
        OR (er.permissions ->> p_key) = 'true'
        OR (er.permissions ->> (split_part(p_key, '_', 1) || '_*')) = 'true'
        OR (er.permissions ->> (
              CASE WHEN left(p_key, 7) = 'create_' THEN 'add_' || substr(p_key, 8)
                   WHEN left(p_key, 4) = 'add_'    THEN 'create_' || substr(p_key, 5) END
           )) = 'true'
        -- NEW: a retired route key is satisfied by the right that replaced it.
        OR (er.permissions ->> public.route_permission_alias(p_key)) = 'true'
      )
  );
$$;

-- ── 3. Nobody loses a right on deploy day ────────────────────
-- Any role that held a retired key now holds its survivor.
--
-- ONE ROW PER ROLE, not one per (role, survivor). The first draft grouped by
-- both and let `UPDATE ... FROM` match several source rows to the same role —
-- and in PostgreSQL, when the FROM side produces more than one row for a
-- target row, only ONE of them is applied and which one is not defined. A
-- supervisor holding both 'reorder_route_customers' and 'archive_routes' came
-- out with 'delete_routes' and no 'edit_routes': a right silently lost on
-- deploy day, which is the exact failure this backfill exists to prevent.
-- Scenario G12 caught it.
--
-- jsonb_object_agg collapses every survivor a role needs into a single object,
-- so the merge below is one well-defined rewrite per role.
--
-- `permissions` on an all-access role is {"all": true} and is left alone — the
-- || would add noise that the editor would then render as ticked boxes under a
-- heading that says "All".
UPDATE public.employee_roles er
   SET permissions = er.permissions || need.additions
  FROM (
    SELECT r.id AS role_id,
           jsonb_object_agg(public.route_permission_alias(k.key), true) AS additions
      FROM public.employee_roles r, jsonb_each_text(r.permissions) AS k(key, val)
     WHERE k.val = 'true'
       AND public.route_permission_alias(k.key) IS NOT NULL
       AND coalesce((r.permissions ->> 'all')::boolean, false) = false
     GROUP BY r.id
  ) AS need
 WHERE er.id = need.role_id
   -- Skip roles that already hold everything they would gain, so the table is
   -- not rewritten for nothing on a re-run.
   AND NOT (er.permissions @> need.additions);

-- ── 4. The two new field rules, ON by default ────────────────
-- The founder: "(A) Check-out selfie Compulsory or not? (B) Visit feedback
-- compulsory or not? by default they both should keep on."
--
-- These are require-style keys, like punch_selfie_required and unlike
-- order_without_checkin: ticked MEANS required. A brand-new role starts as {},
-- which would read as "not required", so every existing role is set explicitly
-- here and the roles editor pre-ticks them for new ones.
--
-- All-access roles are skipped for the same reason as §3 — `all` already
-- resolves true for every key, including these.
UPDATE public.employee_roles
   SET permissions = permissions
                  || jsonb_build_object('visit_checkout_selfie_required', true)
                  || jsonb_build_object('visit_feedback_required', true)
 WHERE coalesce((permissions ->> 'all')::boolean, false) = false
   AND (
         (permissions ->> 'visit_checkout_selfie_required') IS DISTINCT FROM 'true'
      OR (permissions ->> 'visit_feedback_required')        IS DISTINCT FROM 'true'
       );



COMMIT;
