-- =====================================================================
-- Module-wise RBAC — login-access grandfather defaults
--
-- The web login gate now reads the ROLE's web_access permission (set via the
-- roles editor "Login Access" section). Seed web_access + mobile_access = true
-- on existing non-all roles so no current user is locked out; only an explicit
-- untick (which stores the key = false) then denies that surface.
-- (Applied to prod 2026-08-23; recorded for repo/prod parity.)
-- =====================================================================
update public.employee_roles
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object('web_access','true','mobile_access','true')
where coalesce(permissions->>'all','')<>'true'
  and not (coalesce(permissions->>'web_access','')='true' and coalesce(permissions->>'mobile_access','')='true');
