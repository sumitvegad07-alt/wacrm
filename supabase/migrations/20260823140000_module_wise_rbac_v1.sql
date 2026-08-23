-- =====================================================================
-- Module-wise RBAC v1 — key-gated writes for Catalogue/Customers/Orders
-- Spec: docs/engineering/specifications/module-wise-rbac-v1.md
-- Follows Hardening Sprint 1. Replaces the Sprint-1 admin-only shortcuts on
-- products/contacts/leads/orders-delete with real per-key gates, so the Roles
-- editor checkboxes actually work (e.g. delete_contacts, create_products).
--
-- NON-BREAKING: every action gated here was admin-only after Sprint 1, so
-- keying it only EXPANDS what an admin can grant an agent — it removes nothing.
-- Viewer stays read-only via the is_account_member(...,'agent') floor even if a
-- key is ticked. Proven live in a rolled-back transaction (6/6) before apply.
-- =====================================================================

begin;

-- has_permission gains the add_/create_ bidirectional alias (mirrors the client
-- rbac.ts), so a single canonical key in a policy also matches the legacy spelling.
create or replace function public.has_permission(p_user_id uuid, p_account_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.employee_roles er on er.id = p.employee_role_id
    where p.user_id = p_user_id
      and p.account_id = p_account_id
      and coalesce(p.status, 'active') = 'active'
      and (
        p.account_role in ('owner','admin')
        or p.is_superadmin = true
        or (er.permissions ->> 'all') = 'true'
        or (er.permissions ->> p_key) = 'true'
        or (er.permissions ->> (split_part(p_key, '_', 1) || '_*')) = 'true'
        or (er.permissions ->> (
              case when left(p_key, 7) = 'create_' then 'add_' || substr(p_key, 8)
                   when left(p_key, 4) = 'add_'    then 'create_' || substr(p_key, 5) end
           )) = 'true'
      )
  );
$$;

-- Catalogue (products): create/edit/delete are now per-key (was admin-only).
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert to authenticated
  with check (public.is_account_member(account_id, 'agent') and public.has_permission(auth.uid(), account_id, 'create_products'));
drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated
  using (public.is_account_member(account_id, 'agent') and public.has_permission(auth.uid(), account_id, 'edit_products'));
drop policy if exists products_delete on public.products;
create policy products_delete on public.products for delete to authenticated
  using (public.is_account_member(account_id, 'agent') and public.has_permission(auth.uid(), account_id, 'delete_products'));

-- Customers / Leads / Orders: delete is now per-key (was admin-only).
drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts for delete to authenticated
  using (public.is_account_member(account_id, 'agent') and public.has_permission(auth.uid(), account_id, 'delete_contacts'));

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (public.is_account_member(account_id, 'agent') and public.has_permission(auth.uid(), account_id, 'delete_leads'));

drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders for delete to authenticated
  using (public.is_account_member(account_id, 'agent') and public.has_permission(auth.uid(), account_id, 'delete_orders'));

commit;
