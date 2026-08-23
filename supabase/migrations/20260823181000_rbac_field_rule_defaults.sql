-- =====================================================================
-- Module-wise RBAC — field-rule grandfather defaults (for the mobile build)
--
-- The mobile "field rules" (order/payment without visit check-in, visit without
-- attendance punch-in) are enforced INSIDE the Android app. Before that build
-- ships, seed the permissive defaults onto existing non-all roles so current
-- field reps keep today's freedom (they can act without a check-in/punch-in).
-- The 'required' rules (punch selfie, odometer photo) are intentionally left
-- unset: absent = not required = today's behavior.
-- (Already applied to prod 2026-08-23; recorded here for repo/prod parity.)
-- =====================================================================
update public.employee_roles
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'order_without_checkin','true',
  'payment_without_checkin','true',
  'visit_without_punchin','true')
where coalesce(permissions->>'all','')<>'true';
