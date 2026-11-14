-- ============================================================
-- The portal's visibility, as functions instead of policies.
--
-- WHY NOT ADD `OR portal_can_see(...)` TO contacts_select. Both earlier drafts
-- proposed exactly that, "additive only". On 2026-11-02 migration
-- 20261102120000 rebuilt contacts_select and silently dropped three branches:
-- collaborator_ids (so "Also Assigned To" granted nothing), employee_id (direct
-- assignment — the very bug 20261005160000 had been written to close) and
-- data_scope_extends. That was a careful engineer editing one policy
-- deliberately, and three things broke quietly. contacts_select guards every
-- customer record of every tenant. It is not being reopened to let an outsider
-- in.
--
-- So a portal login gets EXECUTE on a named list of functions, and the policies
-- are untouched. A wrong query, a missing filter or an injection in the portal
-- app has no table to reach, because is_account_member is false for a customer
-- with no profiles row (measured in supabase/tests/70_portal_visibility.sql,
-- section O).
--
-- FOUR THINGS IN THE RESOLVER ARE LOAD-BEARING:
--  1. No arguments, so Postgres evaluates it ONCE per statement instead of once
--     per row. An argument-taking can_see(contact_id) is the difference between
--     a fast screen and a slow one.
--  2. c.account_id = t.account_id INSIDE the recursion, so a corrupted
--     parent_id cannot cross a tenant boundary.
--  3. The walk starts from auth.uid(), so a revoked login yields '{}' on the
--     very next request — we do not depend on ending their session.
--  4. depth < 20. is_legal_customer_parent already refuses "X supplied through
--     themselves", but that guard has been rebuilt once (20261104130000) and
--     production carries drift this folder does not. array_agg is DISTINCT so a
--     cycle cannot inflate the array either.
--
-- An UNMAPPED dealer has no parent and therefore appears in nobody's portal.
-- That is the honest answer and it matches the mapping screen, which leaves a
-- customer unmapped when an area has several holders rather than guessing.
-- ============================================================

-- ── Who is calling? Written ONCE. ────────────────────────────
-- The five conditions that make a portal login valid live here and nowhere
-- else. contacts_select drifted because the same rule was written in several
-- branches of one policy; this is the same mistake one layer up, avoided.
--
-- Note what is deliberately NOT tested: is_active and buying_status. The
-- founder ruled on 2026-11-07 that a deactivated or blacklisted customer KEEPS
-- a working login and keeps consuming a seat, because portal access is governed
-- by ONE explicit control — the Provide DMS Access toggle. Do not "fix" this.
CREATE OR REPLACE FUNCTION public.portal_caller()
RETURNS TABLE (contact_id uuid, account_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select c.id, c.account_id
    from public.contacts c
   where c.portal_user_id = (select auth.uid())
     and c.portal_access
     and c.portal_access_revoked_at is null
     and public.account_has_line(c.account_id, 'dms')
   limit 1;
$$;

ALTER FUNCTION public.portal_caller() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_caller() TO authenticated, service_role;

-- ── The resolver ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_visible_contact_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  with recursive me as (
    select contact_id as id, account_id from public.portal_caller()
  ),
  tree as (
    select id, account_id, 0 as depth from me
    union all
    select c.id, c.account_id, t.depth + 1
      from public.contacts c
      join tree t on c.parent_id = t.id
     where t.depth < 20
       and c.account_id = t.account_id
  )
  select coalesce(array_agg(distinct id), '{}'::uuid[]) from tree;
$fn$;

ALTER FUNCTION public.portal_visible_contact_ids() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_visible_contact_ids() TO authenticated, service_role;

-- ── Their own record ─────────────────────────────────────────
-- Returns ONE jsonb object so the portal app reads a shape, not a row type that
-- a later ALTER could reorder. `null` means "you have no portal access", which
-- the app turns into the plain sentence spec §12 asks for.
--
-- The timezone comes from public.account_timezone(), which is the single source
-- for an account-local day boundary in SQL (20261031120000). The plan's draft
-- read accounts.settings -> 'company_profile' ->> 'timezone' by hand; that path
-- does not exist — the value lives at settings ->> 'timezone' — so every portal
-- screen would have silently shown Asia/Kolkata for an account in another zone,
-- and the rule would have had a second home. Called, never copied.
CREATE OR REPLACE FUNCTION public.portal_me()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select jsonb_build_object(
           'contact_id',          c.id,
           'account_id',          c.account_id,
           'name',                c.name,
           'company',             c.company,
           'phone',               c.phone,
           'email',               c.email,
           'address',             c.address,
           'city',                c.city,
           'state',               c.state,
           'hierarchy_level',     c.hierarchy_level,
           'credit_limit',        c.credit_limit,
           'outstanding_balance', c.outstanding_balance,
           'account_name',        a.name,
           'currency',            coalesce(a.default_currency, 'INR'),
           'timezone',            public.account_timezone(c.account_id)
         )
    from public.portal_caller() pc
    join public.contacts c on c.id = pc.contact_id
    join public.accounts a on a.id = pc.account_id;
$$;

ALTER FUNCTION public.portal_me() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_me() TO authenticated, service_role;

-- ── Everyone below them ──────────────────────────────────────
-- The CALLER is excluded: this answers "My Customers", and a distributor is not
-- one of their own customers. has_portal_login is a boolean only — the portal
-- never sees another customer's login address.
CREATE OR REPLACE FUNCTION public.portal_customers()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select coalesce(jsonb_agg(x order by x ->> 'hierarchy_level', x ->> 'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id',                  c.id,
               'name',                c.name,
               'company',             c.company,
               'phone',               c.phone,
               'city',                c.city,
               'state',               c.state,
               'hierarchy_level',     c.hierarchy_level,
               'parent_id',           c.parent_id,
               'parent_name',         p.name,
               'is_active',           c.is_active,
               'buying_status',       c.buying_status,
               'outstanding_balance', c.outstanding_balance,
               'credit_limit',        c.credit_limit,
               'has_portal_login',    (c.portal_user_id is not null
                                        and c.portal_access
                                        and c.portal_access_revoked_at is null)
             ) as x
        from public.contacts c
        left join public.contacts p on p.id = c.parent_id
       where c.id = any(public.portal_visible_contact_ids())
         and c.id is distinct from (select contact_id from public.portal_caller())
    ) s;
$$;

ALTER FUNCTION public.portal_customers() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_customers() TO authenticated, service_role;
