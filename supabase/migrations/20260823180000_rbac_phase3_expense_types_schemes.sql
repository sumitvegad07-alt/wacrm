-- =====================================================================
-- Module-wise RBAC Phase 3 (Batch 3, final DB) — expense_types + schemes
--
-- expense_types and the scheme tables (header + slabs/products/customers) were
-- admin-only via FOR ALL policies. Key-gate them (expand-only: admins keep
-- access via bypass, agents only when granted — no backfill). Scheme children
-- are gated on create_schemes OR edit_schemes via the parent scheme so a
-- granted agent can build a whole scheme (header + slabs) without a mismatch.
-- Dry-run verified before apply.
-- =====================================================================

-- expense_types (FOR ALL admin -> split keyed)
drop policy if exists expense_types_all on public.expense_types;
create policy expense_types_insert on public.expense_types for insert to authenticated
  with check (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'create_expense_types'));
create policy expense_types_update on public.expense_types for update to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'edit_expense_types'));
create policy expense_types_delete on public.expense_types for delete to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'delete_expense_types'));

-- schemes header
drop policy if exists schemes_insert on public.schemes;
create policy schemes_insert on public.schemes for insert to authenticated
  with check (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'create_schemes'));
drop policy if exists schemes_update on public.schemes;
create policy schemes_update on public.schemes for update to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'edit_schemes'));
drop policy if exists schemes_delete on public.schemes;
create policy schemes_delete on public.schemes for delete to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'delete_schemes'));

-- scheme children (no account_id -> via parent scheme)
do $$
declare tbl text;
begin
  foreach tbl in array array['scheme_slabs','scheme_products','scheme_customers'] loop
    execute format('drop policy if exists %I on public.%I', tbl||'_write', tbl);
    execute format($f$create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.schemes s where s.id = scheme_id and public.is_account_member(s.account_id,'agent') and (public.has_permission(auth.uid(),s.account_id,'create_schemes') or public.has_permission(auth.uid(),s.account_id,'edit_schemes'))))$f$, tbl||'_insert', tbl);
    execute format($f$create policy %I on public.%I for update to authenticated using (exists (select 1 from public.schemes s where s.id = scheme_id and public.is_account_member(s.account_id,'agent') and public.has_permission(auth.uid(),s.account_id,'edit_schemes')))$f$, tbl||'_update', tbl);
    execute format($f$create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.schemes s where s.id = scheme_id and public.is_account_member(s.account_id,'agent') and public.has_permission(auth.uid(),s.account_id,'edit_schemes')))$f$, tbl||'_delete', tbl);
  end loop;
end $$;
