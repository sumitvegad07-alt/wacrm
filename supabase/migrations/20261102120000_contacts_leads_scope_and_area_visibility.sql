-- ============================================================
-- Customers and leads: area assignment must actually grant visibility.
--
-- The bug, as the founder hit it on 2026-11-02: assign a territory to a new
-- mobile user and their customer list stays empty, so their route has nothing
-- to visit either. Assigning the same area to Dhaval worked — because Dhaval
-- OWNS those customers.
--
-- Two layers were fighting each other:
--
--   * The DATABASE (migration 107) says: a non-admin sees a customer they own
--     OR one inside an area assigned to them. That part was correct, and
--     `employee_area_territory_ids` was returning the right 45 territories for
--     the new user.
--
--   * The MOBILE APP then narrowed that again to `user_id IN (own + downline)`
--     whenever Reporting Hierarchy is on, which account 001001 has on. Own
--     ∩ (own OR area) = own. The area assignment was thrown away after the
--     database had already honoured it, which is why nothing the admin did in
--     Territories had any effect.
--
-- The app-side filter is removed in the same change (wacrm-mobile
-- app/(drawer)/contacts.tsx), leaving the database the single authority — the
-- rule the WEB already follows. For that to lose nothing, the one thing the
-- app filter did that RLS did not — letting a manager see their reports'
-- records — moves here.
--
-- Scope model: the same `*_scope` keys on employee_roles.permissions that
-- payment_scope_allows (20260814220000) already reads, so there is one scope
-- vocabulary in the schema rather than two. 'own' reproduces exactly what
-- these policies did before, so an account with no hierarchy sees no change.
--
-- Blast radius: PERMISSIVE only. Nothing that was visible becomes invisible.
-- A rep gains the customers in the areas assigned to them (the fix). A manager
-- on 'team' scope gains their reports' customers at the data layer, which the
-- app already showed them.
-- ============================================================

-- Row visibility for an owned record under the account's data-scope model.
-- Mirrors payment_scope_allows, with the module key passed in so contacts read
-- contacts_scope and leads read leads_scope.
CREATE OR REPLACE FUNCTION public.owner_scope_allows(
  p_owner_user_id uuid,
  p_account_id uuid,
  p_module text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_super boolean;
  v_perms jsonb;
  v_profile_id uuid;
  v_scope text;
BEGIN
  IF v_uid IS NULL THEN
    -- Service-role / trigger context. Table policies already gate these paths.
    RETURN true;
  END IF;

  SELECT p.account_role, COALESCE(p.is_superadmin, false), er.permissions, p.id
    INTO v_role, v_super, v_perms, v_profile_id
  FROM profiles p
  LEFT JOIN employee_roles er ON er.id = p.employee_role_id
  WHERE p.user_id = v_uid AND p.account_id = p_account_id;

  IF v_role IS NULL THEN
    RETURN false;                                    -- not a member of this account
  END IF;

  IF v_role IN ('owner', 'admin') OR v_super THEN
    RETURN true;
  END IF;

  IF (v_perms ->> 'all') = 'true' THEN
    RETURN true;
  END IF;

  v_scope := COALESCE(v_perms ->> (p_module || '_scope'), v_perms ->> 'global_scope', 'own');

  IF v_scope IN ('all', 'company', 'department') THEN
    RETURN true;
  END IF;

  IF v_scope = 'team' THEN
    IF p_owner_user_id = v_uid THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM profiles p2
      WHERE p2.user_id = p_owner_user_id
        AND p2.id = ANY (get_all_reports(v_profile_id))
    );
  END IF;

  -- 'own' — identical to the `user_id = auth.uid()` these policies had before.
  RETURN p_owner_user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_scope_allows(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_scope_allows(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.owner_scope_allows(uuid, uuid, text) IS
  'Row visibility for an owned record under the account data-scope model (own / team / all). '
  'Same *_scope keys as payment_scope_allows. Used by the contacts and leads SELECT policies so '
  'a manager sees their reports' records at the data layer, not only in the UI.';

-- Customers: admins all; everyone else own + data scope + assigned areas.
DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts FOR SELECT USING (
  is_account_member(account_id) AND (
    is_account_member(account_id, 'admin')
    OR owner_scope_allows(user_id, account_id, 'contacts')
    OR (territory_id IS NOT NULL AND territory_id = ANY(employee_area_territory_ids((SELECT auth.uid()))))
  )
);

-- Leads: same, honouring the lead's own ownership columns.
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT USING (
  is_account_member(account_id) AND (
    is_account_member(account_id, 'admin')
    OR owner_scope_allows(user_id, account_id, 'leads')
    OR owner_scope_allows(owner_id, account_id, 'leads')
    OR (SELECT auth.uid()) = ANY(coalesce(collaborator_ids, '{}'::uuid[]))
    OR (territory_id IS NOT NULL AND territory_id = ANY(employee_area_territory_ids((SELECT auth.uid()))))
  )
);
