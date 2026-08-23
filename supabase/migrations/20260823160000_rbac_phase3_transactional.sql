-- =====================================================================
-- Module-wise RBAC Phase 3 (Batch 1) — key-enforce Dispatch / Deals / Quotations
-- Spec: docs/engineering/specifications/module-wise-rbac-v1.md
--
-- These tables were agent-open (any agent could write). Enforcing the new keys
-- would remove that ability from existing staff, so we FIRST grandfather the
-- keys onto every existing non-all role (preserving today's behavior), THEN
-- gate the writes. Admins can then untick to restrict. Viewer stays read-only
-- via the is_account_member(...,'agent') floor.
--
-- Proven live in a rolled-back transaction before apply.
-- =====================================================================

begin;

-- 1) Grandfather-backfill: preserve current agent access. Roles with {"all":true}
--    already bypass, so skip them. Only add keys agents actually had today:
--    dispatch insert/update (create/edit), deals insert/delete (create/delete),
--    quotations insert/update (create/edit). Delete-dispatch / delete-quotations
--    were admin-only, so they are NOT backfilled (keying them only expands).
update public.employee_roles
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
      'create_dispatch', 'true',
      'edit_dispatch', 'true',
      'create_deals', 'true',
      'delete_deals', 'true',
      'create_quotations', 'true',
      'edit_quotations', 'true'
    )
where coalesce(permissions ->> 'all', '') <> 'true';

-- 2) Enforcement — Dispatch
drop policy if exists order_dispatches_insert on public.order_dispatches;
create policy order_dispatches_insert on public.order_dispatches for insert to authenticated
  with check (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'create_dispatch'));
drop policy if exists order_dispatches_update on public.order_dispatches;
create policy order_dispatches_update on public.order_dispatches for update to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'edit_dispatch'));
drop policy if exists order_dispatches_delete on public.order_dispatches;
create policy order_dispatches_delete on public.order_dispatches for delete to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'delete_dispatch'));

drop policy if exists dispatch_items_insert on public.dispatch_items;
create policy dispatch_items_insert on public.dispatch_items for insert to authenticated
  with check (exists (select 1 from public.order_dispatches d where d.id = dispatch_id
    and public.is_account_member(d.account_id,'agent')
    and (public.has_permission(auth.uid(),d.account_id,'create_dispatch') or public.has_permission(auth.uid(),d.account_id,'edit_dispatch'))));
drop policy if exists dispatch_items_update on public.dispatch_items;
create policy dispatch_items_update on public.dispatch_items for update to authenticated
  using (exists (select 1 from public.order_dispatches d where d.id = dispatch_id
    and public.is_account_member(d.account_id,'agent') and public.has_permission(auth.uid(),d.account_id,'edit_dispatch')));
drop policy if exists dispatch_items_delete on public.dispatch_items;
create policy dispatch_items_delete on public.dispatch_items for delete to authenticated
  using (exists (select 1 from public.order_dispatches d where d.id = dispatch_id
    and public.is_account_member(d.account_id,'agent') and public.has_permission(auth.uid(),d.account_id,'edit_dispatch')));

-- 3) Enforcement — Deals
drop policy if exists deals_insert on public.deals;
create policy deals_insert on public.deals for insert to authenticated
  with check (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'create_deals'));
drop policy if exists deals_update on public.deals;
create policy deals_update on public.deals for update to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'edit_deals'));
drop policy if exists deals_delete on public.deals;
create policy deals_delete on public.deals for delete to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'delete_deals'));

drop policy if exists deal_items_insert on public.deal_items;
create policy deal_items_insert on public.deal_items for insert to authenticated
  with check (exists (select 1 from public.deals d where d.id = deal_id
    and public.is_account_member(d.account_id,'agent')
    and (public.has_permission(auth.uid(),d.account_id,'create_deals') or public.has_permission(auth.uid(),d.account_id,'edit_deals'))));
drop policy if exists deal_items_update on public.deal_items;
create policy deal_items_update on public.deal_items for update to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id
    and public.is_account_member(d.account_id,'agent') and public.has_permission(auth.uid(),d.account_id,'edit_deals')));
drop policy if exists deal_items_delete on public.deal_items;
create policy deal_items_delete on public.deal_items for delete to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id
    and public.is_account_member(d.account_id,'agent') and public.has_permission(auth.uid(),d.account_id,'edit_deals')));

-- 4) Enforcement — Quotations
drop policy if exists quotations_insert on public.quotations;
create policy quotations_insert on public.quotations for insert to authenticated
  with check (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'create_quotations'));
drop policy if exists quotations_update on public.quotations;
create policy quotations_update on public.quotations for update to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'edit_quotations'));
drop policy if exists quotations_delete on public.quotations;
create policy quotations_delete on public.quotations for delete to authenticated
  using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'delete_quotations'));

drop policy if exists quotation_items_insert on public.quotation_items;
create policy quotation_items_insert on public.quotation_items for insert to authenticated
  with check (exists (select 1 from public.quotations q where q.id = quotation_id
    and public.is_account_member(q.account_id,'agent')
    and (public.has_permission(auth.uid(),q.account_id,'create_quotations') or public.has_permission(auth.uid(),q.account_id,'edit_quotations'))));
drop policy if exists quotation_items_update on public.quotation_items;
create policy quotation_items_update on public.quotation_items for update to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id
    and public.is_account_member(q.account_id,'agent') and public.has_permission(auth.uid(),q.account_id,'edit_quotations')));
drop policy if exists quotation_items_delete on public.quotation_items;
create policy quotation_items_delete on public.quotation_items for delete to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id
    and public.is_account_member(q.account_id,'agent') and public.has_permission(auth.uid(),q.account_id,'edit_quotations')));

commit;
