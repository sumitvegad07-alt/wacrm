-- ============================================================
-- Area is not mandatory: a territory assignment must match in BOTH directions.
--
-- Founder, 2026-11-03: "Customers Area assignment ... the Area is not
-- mandatory. Agar salesman ko area assign kia he or customer ko khali City
-- assign kia he than wo customers unassigned rahenge. It is not a bug, it is an
-- implementation error."
--
-- He is right, and here is the exact mechanism.
--
-- `employee_area_territory_ids` (migration 107) expands an assignment DOWNWARD
-- only — the assigned territories plus every descendant:
--
--     assigned: 150 Feet Ring Road   (an Area under City Rajkot)
--     returns:  150 Feet Ring Road + anything beneath it
--
-- A customer recorded with only a City therefore carries territory_id = Rajkot,
-- which is the assignment's PARENT, not its child. It is in neither set, so the
-- rep covering an area of Rajkot cannot see a customer sitting in Rajkot. No
-- amount of assigning areas could ever have fixed it — the match could only
-- succeed if the admin went back and re-tagged every customer down to area
-- level, which is precisely the mandatory-Area requirement he is removing.
--
-- The rule becomes: a rep covers a customer when the two sit on the SAME CHAIN
-- — the customer's territory is inside the rep's patch, or the rep's patch is
-- inside the customer's territory.
--
--     assigned: 150 Feet Ring Road
--     covers:   150 Feet Ring Road + below   (descendants, as before)
--               + Rajkot, Gujarat, India     (ancestors, the fix)
--               NOT Amin Marg                (a sibling area — still invisible)
--
-- Sibling isolation is kept deliberately: assign 150 Feet Ring Road to Dhaval
-- and Amin Marg to someone else and each still sees only his own area, which is
-- what was asked for on 2026-11-02. Only the chain above an assignment opens up.
--
-- ONE CONSEQUENCE, STATED PLAINLY: a customer recorded no deeper than Country
-- becomes visible to every rep in the country, and one recorded at State level
-- to every rep in that state. That is the arithmetic of "no Area needed" — a
-- customer tagged only "India" has told us nothing finer, so anybody whose patch
-- is inside India covers them. Those customers are invisible to every rep today,
-- so this only ever adds. Tagging them to a City is the cure, not a code change.
--
-- WHY A NEW FUNCTION rather than widening `employee_area_territory_ids`.
-- That function also drives two CREATE guards: the RESTRICTIVE
-- contacts_insert_area_scope policy (20260901140000) and the mobile customer
-- form's territory picker (wacrm-mobile app/contact/new.tsx:69), which old APKs
-- in the field still call. Widening it would let a rep file a new customer
-- against "India", and would offer ancestors in a picker whose matching insert
-- guard then refuses them. Creation stays strictly inside the assigned subtree;
-- only VISIBILITY and route eligibility read the wider set.
--
-- ALSO RESTORES THREE BRANCHES contacts_select LOST ON 2026-11-02.
-- 20261102120000 rebuilt the policy from the migration-107 text and so silently
-- dropped what 20261005160000 had added:
--   * collaborator_ids — "Also Assigned To" granted no visibility at all
--   * employee_id      — the main owner under direct-assignment mode, the exact
--                        latent bug 20261005160000 was written to close
--   * data_scope_extends — the directional data-scope branch
-- All three are carried back here. leads_select lost its data_scope_extends
-- branch the same way and gets it back too.
--
-- data_scope_extends lives only on the live database — it has no CREATE in this
-- folder — so the policies are assembled with dynamic SQL that includes that
-- branch only where the function actually exists. The migration is therefore
-- safe on a fresh database and on prod alike.
--
-- Blast radius: PERMISSIVE only. Nothing visible today becomes invisible, and no
-- account without area assignments is affected in any way.
-- ============================================================

-- ── 1. Coverage: the assignment's subtree AND its ancestors ──
CREATE OR REPLACE FUNCTION public.employee_covered_territory_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE assigned AS (
    SELECT a.territory_id AS id
      FROM employee_area_assignments a
      JOIN profiles p ON p.id = a.employee_id
     WHERE p.user_id = p_user_id
  ),
  -- Downward: exactly what employee_area_territory_ids has always returned.
  down AS (
    SELECT id FROM assigned
    UNION
    SELECT t.id FROM territories t JOIN down d ON t.parent_id = d.id
  ),
  -- Upward: the chain of parents above each assignment. A customer tagged at a
  -- coarser level than the rep's patch sits here.
  up AS (
    SELECT t.id, t.parent_id FROM territories t JOIN assigned a ON t.id = a.id
    UNION
    SELECT t.id, t.parent_id FROM territories t JOIN up u ON t.id = u.parent_id
  )
  SELECT coalesce(array_agg(DISTINCT id), '{}')
    FROM (SELECT id FROM down UNION SELECT id FROM up) s;
$$;

REVOKE ALL ON FUNCTION public.employee_covered_territory_ids(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.employee_covered_territory_ids(uuid) TO authenticated;

COMMENT ON FUNCTION public.employee_covered_territory_ids(uuid) IS
  'Territory ids a user COVERS: their assigned areas, every descendant (as employee_area_territory_ids '
  'returns) and every ancestor. The ancestors are what let a rep assigned an Area see a customer '
  'recorded only at City/State/Country level, so Area is not mandatory on the customer. '
  'Read by visibility and route eligibility only — CREATE guards keep using the strict subtree '
  'from employee_area_territory_ids.';

-- ── 2. Customers and leads: see the whole chain ──────────────
-- Assembled dynamically so the data_scope_extends branch is included only where
-- that function exists (it is on prod; it has no CREATE in this folder).
DO $do$
DECLARE
  v_has_scope boolean := to_regprocedure('public.data_scope_extends(uuid,uuid)') IS NOT NULL;
BEGIN
  DROP POLICY IF EXISTS contacts_select ON public.contacts;
  EXECUTE format($fmt$
    CREATE POLICY contacts_select ON public.contacts FOR SELECT USING (
      (
        is_account_member(account_id) AND (
          is_account_member(account_id, 'admin'::account_role_enum)
          OR owner_scope_allows(user_id, account_id, 'contacts')
          -- "Also Assigned To" (20261005160000). Auth user ids, not profiles.id.
          OR (SELECT auth.uid()) = ANY (collaborator_ids)
          -- Main owner under direct-assignment mode; employee_id is profiles.id.
          OR employee_id IN (SELECT p.id FROM profiles p WHERE p.user_id = (SELECT auth.uid()))
          -- The fix: same chain in either direction.
          OR (territory_id IS NOT NULL
              AND territory_id = ANY (employee_covered_territory_ids((SELECT auth.uid()))))
        )
      ) %s
    )$fmt$,
    CASE WHEN v_has_scope
      THEN 'OR (is_account_member(account_id) AND data_scope_extends(user_id, account_id))'
      ELSE '' END);

  DROP POLICY IF EXISTS leads_select ON public.leads;
  EXECUTE format($fmt$
    CREATE POLICY leads_select ON public.leads FOR SELECT USING (
      (
        is_account_member(account_id) AND (
          is_account_member(account_id, 'admin'::account_role_enum)
          OR owner_scope_allows(user_id, account_id, 'leads')
          OR owner_scope_allows(owner_id, account_id, 'leads')
          OR (SELECT auth.uid()) = ANY (coalesce(collaborator_ids, '{}'::uuid[]))
          OR (territory_id IS NOT NULL
              AND territory_id = ANY (employee_covered_territory_ids((SELECT auth.uid()))))
        )
      ) %s
    )$fmt$,
    CASE WHEN v_has_scope
      THEN 'OR (is_account_member(account_id) AND data_scope_extends(owner_id, account_id))'
      ELSE '' END);
END
$do$;

-- ── 3. Routes: the same customers must be addable to a beat ──
-- Without this, the customer the rep can now SEE still cannot be put on his
-- beat, and route_health would flag him as 'outside_territory' once he was.

-- 3.1 Customer eligibility for a route (migration 110, §1.2).
CREATE OR REPLACE FUNCTION public._route_contact_eligible(p_account uuid, p_assignee_id uuid, p_contact_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = p_contact_id
      AND c.account_id = p_account
      AND c.territory_id IS NOT NULL
      AND c.territory_id = ANY (employee_covered_territory_ids(
            (SELECT user_id FROM public.profiles WHERE id = p_assignee_id)))
  );
$$;

-- 3.2 route_health (migration 111). Carried over verbatim except the one line
--     that resolves the assignee's territories.
CREATE OR REPLACE FUNCTION public.route_health(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_cust_count int;
  v_cap int;
  v_assignee_uid uuid;
  v_terr uuid[];
  v_checks jsonb;
  v_total int;
  v_passed int;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  if not has_permission(v_uid, v_account, 'view_routes') then
    raise exception 'Not allowed to view routes' using errcode = '42501';
  end if;
  select * into v_route from public.routes where id = p_route_id;
  if not found then raise exception 'Route not found' using errcode = '42501'; end if;
  v_cap := coalesce((select (settings->'route_settings'->'capacity'->>'max_customers')::int
                     from public.accounts where id = v_route.account_id), 50);
  select count(*) into v_cust_count from public.route_customers where route_id = p_route_id and archived_at is null;
  v_assignee_uid := (select user_id from public.profiles where id = v_route.primary_assignee_id);
  -- Coverage, not the strict subtree: a customer tagged only at City level is
  -- inside this assignee's patch for every purpose the beat cares about.
  if v_assignee_uid is not null then v_terr := employee_covered_territory_ids(v_assignee_uid); end if;

  with defs(code, ok) as (
    values
      ('no_customers',              v_cust_count > 0),
      ('primary_assignee_missing',  v_route.primary_assignee_id is not null),
      ('not_assigned',              exists (select 1 from public.route_plan_assignments where route_id = p_route_id and is_active)),
      ('duplicate_name',            not exists (select 1 from public.routes r2
                                                where r2.account_id = v_route.account_id and r2.id <> p_route_id
                                                  and r2.status <> 'archived' and lower(r2.name) = lower(v_route.name))),
      ('capacity_exceeded',         v_cust_count <= v_cap),
      ('contains_flagged_customer', not exists (select 1 from public.route_customers rc
                                                join public.contacts c on c.id = rc.contact_id
                                                where rc.route_id = p_route_id and rc.archived_at is null
                                                  and c.needs_territory_review)),
      ('outside_territory',         v_terr is null or not exists (select 1 from public.route_customers rc
                                                join public.contacts c on c.id = rc.contact_id
                                                where rc.route_id = p_route_id and rc.archived_at is null
                                                  and (c.territory_id is null or not (c.territory_id = any(v_terr)))))
  )
  select jsonb_agg(jsonb_build_object('code', code, 'ok', ok, 'severity', 'warning')),
         count(*), count(*) filter (where ok)
    into v_checks, v_total, v_passed
    from defs;

  return jsonb_build_object(
    'score', case when v_total = 0 then 100 else round(100.0 * v_passed / v_total) end,
    'checks', v_checks);
end;
$$;
