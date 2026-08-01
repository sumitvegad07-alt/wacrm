-- ============================================================
-- 107_area_visibility.sql — area/owner-based visibility for field employees
--
-- Founder decision (2026-08-01): a non-admin employee should see only records
-- (customers + leads) that are EITHER in their assigned area(s) OR that they
-- personally own/collaborate on. Admins/owner see everything (unchanged).
--
-- Enforced at the DATABASE (RLS) so it holds everywhere — mobile lists, web
-- lists, the visit customer picker, etc. — not just in one screen's query.
--
-- Blast radius: this tightens SELECT for ALL non-admin members across every
-- account (from "see all account records" to "own + assigned area"). Admins and
-- owners are unaffected. Records owned by the user, or whose territory is inside
-- one of their assigned areas (or a sub-area of it), remain visible.
-- ============================================================

-- Leads gain a territory so they can be area-scoped like customers.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS territory_id uuid NULL REFERENCES public.territories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS leads_territory_idx ON public.leads (territory_id) WHERE territory_id IS NOT NULL;

-- Territory ids a user covers = their assigned areas + every descendant of those.
-- SECURITY DEFINER so RLS can call it regardless of the caller's own visibility.
CREATE OR REPLACE FUNCTION public.employee_area_territory_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE assigned AS (
    SELECT a.territory_id AS id
      FROM employee_area_assignments a
      JOIN profiles p ON p.id = a.employee_id
     WHERE p.user_id = p_user_id
  ),
  subtree AS (
    SELECT id FROM assigned
    UNION
    SELECT t.id FROM territories t JOIN subtree s ON t.parent_id = s.id
  )
  SELECT coalesce(array_agg(DISTINCT id), '{}') FROM subtree;
$$;

REVOKE ALL ON FUNCTION public.employee_area_territory_ids(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.employee_area_territory_ids(uuid) TO authenticated;

-- Customers: admins all; everyone else own + in-assigned-area.
DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts FOR SELECT USING (
  is_account_member(account_id) AND (
    is_account_member(account_id, 'admin')
    OR user_id = auth.uid()
    OR (territory_id IS NOT NULL AND territory_id = ANY(employee_area_territory_ids(auth.uid())))
  )
);

-- Leads: same, honouring lead ownership (user_id / owner_id / collaborators).
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT USING (
  is_account_member(account_id) AND (
    is_account_member(account_id, 'admin')
    OR user_id = auth.uid()
    OR owner_id = auth.uid()
    OR auth.uid() = ANY(coalesce(collaborator_ids, '{}'::uuid[]))
    OR (territory_id IS NOT NULL AND territory_id = ANY(employee_area_territory_ids(auth.uid())))
  )
);

COMMENT ON FUNCTION public.employee_area_territory_ids(uuid) IS
  'Territory ids a user covers via employee_area_assignments, expanded to the full subtree. Used by contacts/leads SELECT RLS for area-based visibility.';
