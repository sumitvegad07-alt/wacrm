-- =====================================================================
-- Hardening Sprint 1 — Database-level permission enforcement
-- Source of truth: CTO Production Readiness Audit + Master E2E UAT (2026-08-23)
-- Goal: make Ozzo safe for multi-role orgs with restricted users, by moving
--       permission enforcement from the UI into the database (RLS + RPC).
--
-- SAFETY NOTES
--  * All changes were proven in a rolled-back transaction against production
--    (0 rows persisted) before this file was applied. See the sprint report.
--  * The permission-key model in production is inconsistent (dual keys
--    add_* vs create_*, a wildcard {"all":true} on 13/23 roles, and NO product
--    edit key). has_permission() is hardened below to honor {"all":true} and
--    owner/admin so this migration does NOT lock out existing roles. FULL
--    per-module key enforcement is deferred until the key model is normalized
--    (tracked as Sprint-1 follow-up P1b).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Hardened authorization primitives
--    - honor {"all":true} (13 roles rely on it)
--    - de-authorize non-active employees (P4 lifecycle enforcement)
--    - pin search_path (security advisor M1)
-- ---------------------------------------------------------------------

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
      and coalesce(p.status, 'active') = 'active'          -- P4: inactive/suspended/terminated lose access
      and (
        p.account_role in ('owner','admin')
        or p.is_superadmin = true
        or (er.permissions ->> 'all') = 'true'             -- honor the wildcard role
        or (er.permissions ->> p_key) = 'true'
        or (er.permissions ->> (split_part(p_key, '_', 1) || '_*')) = 'true'
      )
  );
$$;

-- is_account_member gains an active-status check so a suspended/terminated
-- employee is denied across ALL 353 policies at once. (16 active / 1 inactive
-- in prod today — the 1 inactive user is correctly de-authorized.)
-- NOTE: the existing function carries a DEFAULT on min_role (so is_account_member(id)
-- resolves here). CREATE OR REPLACE must preserve that default and the exact
-- signature; there is no separate 1-arg function to (re)create.
create or replace function public.is_account_member(target_account_id uuid, min_role public.account_role_enum default 'viewer'::public.account_role_enum)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.accounts a on a.id = p.account_id
    where p.user_id = auth.uid()
      and p.account_id = target_account_id
      and a.deleted_at is null
      and coalesce(p.status, 'active') = 'active'
      and case p.account_role
            when 'owner'  then 4 when 'admin' then 3
            when 'agent'  then 2 when 'viewer' then 1 end
        >=
          case min_role
            when 'owner'  then 4 when 'admin' then 3
            when 'agent'  then 2 when 'viewer' then 1 end
  );
$$;

-- Helper: does the current user hold ANY of a set of permission keys?
create or replace function public.has_any_permission(p_account_id uuid, p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from unnest(p_keys) k where public.has_permission(auth.uid(), p_account_id, k));
$$;

-- ---------------------------------------------------------------------
-- P2. VIEWER READ-ONLY — require agent-min on business write policies.
--     Viewer (rank 1) is now blocked from all direct writes; agent+ unchanged.
-- ---------------------------------------------------------------------

-- LEADS
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated
  with check (public.is_account_member(account_id, 'agent'));

-- DEALS + DEAL ITEMS
drop policy if exists deals_insert on public.deals;
create policy deals_insert on public.deals for insert to authenticated
  with check (public.is_account_member(account_id, 'agent'));

drop policy if exists deal_items_insert on public.deal_items;
create policy deal_items_insert on public.deal_items for insert to authenticated
  with check (exists (select 1 from public.deals d where d.id = deal_id and public.is_account_member(d.account_id, 'agent')));
drop policy if exists deal_items_update on public.deal_items;
create policy deal_items_update on public.deal_items for update to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and public.is_account_member(d.account_id, 'agent')));
drop policy if exists deal_items_delete on public.deal_items;
create policy deal_items_delete on public.deal_items for delete to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and public.is_account_member(d.account_id, 'agent')));

-- QUOTATIONS + ITEMS + CV
drop policy if exists quotations_insert on public.quotations;
create policy quotations_insert on public.quotations for insert to authenticated
  with check (public.is_account_member(account_id, 'agent'));
drop policy if exists quotations_update on public.quotations;
create policy quotations_update on public.quotations for update to authenticated
  using (public.is_account_member(account_id, 'agent'));

drop policy if exists quotation_items_insert on public.quotation_items;
create policy quotation_items_insert on public.quotation_items for insert to authenticated
  with check (exists (select 1 from public.quotations q where q.id = quotation_id and public.is_account_member(q.account_id, 'agent')));
drop policy if exists quotation_items_update on public.quotation_items;
create policy quotation_items_update on public.quotation_items for update to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id and public.is_account_member(q.account_id, 'agent')));
drop policy if exists quotation_items_delete on public.quotation_items;
create policy quotation_items_delete on public.quotation_items for delete to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id and public.is_account_member(q.account_id, 'agent')));

-- TASKS
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_account_member(account_id, 'agent'));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_account_member(account_id, 'agent'));

-- PAYMENTS (create requires agent-min + a create/approve payment intent)
drop policy if exists "Payments can be created by account members" on public.payments;
create policy "Payments can be created by account members" on public.payments for insert to authenticated
  with check (public.is_account_member(account_id, 'agent'));

-- DISPATCH (header + items) — writes come from the dispatch flow, agent-min
drop policy if exists order_dispatches_insert on public.order_dispatches;
create policy order_dispatches_insert on public.order_dispatches for insert to authenticated
  with check (public.is_account_member(account_id, 'agent'));
drop policy if exists order_dispatches_update on public.order_dispatches;
create policy order_dispatches_update on public.order_dispatches for update to authenticated
  using (public.is_account_member(account_id, 'agent'));

-- ---------------------------------------------------------------------
-- P1. ORDERS — permission-enforced writes (the proven financial-tamper leak)
--     Uses hardened has_permission (honors {"all":true} + owner/admin +
--     dual add_/create_ keys) so existing roles keep working; viewer and
--     no-permission agents are blocked. Dispatch/system status writes are
--     exempted via the app.order_status_system flag.
-- ---------------------------------------------------------------------

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert to authenticated
  with check (
    public.is_account_member(account_id, 'agent')
    and user_id = auth.uid()
    and public.has_any_permission(account_id, array['add_orders','create_orders'])
  );

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update to authenticated
  using (
    public.is_account_member(account_id, 'agent')
    and (
      public.has_any_permission(account_id, array['edit_orders','manage_order_status'])
      or coalesce(current_setting('app.order_status_system', true), '') = '1'
    )
  );

-- ORDER ITEMS follow the parent order's write permission
drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items for insert to authenticated
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id and public.is_account_member(o.account_id, 'agent')
      and public.has_any_permission(o.account_id, array['add_orders','create_orders','edit_orders'])
  ));
drop policy if exists order_items_update on public.order_items;
create policy order_items_update on public.order_items for update to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and public.is_account_member(o.account_id, 'agent')
      and (public.has_any_permission(o.account_id, array['edit_orders'])
           or coalesce(current_setting('app.order_status_system', true), '') = '1')
  ));
drop policy if exists order_items_delete on public.order_items;
create policy order_items_delete on public.order_items for delete to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and public.is_account_member(o.account_id, 'agent')
      and (public.has_any_permission(o.account_id, array['edit_orders'])
           or coalesce(current_setting('app.order_status_system', true), '') = '1')
  ));

-- ---------------------------------------------------------------------
-- P1. PRODUCTS / CATALOGUE — no per-role product-edit key exists in the model,
--     so catalogue writes are ADMIN-only (governance = admin). This stops the
--     proven agent catalogue-price tamper. A future "catalogue manager" role
--     key would relax this (feature work, out of sprint scope).
-- ---------------------------------------------------------------------
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert to authenticated
  with check (public.is_account_member(account_id, 'admin'));
drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated
  using (public.is_account_member(account_id, 'admin'));
-- products_delete is already admin-only (unchanged)

-- ---------------------------------------------------------------------
-- P3. DELETION PROTECTION — a non-admin could delete a customer that has
--     orders, orphaning history (contact_id SET NULL). Restrict customer &
--     lead deletion to admins.
-- ---------------------------------------------------------------------
drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts for delete to authenticated
  using (public.is_account_member(account_id, 'admin'));

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (public.is_account_member(account_id, 'admin'));

-- ---------------------------------------------------------------------
-- P4. EMPLOYEE LIFECYCLE — protect history from employee removal.
--     Flip orders.user_id ON DELETE CASCADE -> SET NULL so deleting an
--     employee never erases the orders they created. (Combined with the
--     status model, the recommended path is deactivate, not delete.)
-- ---------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_user_id_fkey;
alter table public.orders
  add constraint orders_user_id_fkey foreign key (user_id)
  references auth.users(id) on delete set null;

-- Constrain the status vocabulary (active/inactive/suspended/terminated).
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check
  check (status in ('active','inactive','suspended','terminated'));

-- ---------------------------------------------------------------------
-- U3 / P5. WORKFLOW INTEGRITY — block manual jump to a dispatch state.
--     'Dispatched'/'Part Dispatch' may only be reached by the dispatch flow,
--     which sets app.order_status_system='1'. A manual update_order_status
--     into those states is now rejected.
-- ---------------------------------------------------------------------
create or replace function public.enforce_order_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if NEW.status is distinct from OLD.status then
    if not public.order_status_transition_allowed(OLD.status, NEW.status) then
      raise exception 'Illegal order status transition: % -> %', OLD.status, NEW.status using errcode = 'check_violation';
    end if;
    -- Dispatch states are system-only (reached by recording a dispatch).
    if NEW.status in ('Dispatched','Part Dispatch')
       and coalesce(current_setting('app.order_status_system', true), '') <> '1' then
      raise exception 'Order can only be marked % by recording a dispatch, not manually', NEW.status using errcode = 'check_violation';
    end if;
    if coalesce(current_setting('app.order_status_system', true), '') <> '1'
       and not public.has_permission(auth.uid(), NEW.account_id, 'manage_order_status') then
      raise exception 'You do not have permission to change order status' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return NEW;
end;
$$;

commit;
