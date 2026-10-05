-- ============================================================
-- 20261005120000_areas_allow_multiple_employees.sql
--
-- Founder decision (2026-10-05): one area may be covered by MANY employees.
--
-- Until now `territory_assign_employee_areas` refused the save outright when an
-- area was already assigned to somebody else ("Q1: in area-wise mode an area may
-- belong to at most one employee", migrations 102 and 105). That is the single
-- thing standing in the way — the `employee_area_assignments` table has always
-- been keyed UNIQUE (employee_id, territory_id), so it already models a
-- many-to-many relationship, and `employee_area_territory_ids` (migration 107)
-- already expands whatever set it finds. Nothing downstream assumes one owner.
--
-- Blast radius: PERMISSIVE only. Every existing assignment stays exactly as it
-- is; this just stops rejecting a second employee on the same area. An admin who
-- wants one rep per area simply doesn't assign a second one.
--
-- `v_mode` and `v_conflict` disappear with the check — the assignment mode no
-- longer changes what this function does, so reading it was dead work.
-- ============================================================

CREATE OR REPLACE FUNCTION public.territory_assign_employee_areas(p_employee_id uuid, p_territory_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account uuid; v_actor uuid;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE id = p_employee_id;
  IF v_account IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'employee_not_found'); END IF;
  IF NOT is_account_member(v_account, 'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  -- Reject territory ids that aren't in this account (defence in depth).
  IF EXISTS (SELECT 1 FROM unnest(p_territory_ids) tid
    WHERE NOT EXISTS (SELECT 1 FROM territories t WHERE t.id = tid AND t.account_id = v_account)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'territory_not_in_account');
  END IF;

  SELECT id INTO v_actor FROM profiles WHERE user_id = auth.uid() AND account_id = v_account;

  -- Replace THIS employee's set. Other employees' rows on the same areas are
  -- deliberately left alone — that is what makes a shared area possible.
  DELETE FROM employee_area_assignments WHERE account_id = v_account AND employee_id = p_employee_id;

  INSERT INTO employee_area_assignments (account_id, employee_id, territory_id, assigned_by)
  SELECT v_account, p_employee_id, tid, v_actor FROM unnest(p_territory_ids) tid;

  RETURN jsonb_build_object('ok', true, 'assigned', coalesce(array_length(p_territory_ids, 1), 0));
END; $$;

REVOKE EXECUTE ON FUNCTION public.territory_assign_employee_areas(uuid, uuid[]) FROM anon;

COMMENT ON FUNCTION public.territory_assign_employee_areas(uuid, uuid[]) IS
  'Replaces one employee''s area set. An area may be covered by several employees (2026-10-05); other employees'' rows are never touched.';
