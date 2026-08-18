-- deal_custom_values and task_custom_values had RLS enabled with ZERO policies,
-- which means deny-all: custom field values on deals and tasks were unreadable
-- and unwritable by every end user. Mirrors the lead_custom_values pattern,
-- scoping through the parent row's account.
--
-- One deliberate difference: the sibling policies specify USING on UPDATE but no
-- WITH CHECK, which lets a permitted row be re-pointed at a parent in another
-- account. These include WITH CHECK so the post-update row must also pass.
--
-- Applied to production 2026-08-18.

-- ---------- deal_custom_values ----------
create policy deal_cv_select on public.deal_custom_values
  for select using (
    exists (select 1 from deals d
            where d.id = deal_custom_values.deal_id
              and is_account_member(d.account_id))
  );

create policy deal_cv_insert on public.deal_custom_values
  for insert with check (
    exists (select 1 from deals d
            where d.id = deal_custom_values.deal_id
              and is_account_member(d.account_id, 'agent'::account_role_enum))
  );

create policy deal_cv_update on public.deal_custom_values
  for update using (
    exists (select 1 from deals d
            where d.id = deal_custom_values.deal_id
              and is_account_member(d.account_id, 'agent'::account_role_enum))
  ) with check (
    exists (select 1 from deals d
            where d.id = deal_custom_values.deal_id
              and is_account_member(d.account_id, 'agent'::account_role_enum))
  );

create policy deal_cv_delete on public.deal_custom_values
  for delete using (
    exists (select 1 from deals d
            where d.id = deal_custom_values.deal_id
              and is_account_member(d.account_id, 'admin'::account_role_enum))
  );

-- ---------- task_custom_values ----------
create policy task_cv_select on public.task_custom_values
  for select using (
    exists (select 1 from tasks t
            where t.id = task_custom_values.task_id
              and is_account_member(t.account_id))
  );

create policy task_cv_insert on public.task_custom_values
  for insert with check (
    exists (select 1 from tasks t
            where t.id = task_custom_values.task_id
              and is_account_member(t.account_id, 'agent'::account_role_enum))
  );

create policy task_cv_update on public.task_custom_values
  for update using (
    exists (select 1 from tasks t
            where t.id = task_custom_values.task_id
              and is_account_member(t.account_id, 'agent'::account_role_enum))
  ) with check (
    exists (select 1 from tasks t
            where t.id = task_custom_values.task_id
              and is_account_member(t.account_id, 'agent'::account_role_enum))
  );

create policy task_cv_delete on public.task_custom_values
  for delete using (
    exists (select 1 from tasks t
            where t.id = task_custom_values.task_id
              and is_account_member(t.account_id, 'admin'::account_role_enum))
  );
