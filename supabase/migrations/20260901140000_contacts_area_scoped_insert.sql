-- Area-scoped customer creation (mobile + web)
-- ---------------------------------------------------------------------------
-- A field rep in an area-wise account may only create a customer inside an area
-- assigned to them. No assignment → no valid area → cannot create ("this area is
-- not assigned to you"). Admins/owners are unrestricted, and accounts that don't
-- run area-wise assignment are completely unaffected.
--
-- Visibility is already area-scoped by the existing contacts_select policy
-- (territory_id = ANY employee_area_territory_ids(auth.uid())). This adds the
-- matching guard on INSERT, which previously only checked account membership.

-- True only when the account explicitly runs area-wise assignment. A NULL
-- territory_settings (every account that never configured Territory Master)
-- resolves to false, so this enforcement is opt-in and never silently breaks an
-- existing account's customer creation.
CREATE OR REPLACE FUNCTION public.is_area_scoped_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT settings->'territory_settings'->>'assignment_mode'
       FROM public.accounts WHERE id = p_account_id) = 'area_wise',
    false
  );
$$;

-- RESTRICTIVE: AND-ed with the existing permissive contacts_insert policy, so a
-- row must satisfy BOTH. Admins/owners pass; non-area-scoped accounts pass; a
-- rep in an area-scoped account must place the customer in one of their assigned
-- areas (subtree-expanded by employee_area_territory_ids).
DROP POLICY IF EXISTS contacts_insert_area_scope ON public.contacts;
CREATE POLICY contacts_insert_area_scope ON public.contacts
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'admin')
    OR NOT is_area_scoped_account(account_id)
    OR (territory_id IS NOT NULL
        AND territory_id = ANY (employee_area_territory_ids(auth.uid())))
  );

REVOKE ALL ON FUNCTION public.is_area_scoped_account(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_area_scoped_account(uuid) TO authenticated;
