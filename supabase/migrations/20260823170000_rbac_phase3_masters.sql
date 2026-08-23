-- =====================================================================
-- Module-wise RBAC Phase 3 (Batch 2) — key-enforce masters
--
-- 13 admin-only masters become key-gated (expand-only: admins keep access via
-- bypass, agents get it only when granted — no backfill needed). 3 member-level
-- masters (payment types, document/PDF templates, quotation terms) were
-- agent-writable, so their create/edit keys are grandfathered onto existing
-- non-all roles first, then key-gated. Viewer stays read-only via the agent floor.
--
-- Dry-run verified against live policy names before apply.
-- =====================================================================

-- Grandfather the member-level masters (agents currently create/edit these).
update public.employee_roles
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'create_payment_types','true','edit_payment_types','true',
  'create_document_templates','true','edit_document_templates','true',
  'create_quotation_terms','true','edit_quotation_terms','true')
where coalesce(permissions->>'all','')<>'true';

-- Admin-only masters (expand-only). tbl -> permission base.
do $$
declare r record;
begin
  for r in select * from (values
    ('lead_sources','lead_sources'),('lead_statuses','lead_statuses'),('lead_industries','lead_industries'),
    ('tax_slabs','tax_slabs'),('product_units','product_units'),('product_categories','product_categories'),
    ('price_lists','price_lists'),('pipelines','pipelines'),('geofences','geofences'),
    ('leave_types','leave_types'),('holidays','holidays'),('holiday_lists','holidays'),('custom_fields','custom_fields')
  ) as t(tbl, base) loop
    execute format('drop policy if exists %I on public.%I', r.tbl||'_insert', r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_account_member(account_id,''agent'') and public.has_permission(auth.uid(),account_id,%L))', r.tbl||'_insert', r.tbl, 'create_'||r.base);
    execute format('drop policy if exists %I on public.%I', r.tbl||'_update', r.tbl);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_account_member(account_id,''agent'') and public.has_permission(auth.uid(),account_id,%L))', r.tbl||'_update', r.tbl, 'edit_'||r.base);
    execute format('drop policy if exists %I on public.%I', r.tbl||'_delete', r.tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_account_member(account_id,''agent'') and public.has_permission(auth.uid(),account_id,%L))', r.tbl||'_delete', r.tbl, 'delete_'||r.base);
  end loop;
end $$;

-- Member-level masters (drop their non-standard old policy names) -> keyed.
drop policy if exists "Payment types can be created by account members" on public.payment_types;
drop policy if exists "Payment types can be updated by account members" on public.payment_types;
drop policy if exists "Payment types can be deleted by admins" on public.payment_types;
create policy payment_types_insert on public.payment_types for insert to authenticated with check (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'create_payment_types'));
create policy payment_types_update on public.payment_types for update to authenticated using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'edit_payment_types'));
create policy payment_types_delete on public.payment_types for delete to authenticated using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'delete_payment_types'));

drop policy if exists "Document templates can be created by account members" on public.document_templates;
drop policy if exists "Document templates can be updated by permitted members" on public.document_templates;
drop policy if exists "Document templates can be deleted by admins" on public.document_templates;
create policy document_templates_insert on public.document_templates for insert to authenticated with check (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'create_document_templates'));
create policy document_templates_update on public.document_templates for update to authenticated using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'edit_document_templates'));
create policy document_templates_delete on public.document_templates for delete to authenticated using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'delete_document_templates'));

drop policy if exists quotation_terms_insert on public.quotation_terms_templates;
drop policy if exists quotation_terms_update on public.quotation_terms_templates;
drop policy if exists quotation_terms_delete on public.quotation_terms_templates;
create policy quotation_terms_insert on public.quotation_terms_templates for insert to authenticated with check (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'create_quotation_terms'));
create policy quotation_terms_update on public.quotation_terms_templates for update to authenticated using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'edit_quotation_terms'));
create policy quotation_terms_delete on public.quotation_terms_templates for delete to authenticated using (public.is_account_member(account_id,'agent') and public.has_permission(auth.uid(),account_id,'delete_quotation_terms'));
