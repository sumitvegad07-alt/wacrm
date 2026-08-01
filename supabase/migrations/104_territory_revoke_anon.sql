-- ============================================================
-- 104_territory_revoke_anon.sql
--
-- Tighten the Territory Master RPCs: revoke EXECUTE from the `anon` role.
-- They already self-reject unauthenticated callers (is_account_member() is
-- false when auth.uid() is NULL → 42501), but the security advisor flags
-- anon-executable SECURITY DEFINER functions, so we remove the grant entirely.
-- Only signed-in members (further gated to admins inside each function) may call.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.territory_archive(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.territory_restore(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.territory_delete(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.territory_assign_employee_areas(uuid, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.territory_update_settings(uuid, jsonb, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.territory_migrate_contact_geo(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.territory_bulk_seed(uuid, jsonb, jsonb, jsonb) FROM anon;
