-- ============================================================
-- 105_territory_default_area_wise.sql
--
-- Founder decision (2026-07-31): the default assignment mode is **area-wise**,
-- not direct. The web/mobile clients already default their settings UI to
-- area_wise; this changes the server-side fallback in
-- territory_assign_employee_areas so an account that has never saved
-- territory_settings still gets area-wise overlap protection (one employee per
-- area) rather than the permissive direct behaviour.
--
-- Only the coalesce fallback changed (…'direct' → …'area_wise'); everything else
-- is identical to migration 102.
-- ============================================================

CREATE OR REPLACE FUNCTION public.territory_assign_employee_areas(p_employee_id uuid, p_territory_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account uuid; v_mode text; v_conflict record; v_actor uuid;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE id = p_employee_id;
  IF v_account IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'employee_not_found'); END IF;
  IF NOT is_account_member(v_account, 'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_territory_ids) tid
    WHERE NOT EXISTS (SELECT 1 FROM territories t WHERE t.id = tid AND t.account_id = v_account)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'territory_not_in_account');
  END IF;
  v_mode := coalesce((SELECT settings->'territory_settings'->>'assignment_mode' FROM accounts WHERE id = v_account), 'area_wise');
  IF v_mode = 'area_wise' THEN
    SELECT t.id, t.name INTO v_conflict
      FROM employee_area_assignments a JOIN territories t ON t.id = a.territory_id
     WHERE a.account_id = v_account AND a.territory_id = ANY(p_territory_ids) AND a.employee_id <> p_employee_id LIMIT 1;
    IF v_conflict.id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'area_taken', 'territory_id', v_conflict.id, 'territory_name', v_conflict.name);
    END IF;
  END IF;
  SELECT id INTO v_actor FROM profiles WHERE user_id = auth.uid() AND account_id = v_account;
  DELETE FROM employee_area_assignments WHERE account_id = v_account AND employee_id = p_employee_id;
  INSERT INTO employee_area_assignments (account_id, employee_id, territory_id, assigned_by)
  SELECT v_account, p_employee_id, tid, v_actor FROM unnest(p_territory_ids) tid;
  RETURN jsonb_build_object('ok', true, 'assigned', coalesce(array_length(p_territory_ids, 1), 0));
END; $$;

REVOKE EXECUTE ON FUNCTION public.territory_assign_employee_areas(uuid, uuid[]) FROM anon;
