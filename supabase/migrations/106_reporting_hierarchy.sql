-- ============================================================
-- 106_reporting_hierarchy.sql — Reporting Hierarchy (foundation)
--
-- Reuses the EXISTING profiles.manager_id (self-FK, ON DELETE SET NULL, already
-- present + empty) as the Reporting Manager. Adds one column, one module toggle,
-- four traversal functions, and a cycle-prevention trigger. Additive + reversible.
--
-- Open-Question decisions (founder, 2026-07-31):
--   Q1 Expense approval = SUGGESTION ONLY (no RLS change to expenses here).
--   Q2 Inactive manager  = get_approver SKIPS inactive profiles, walking up to the
--      next active manager.
--
-- The four functions are SECURITY DEFINER so recursive traversal + the cycle
-- trigger can't be defeated by row-level visibility. They return only uuid arrays
-- (profile ids); actual profile data stays RLS-protected.
-- ============================================================

-- ── new column: optional Default Approver ─────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_approver_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── module toggle (defaults OFF for existing accounts) ────────
UPDATE public.accounts
   SET module_settings = module_settings || '{"reporting_hierarchy": false}'::jsonb
 WHERE NOT (module_settings ? 'reporting_hierarchy');

-- ── get_reporting_chain: managers upward, nearest → top ───────
CREATE OR REPLACE FUNCTION public.get_reporting_chain(p_employee_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT m.id, m.manager_id, 1 AS depth
      FROM profiles m
     WHERE m.id = (SELECT manager_id FROM profiles WHERE id = p_employee_id)
    UNION ALL
    SELECT m.id, m.manager_id, c.depth + 1
      FROM profiles m JOIN chain c ON m.id = c.manager_id
     WHERE c.depth < 1000  -- runaway guard only; real orgs are far shallower
  )
  SELECT coalesce(array_agg(id ORDER BY depth), '{}') FROM chain;
$$;

-- ── get_all_reports: direct + indirect reports (downward) ─────
CREATE OR REPLACE FUNCTION public.get_all_reports(p_employee_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE reports AS (
    SELECT id, 1 AS depth FROM profiles WHERE manager_id = p_employee_id
    UNION ALL
    SELECT p.id, r.depth + 1
      FROM profiles p JOIN reports r ON p.manager_id = r.id
     WHERE r.depth < 1000
  )
  SELECT coalesce(array_agg(DISTINCT id), '{}') FROM reports;
$$;

-- ── is_in_downline: RLS-friendly boolean ──────────────────────
CREATE OR REPLACE FUNCTION public.is_in_downline(p_manager_id uuid, p_target_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_target_id = ANY(get_all_reports(p_manager_id));
$$;

-- ── get_approver: default_approver → first ACTIVE manager → null (Q2) ──
CREATE OR REPLACE FUNCTION public.get_approver(p_employee_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_default uuid;
  v_default_status text;
  v_mgr uuid;
BEGIN
  SELECT default_approver_id INTO v_default FROM profiles WHERE id = p_employee_id;
  IF v_default IS NOT NULL THEN
    SELECT status INTO v_default_status FROM profiles WHERE id = v_default;
    IF v_default_status IS DISTINCT FROM 'inactive' THEN
      RETURN v_default;
    END IF;
  END IF;

  -- Walk up the reporting chain, returning the first ACTIVE manager (Q2: skip inactive).
  WITH RECURSIVE chain AS (
    SELECT m.id, m.manager_id, m.status, 1 AS depth
      FROM profiles m
     WHERE m.id = (SELECT manager_id FROM profiles WHERE id = p_employee_id)
    UNION ALL
    SELECT m.id, m.manager_id, m.status, c.depth + 1
      FROM profiles m JOIN chain c ON m.id = c.manager_id
     WHERE c.depth < 1000
  )
  SELECT id INTO v_mgr FROM chain
   WHERE status IS DISTINCT FROM 'inactive'
   ORDER BY depth LIMIT 1;

  RETURN v_mgr;  -- NULL when unresolved (caller falls back to any-admin)
END;
$$;

-- ── cycle prevention (DB-enforced, not just UI) ───────────────
CREATE OR REPLACE FUNCTION public.prevent_manager_cycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cur uuid;
  v_depth int := 0;
  v_self_name text;
BEGIN
  IF NEW.manager_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.manager_id = NEW.id THEN
    RAISE EXCEPTION 'An employee cannot report to themselves.' USING ERRCODE = '23514';
  END IF;

  v_cur := NEW.manager_id;
  WHILE v_cur IS NOT NULL AND v_depth < 10000 LOOP
    IF v_cur = NEW.id THEN
      SELECT full_name INTO v_self_name FROM profiles WHERE id = NEW.id;
      RAISE EXCEPTION 'Reporting loop: % would end up reporting to themselves through this manager.',
        coalesce(v_self_name, NEW.id::text) USING ERRCODE = '23514';
    END IF;
    SELECT manager_id INTO v_cur FROM profiles WHERE id = v_cur;
    v_depth := v_depth + 1;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_manager_cycle ON public.profiles;
CREATE TRIGGER trg_prevent_manager_cycle
  BEFORE INSERT OR UPDATE OF manager_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_manager_cycle();

-- ── grants (authenticated only; anon revoked) ─────────────────
REVOKE ALL ON FUNCTION public.get_reporting_chain(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_all_reports(uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_in_downline(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_approver(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_reporting_chain(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_reports(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_in_downline(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_approver(uuid) TO authenticated;

COMMENT ON COLUMN public.profiles.default_approver_id IS
  'Reporting Hierarchy: optional explicit approver; get_approver() falls back to this, then the reporting chain (manager_id), then null.';
