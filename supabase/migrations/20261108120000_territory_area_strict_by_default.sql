-- ============================================================
-- An assigned Area means that Area. Upward coverage becomes a setting, OFF.
--
-- Founder, 2026-11-08, testing on the iPhone and on Android:
--
--   "if i assign one area which has 4 customers which clearly means mobile user
--    must see only 4 customers but currently for android and IOS both can see
--    many other area's customers as well"
--
-- He is describing the exact consequence that 20261103120000 wrote down about
-- itself, five days earlier:
--
--   "ONE CONSEQUENCE, STATED PLAINLY: a customer recorded no deeper than
--    Country becomes visible to every rep in the country, and one recorded at
--    State level to every rep in that state."
--
-- That migration made `employee_covered_territory_ids` walk UPWARD as well as
-- downward, so a rep assigned "University Road" also covers Rajkot, Gujarat and
-- India. It was built to satisfy his 2026-11-03 request that the Area not be
-- mandatory on a customer: 1,131 of 1,165 customers in this database carry no
-- territory at all, and most of the rest are tagged no finer than a City, so
-- without the upward walk a rep saw almost nothing.
--
-- THE TWO REQUESTS CANNOT BOTH BE TRUE AT ONCE, and this is the honest shape of
-- the trade-off:
--
--   * upward ON  -> a customer tagged only "Rajkot" is visible to every rep with
--                   any area inside Rajkot. Nobody has to re-tag anything.
--   * upward OFF -> an assigned Area means that Area and its sub-areas, full
--                   stop. A customer tagged only to a City becomes invisible to
--                   a rep who does not own them, until an admin tags the
--                   customer down to Area level.
--
-- So it becomes a per-account setting rather than a rule baked into a function,
-- and the DEFAULT IS OFF because off is what he asked for on 2026-11-08:
--
--     accounts.settings -> 'territory_settings' ->> 'area_covers_parents'
--
-- Nothing else about coverage changes. Sibling areas stay invisible, as they
-- always have. The strict `employee_area_territory_ids` still drives the CREATE
-- guards (contacts_insert_area_scope, the mobile territory picker) and is not
-- touched here.
--
-- ---- THE FIVE QUESTIONS (docs/engineering/WORKING-AGREEMENT.md) ----
--
-- 1. A SECOND FOREIGN KEY between two tables?  No. No table is altered: this
--    replaces one function and adds one, so there is no new relationship for
--    PostgREST to find ambiguous.
--
-- 2. Does a touched column appear in a `.select()` string anywhere?  No column
--    is added, renamed or removed. `accounts.settings` already exists and is
--    already selected in both repos; this only reads a new KEY inside that
--    JSONB, which PostgREST neither knows nor cares about.
--
-- 3. New trigger / policy / constraint on a written table?  No trigger, no
--    constraint, and no policy text changes. `contacts_select` and
--    `leads_select` keep calling `employee_covered_territory_ids` and get a
--    different answer from it, which is the point. That makes it a VISIBILITY
--    change and it gets a scenario: supabase/tests/30_territory_coverage_rls.sql
--    now asserts both modes, and the strict assertions were seen to FAIL against
--    the old function before this ran.
--
-- 4. Can an existing row fail the new rule?  Nothing is written or validated, so
--    no row can fail anything. No insert or update path changes.
--
-- 5. What happens to a tenant who has not configured the feature?  **NOT
--    "nothing", and that is deliberate — read this before applying it.** A
--    tenant with no `territory_settings` key gets upward coverage OFF, which is
--    TIGHTER than today. For an account with no area assignments at all, nothing
--    changes: coverage was empty and stays empty, and every customer is seen by
--    ownership or by being an admin. For an account that DOES assign areas, a
--    rep stops seeing customers tagged only at City / State / Country level
--    unless they own them. That is precisely the behaviour asked for, and the
--    cure for a customer who disappears is to tag them to an Area (the
--    Territories screen's migrate tool, `territory_migrate_contact_geo`), or to
--    switch `area_covers_parents` back on for that account.
--
-- Reversible per account with one UPDATE, and reversible globally by restoring
-- the 20261103120000 body. Idempotent: safe to re-run.
-- ============================================================

-- ── 1. The setting, read in one place ────────────────────────
-- Text rather than a strict ::boolean cast on purpose: a key written by hand as
-- "yes" or "1" must not raise and take every customer list down with it.
CREATE OR REPLACE FUNCTION public.territory_area_covers_parents(p_account_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    lower(btrim(a.settings -> 'territory_settings' ->> 'area_covers_parents'))
      IN ('true', 't', '1', 'yes', 'on'),
    false
  )
  FROM public.accounts a
  WHERE a.id = p_account_id;
$$;

REVOKE ALL ON FUNCTION public.territory_area_covers_parents(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.territory_area_covers_parents(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.territory_area_covers_parents(uuid) IS
  'Does an area assignment also cover the territories ABOVE it (City/State/Country)? '
  'accounts.settings->territory_settings->>area_covers_parents, default FALSE. '
  'ON means a customer tagged only to a City is visible to every rep with an area inside it; '
  'OFF means an assigned Area covers that Area and its sub-areas only.';

-- ── 2. Coverage: subtree always, ancestors only if the account says so ──
CREATE OR REPLACE FUNCTION public.employee_covered_territory_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE assigned AS (
    SELECT a.territory_id AS id, p.account_id
      FROM employee_area_assignments a
      JOIN profiles p ON p.id = a.employee_id
     WHERE p.user_id = p_user_id
  ),
  -- Downward: exactly what employee_area_territory_ids has always returned, and
  -- what an assignment has always meant.
  down AS (
    SELECT id FROM assigned
    UNION
    SELECT t.id FROM territories t JOIN down d ON t.parent_id = d.id
  ),
  -- Upward: the chain of parents above each assignment, seeded only for accounts
  -- that asked for it. The gate is on the SEED, so with the setting off this
  -- branch is empty and coverage is the subtree alone. Gated per assignment's
  -- own account, since a user may hold a profile in more than one.
  up AS (
    SELECT t.id, t.parent_id
      FROM territories t
      JOIN assigned a ON t.id = a.id
     WHERE public.territory_area_covers_parents(a.account_id)
    UNION
    SELECT t.id, t.parent_id FROM territories t JOIN up u ON t.id = u.parent_id
  )
  SELECT coalesce(array_agg(DISTINCT id), '{}')
    FROM (SELECT id FROM down UNION SELECT id FROM up) s;
$$;

REVOKE ALL ON FUNCTION public.employee_covered_territory_ids(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.employee_covered_territory_ids(uuid) TO authenticated;

COMMENT ON FUNCTION public.employee_covered_territory_ids(uuid) IS
  'Territory ids a user COVERS: their assigned areas and every descendant, plus every ancestor '
  'ONLY when accounts.settings->territory_settings->>area_covers_parents is on (default off). '
  'Sibling areas are never covered. Read by visibility and route eligibility; the CREATE guards '
  'keep using the strict subtree from employee_area_territory_ids.';

-- ── 3. The settings writer must stop wiping the new key ──────
--
-- `territory_update_settings` (102_territory_rpcs.sql) writes
--
--     jsonb_set(settings, '{territory_settings}',
--               jsonb_build_object('levels', ..., 'assignment_mode', ...))
--
-- which REPLACES the whole object. So an admin who renamed a level in the
-- Territories panel would silently reset area_covers_parents to the default —
-- a setting disappearing on an unrelated save, which is the worst kind of bug
-- to be asked about later. The write now MERGES onto what is there.
--
-- Two signatures on purpose, and NOT one with a DEFAULT. A 5th parameter with a
-- default would make the existing 4-argument call ambiguous between the two
-- candidates — the overload trap recorded in 20260929140000. With no default,
-- Postgres resolves by arity: the deployed web app keeps working through the
-- window between this migration and the next deploy, in either order.
CREATE OR REPLACE FUNCTION public.territory_update_settings(
  p_account_id uuid, p_levels jsonb, p_assignment_mode text, p_confirm boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current jsonb;
  v_affected jsonb := '[]'::jsonb;
  v_level record;
  v_cnt int;
  v_archived_total int := 0;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_assignment_mode NOT IN ('area_wise', 'direct') THEN
    RAISE EXCEPTION 'invalid assignment_mode' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_levels) < 1 OR jsonb_array_length(p_levels) > 5 THEN
    RAISE EXCEPTION 'levels must be 1..5' USING ERRCODE = '22023';
  END IF;

  v_current := coalesce((SELECT settings->'territory_settings' FROM accounts WHERE id = p_account_id), '{}'::jsonb);

  -- For each level transitioning enabled->disabled, count active territories at that position.
  FOR v_level IN
    SELECT (elem->>'position')::int AS position, elem->>'name' AS name, (elem->>'enabled')::boolean AS enabled
      FROM jsonb_array_elements(p_levels) elem
  LOOP
    IF v_level.enabled = false THEN
      SELECT count(*) INTO v_cnt FROM territories
        WHERE account_id = p_account_id AND level = v_level.position AND deleted_at IS NULL;
      IF v_cnt > 0 THEN
        v_affected := v_affected || jsonb_build_object('position', v_level.position, 'name', v_level.name, 'count', v_cnt);
      END IF;
    END IF;
  END LOOP;

  -- Warn + require confirmation before touching data.
  IF jsonb_array_length(v_affected) > 0 AND NOT p_confirm THEN
    RETURN jsonb_build_object('ok', false, 'requires_confirmation', true, 'affected', v_affected);
  END IF;

  IF jsonb_array_length(v_affected) > 0 THEN
    FOR v_level IN SELECT (elem->>'position')::int AS position FROM jsonb_array_elements(v_affected) elem
    LOOP
      UPDATE territories SET deleted_at = now(), status = 'archived'
        WHERE account_id = p_account_id AND level = v_level.position AND deleted_at IS NULL;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      v_archived_total := v_archived_total + v_cnt;
    END LOOP;
  END IF;

  UPDATE accounts
     SET settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{territory_settings}',
           -- MERGE, not replace: keys this function does not know about survive.
           v_current || jsonb_build_object('levels', p_levels, 'assignment_mode', p_assignment_mode),
           true)
   WHERE id = p_account_id;

  RETURN jsonb_build_object('ok', true, 'archived', v_archived_total, 'affected', v_affected);
END;
$$;

REVOKE ALL ON FUNCTION public.territory_update_settings(uuid, jsonb, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.territory_update_settings(uuid, jsonb, text, boolean) TO authenticated;

-- The 5-argument form the Territories panel now calls. No DEFAULT on the new
-- parameter, so this never competes with the call above.
CREATE OR REPLACE FUNCTION public.territory_update_settings(
  p_account_id uuid, p_levels jsonb, p_assignment_mode text, p_confirm boolean,
  p_area_covers_parents boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Levels first: it may come back asking for confirmation, and in that case
  -- nothing at all should have been written.
  v_result := public.territory_update_settings(p_account_id, p_levels, p_assignment_mode, p_confirm);
  IF coalesce((v_result->>'ok')::boolean, false) = false THEN
    RETURN v_result;
  END IF;

  UPDATE accounts
     SET settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{territory_settings,area_covers_parents}',
           to_jsonb(coalesce(p_area_covers_parents, false)),
           true)
   WHERE id = p_account_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.territory_update_settings(uuid, jsonb, text, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.territory_update_settings(uuid, jsonb, text, boolean, boolean) TO authenticated;

COMMENT ON FUNCTION public.territory_update_settings(uuid, jsonb, text, boolean, boolean) IS
  'Territory settings write including area_covers_parents. Delegates the levels/mode work to the '
  'four-argument form, which now merges rather than replacing territory_settings.';
