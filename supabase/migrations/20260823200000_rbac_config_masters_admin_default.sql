-- =====================================================================
-- Module-wise RBAC — config masters default to admin-only
--
-- payment_types / document_templates(templates) / quotation_terms were briefly
-- grandfathered onto every agent role (they had member-level RLS historically).
-- They are admin-config, so revert that grant: remove the keys from all non-all
-- roles so these masters + their settings menus default to admin-only, consistent
-- with the other masters. An admin can re-grant per role from the roles editor.
-- (Applied to prod 2026-08-23; recorded for repo/prod parity.)
-- =====================================================================
update public.employee_roles
set permissions = permissions
  - 'create_payment_types' - 'edit_payment_types'
  - 'create_document_templates' - 'edit_document_templates'
  - 'create_quotation_terms' - 'edit_quotation_terms'
where coalesce(permissions->>'all','')<>'true';
