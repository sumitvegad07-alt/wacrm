-- ============================================================
-- Route rights: 20 tickboxes become 9. Plus two new field rules.
--
-- WHY. The founder opened Roles → Route Management and found twenty
-- checkboxes across four sub-headings: "currently it is too much confusing...
-- we have rights for route and customers in those routes which creates
-- confusion to me also IDK about my clients how will they feel".
--
-- He is right. Nobody grants "Reorder customers" but withholds "Remove
-- customers" — they are the same job (editing a route), split into separate
-- switches because the Route SDK enumerated every RPC rather than every
-- decision an admin actually makes.
--
-- THE SHAPE. Nine rights, each one a decision somebody really takes:
--
--   view_routes               See routes, health and executions
--   add_routes                Create a route (cloning is creating one)
--   edit_routes               Change a route: its customers, their order,
--                             its schedule
--   delete_routes             Delete or archive a route
--   approve_routes            Assign routes to staff and approve/reject them
--   execute_route             Run a route: start, check in, complete
--   modify_route_sequence     Skip a stop or visit out of the planned order
--   restrict_off_route_visits Block visits to customers not on today's route
--   optimize_routes           Use the nearest-customer suggestion (new)
--
-- HOW THE RETIRED KEYS KEEP WORKING. Migrations 110 and 111 check the granular
-- keys inside the RPCs (`_route_assert_editable(..., 'add_route_customers')`
-- and friends). Rewriting eleven RPCs to rename a string is pure risk for no
-- gain, so instead has_permission learns a route alias map: asked for a retired
-- key, it also accepts the surviving one. The RPCs are not touched at all, and
-- a tenant who still has an old key ticked keeps working either way.
--
-- AND THE ROLES THAT ALREADY EXIST. A role holding 'reorder_route_customers'
-- but not 'edit_routes' would silently lose the ability the moment the UI stops
-- offering the old key. §3 backfills every such role first: any retired key set
-- true grants its survivor. Nobody loses anything on deploy day.
--
-- TWO NEW FIELD RULES (founder item 3). Check-out selfie and visit feedback
-- become rights, next to the punch-in selfie rule that is already one, and both
-- are ON by default — §4 backfills them onto every existing role, and the roles
-- editor ticks them for new roles. Admin can untick either.
--
-- Blast radius: one function replaced, two UPDATEs over employee_roles. No
-- table, policy or RPC is altered.
-- ============================================================

begin;

-- ── 1. The alias map ─────────────────────────────────────────
-- Retired key -> the right that now covers it. Kept as a function rather than a
-- table so it ships and rolls back with the code that depends on it, and so
-- has_permission stays a single inlinable SQL expression.
CREATE OR REPLACE FUNCTION public.route_permission_alias(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_key
    -- Editing a route IS managing the customers on it and when it runs.
    WHEN 'manage_route_customers'  THEN 'edit_routes'
    WHEN 'add_route_customers'     THEN 'edit_routes'
    WHEN 'remove_route_customers'  THEN 'edit_routes'
    WHEN 'reorder_route_customers' THEN 'edit_routes'
    WHEN 'manage_route_schedule'   THEN 'edit_routes'
    -- A clone is a new route; an archive is a soft delete.
    WHEN 'clone_routes'            THEN 'add_routes'
    WHEN 'archive_routes'          THEN 'delete_routes'
    -- Seeing the approvals queue is part of approving; assigning in the
    -- planner is the same manager decision.
    WHEN 'view_route_approvals'    THEN 'approve_routes'
    WHEN 'assign_routes'           THEN 'approve_routes'
    -- Health and executions are read-only views of routes you can already see.
    WHEN 'view_route_health'       THEN 'view_routes'
    WHEN 'view_route_executions'   THEN 'view_routes'
    -- Skipping a stop and visiting out of order are the same freedom.
    WHEN 'skip_route_stop'         THEN 'modify_route_sequence'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.route_permission_alias(text) IS
  'Retired granular route permission -> the simplified right that now covers it, or NULL if the '
  'key was never a route key. Lets migrations 110/111 keep checking their original key strings '
  'while the Roles editor offers nine rights instead of twenty.';

-- ── 2. has_permission honours it ─────────────────────────────
-- Rebuilt from 20260823140000. Everything there is unchanged; one OR branch is
-- added at the end. Order matters only for readability — it is an OR chain.
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_account_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.employee_roles er ON er.id = p.employee_role_id
    WHERE p.user_id = p_user_id
      AND p.account_id = p_account_id
      AND coalesce(p.status, 'active') = 'active'
      AND (
        p.account_role IN ('owner','admin')
        OR p.is_superadmin = true
        OR (er.permissions ->> 'all') = 'true'
        OR (er.permissions ->> p_key) = 'true'
        OR (er.permissions ->> (split_part(p_key, '_', 1) || '_*')) = 'true'
        OR (er.permissions ->> (
              CASE WHEN left(p_key, 7) = 'create_' THEN 'add_' || substr(p_key, 8)
                   WHEN left(p_key, 4) = 'add_'    THEN 'create_' || substr(p_key, 5) END
           )) = 'true'
        -- NEW: a retired route key is satisfied by the right that replaced it.
        OR (er.permissions ->> public.route_permission_alias(p_key)) = 'true'
      )
  );
$$;

-- ── 3. Nobody loses a right on deploy day ────────────────────
-- Any role that held a retired key now holds its survivor.
--
-- ONE ROW PER ROLE, not one per (role, survivor). The first draft grouped by
-- both and let `UPDATE ... FROM` match several source rows to the same role —
-- and in PostgreSQL, when the FROM side produces more than one row for a
-- target row, only ONE of them is applied and which one is not defined. A
-- supervisor holding both 'reorder_route_customers' and 'archive_routes' came
-- out with 'delete_routes' and no 'edit_routes': a right silently lost on
-- deploy day, which is the exact failure this backfill exists to prevent.
-- Scenario G12 caught it.
--
-- jsonb_object_agg collapses every survivor a role needs into a single object,
-- so the merge below is one well-defined rewrite per role.
--
-- `permissions` on an all-access role is {"all": true} and is left alone — the
-- || would add noise that the editor would then render as ticked boxes under a
-- heading that says "All".
UPDATE public.employee_roles er
   SET permissions = er.permissions || need.additions
  FROM (
    SELECT r.id AS role_id,
           jsonb_object_agg(public.route_permission_alias(k.key), true) AS additions
      FROM public.employee_roles r, jsonb_each_text(r.permissions) AS k(key, val)
     WHERE k.val = 'true'
       AND public.route_permission_alias(k.key) IS NOT NULL
       AND coalesce((r.permissions ->> 'all')::boolean, false) = false
     GROUP BY r.id
  ) AS need
 WHERE er.id = need.role_id
   -- Skip roles that already hold everything they would gain, so the table is
   -- not rewritten for nothing on a re-run.
   AND NOT (er.permissions @> need.additions);

-- ── 4. The two new field rules, ON by default ────────────────
-- The founder: "(A) Check-out selfie Compulsory or not? (B) Visit feedback
-- compulsory or not? by default they both should keep on."
--
-- These are require-style keys, like punch_selfie_required and unlike
-- order_without_checkin: ticked MEANS required. A brand-new role starts as {},
-- which would read as "not required", so every existing role is set explicitly
-- here and the roles editor pre-ticks them for new ones.
--
-- All-access roles are skipped for the same reason as §3 — `all` already
-- resolves true for every key, including these.
UPDATE public.employee_roles
   SET permissions = permissions
                  || jsonb_build_object('visit_checkout_selfie_required', true)
                  || jsonb_build_object('visit_feedback_required', true)
 WHERE coalesce((permissions ->> 'all')::boolean, false) = false
   AND (
         (permissions ->> 'visit_checkout_selfie_required') IS DISTINCT FROM 'true'
      OR (permissions ->> 'visit_feedback_required')        IS DISTINCT FROM 'true'
       );

commit;
