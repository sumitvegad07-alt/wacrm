-- ============================================================
-- 102_territory_rpcs.sql — Territory Master server-side operations
--
-- All functions:
--   * SECURITY DEFINER (they bypass RLS) so they MUST self-enforce
--     is_account_member(account_id,'admin') and scope every query by account_id.
--   * SET search_path = public (no schema hijack).
--   * Every UPDATE/DELETE is WHERE-qualified (Supabase pg_safeupdate rejects
--     unqualified writes on the REST/authenticated connection — see CLAUDE.md).
--   * Return structured jsonb (not exceptions) for user-recoverable outcomes
--     (blocked archive/delete, level-disable confirmation), so the web/mobile
--     client can render a dialog instead of parsing an error string.
--
-- Open-Question decisions encoded here:
--   Q1 prevent-overlap  -> territory_assign_employee_areas
--   Q2 warn + archive   -> territory_update_settings
--   Q3 case/space-insens-> territory_migrate_contact_geo
-- ============================================================

-- ── archive (soft-delete) a territory + its subtree ───────────
CREATE OR REPLACE FUNCTION public.territory_archive(p_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_ids uuid[];
  v_contacts int;
  v_assignments int;
  v_archived int;
BEGIN
  SELECT account_id INTO v_account FROM territories WHERE id = p_id;
  IF v_account IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH RECURSIVE sub AS (
    SELECT id FROM territories WHERE id = p_id AND account_id = v_account
    UNION ALL
    SELECT t.id FROM territories t JOIN sub ON t.parent_id = sub.id
    WHERE t.account_id = v_account
  )
  SELECT array_agg(id) INTO v_ids FROM sub;

  SELECT count(*) INTO v_contacts
    FROM contacts WHERE account_id = v_account AND territory_id = ANY(v_ids);
  SELECT count(*) INTO v_assignments
    FROM employee_area_assignments WHERE account_id = v_account AND territory_id = ANY(v_ids);

  IF (v_contacts > 0 OR v_assignments > 0) AND NOT p_force THEN
    RETURN jsonb_build_object(
      'ok', false, 'blocked', true,
      'attached_contacts', v_contacts, 'attached_assignments', v_assignments);
  END IF;

  UPDATE territories
     SET deleted_at = now(), status = 'archived'
   WHERE account_id = v_account AND id = ANY(v_ids) AND deleted_at IS NULL;
  GET DIAGNOSTICS v_archived = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'archived', v_archived,
    'attached_contacts', v_contacts, 'attached_assignments', v_assignments);
END;
$$;

-- ── restore an archived territory + its subtree ───────────────
CREATE OR REPLACE FUNCTION public.territory_restore(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_parent uuid;
  v_parent_archived boolean;
  v_restored int;
BEGIN
  SELECT account_id, parent_id INTO v_account, v_parent FROM territories WHERE id = p_id;
  IF v_account IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_parent IS NOT NULL THEN
    SELECT deleted_at IS NOT NULL INTO v_parent_archived FROM territories WHERE id = v_parent;
    IF v_parent_archived THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'parent_archived');
    END IF;
  END IF;

  WITH RECURSIVE sub AS (
    SELECT id FROM territories WHERE id = p_id AND account_id = v_account
    UNION ALL
    SELECT t.id FROM territories t JOIN sub ON t.parent_id = sub.id WHERE t.account_id = v_account
  )
  UPDATE territories
     SET deleted_at = NULL, status = 'active'
   WHERE account_id = v_account AND id IN (SELECT id FROM sub) AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'restored', v_restored);
END;
$$;

-- ── hard delete (only a childless, unattached leaf) ───────────
CREATE OR REPLACE FUNCTION public.territory_delete(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_children int; v_contacts int; v_assignments int;
BEGIN
  SELECT account_id INTO v_account FROM territories WHERE id = p_id;
  IF v_account IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_children     FROM territories             WHERE parent_id = p_id;
  SELECT count(*) INTO v_contacts     FROM contacts                WHERE account_id = v_account AND territory_id = p_id;
  SELECT count(*) INTO v_assignments  FROM employee_area_assignments WHERE account_id = v_account AND territory_id = p_id;

  IF v_children > 0 OR v_contacts > 0 OR v_assignments > 0 THEN
    RETURN jsonb_build_object('ok', false, 'blocked', true,
      'children', v_children, 'attached_contacts', v_contacts, 'attached_assignments', v_assignments);
  END IF;

  DELETE FROM territories WHERE id = p_id AND account_id = v_account;
  RETURN jsonb_build_object('ok', true, 'deleted', true);
END;
$$;

-- ── assign an employee's area set (Q1: prevent overlap) ───────
CREATE OR REPLACE FUNCTION public.territory_assign_employee_areas(
  p_employee_id uuid, p_territory_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_mode text;
  v_conflict record;
  v_actor uuid;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE id = p_employee_id;
  IF v_account IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'employee_not_found');
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Reject territory ids that aren't in this account (defence in depth).
  IF EXISTS (
    SELECT 1 FROM unnest(p_territory_ids) tid
    WHERE NOT EXISTS (SELECT 1 FROM territories t WHERE t.id = tid AND t.account_id = v_account)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'territory_not_in_account');
  END IF;

  v_mode := coalesce(
    (SELECT settings->'territory_settings'->>'assignment_mode' FROM accounts WHERE id = v_account),
    'direct');

  -- Q1: in area-wise mode an area may belong to at most one employee.
  IF v_mode = 'area_wise' THEN
    SELECT t.id, t.name INTO v_conflict
      FROM employee_area_assignments a
      JOIN territories t ON t.id = a.territory_id
     WHERE a.account_id = v_account
       AND a.territory_id = ANY(p_territory_ids)
       AND a.employee_id <> p_employee_id
     LIMIT 1;
    IF v_conflict.id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'area_taken',
        'territory_id', v_conflict.id, 'territory_name', v_conflict.name);
    END IF;
  END IF;

  SELECT id INTO v_actor FROM profiles WHERE user_id = auth.uid() AND account_id = v_account;

  -- Replace the employee's set.
  DELETE FROM employee_area_assignments
   WHERE account_id = v_account AND employee_id = p_employee_id;

  INSERT INTO employee_area_assignments (account_id, employee_id, territory_id, assigned_by)
  SELECT v_account, p_employee_id, tid, v_actor
    FROM unnest(p_territory_ids) tid;

  RETURN jsonb_build_object('ok', true, 'assigned', coalesce(array_length(p_territory_ids, 1), 0));
END;
$$;

-- ── update hierarchy config (Q2: disabling a level archives its data) ──
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

  -- Confirmed (or nothing to archive): archive the disabled levels' territories.
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
           jsonb_build_object('levels', p_levels, 'assignment_mode', p_assignment_mode),
           true)
   WHERE id = p_account_id;

  RETURN jsonb_build_object('ok', true, 'archived', v_archived_total, 'affected', v_affected);
END;
$$;

-- ── migrate legacy contacts geo -> territory (Q3: case/space-insensitive) ──
CREATE OR REPLACE FUNCTION public.territory_migrate_contact_geo(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_c record;
  v_val text;
  v_match uuid;
  v_match_count int;
  v_matched int := 0;
  v_unmatched int := 0;
  v_unmatched_ids uuid[] := '{}';
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: only unmigrated contacts (no territory yet).
  FOR v_c IN
    SELECT id, area, city, state, country
      FROM contacts
     WHERE account_id = p_account_id AND territory_id IS NULL
  LOOP
    -- Most specific non-empty legacy value wins.
    v_val := coalesce(nullif(btrim(v_c.area), ''), nullif(btrim(v_c.city), ''),
                      nullif(btrim(v_c.state), ''), nullif(btrim(v_c.country), ''));
    IF v_val IS NULL THEN
      CONTINUE;  -- no geo to migrate; leave untouched, not flagged
    END IF;

    -- Q3: case + whitespace insensitive, exactly-one active match required.
    SELECT count(*) INTO v_match_count
      FROM territories
     WHERE account_id = p_account_id AND deleted_at IS NULL
       AND lower(btrim(name)) = lower(btrim(v_val));

    IF v_match_count = 1 THEN
      SELECT id INTO v_match FROM territories
        WHERE account_id = p_account_id AND deleted_at IS NULL
          AND lower(btrim(name)) = lower(btrim(v_val)) LIMIT 1;
      UPDATE contacts SET territory_id = v_match, needs_territory_review = false
        WHERE id = v_c.id AND account_id = p_account_id;
      v_matched := v_matched + 1;
    ELSE
      -- zero or ambiguous -> manual review, never guess
      UPDATE contacts SET needs_territory_review = true
        WHERE id = v_c.id AND account_id = p_account_id;
      v_unmatched := v_unmatched + 1;
      v_unmatched_ids := v_unmatched_ids || v_c.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'matched', v_matched, 'unmatched', v_unmatched,
    'unmatchedContactIds', to_jsonb(v_unmatched_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.territory_archive(uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public.territory_restore(uuid) FROM public;
REVOKE ALL ON FUNCTION public.territory_delete(uuid) FROM public;
REVOKE ALL ON FUNCTION public.territory_assign_employee_areas(uuid, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.territory_update_settings(uuid, jsonb, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.territory_migrate_contact_geo(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.territory_archive(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_restore(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_assign_employee_areas(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_update_settings(uuid, jsonb, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.territory_migrate_contact_geo(uuid) TO authenticated;
