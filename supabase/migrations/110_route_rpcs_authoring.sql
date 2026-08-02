-- 110_route_rpcs_authoring.sql
-- Route Management V1 — authoring RPCs (Phase 1b, hardened per CTO review 2026-08-02).
-- Spec: docs/engineering/specifications/route-management.md (Revision 3).
-- All SECURITY INVOKER (RLS + tenancy apply), WHERE-qualified writes (pg_safeupdate),
-- idempotent where relevant, each logs to module_activities.
-- account_id is derived from the caller's profile — never taken from the client.

-- ===========================================================================
-- 0. SCHEMA ADDITION — optimistic-concurrency version column on routes
-- ===========================================================================
alter table public.routes add column if not exists version integer not null default 0;

-- ===========================================================================
-- 1. SHARED HELPERS (one rule per concern)
-- ===========================================================================

-- 1.1 Module must be enabled before any authoring/execution mutation.
create or replace function public._route_assert_module(p_account uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if not coalesce((select (module_settings->>'route')::boolean from public.accounts where id = p_account), false) then
    raise exception 'Route Management is not enabled for this account' using errcode = '42501';
  end if;
end;
$$;

-- 1.2 THE single customer-eligibility rule: contact is in-account and sits in a
--     territory assigned to the route's primary assignee.
create or replace function public._route_contact_eligible(p_account uuid, p_assignee_id uuid, p_contact_id uuid)
returns boolean
language sql security invoker set search_path = public stable
as $$
  select exists (
    select 1
    from public.contacts c
    where c.id = p_contact_id
      and c.account_id = p_account
      and c.territory_id is not null
      and c.territory_id = any (employee_area_territory_ids(
            (select user_id from public.profiles where id = p_assignee_id)))
  );
$$;

-- 1.3 Assert the caller may edit this route (module on + permission + own/admin + not archived).
create or replace function public._route_assert_editable(p_route_id uuid, p_perm text)
returns public.routes
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  select * into v_route from public.routes where id = p_route_id;
  if not found then
    raise exception 'Route not found' using errcode = '42501';
  end if;
  perform public._route_assert_module(v_route.account_id);
  if p_perm is not null and not has_permission(v_uid, v_account, p_perm) then
    raise exception 'Permission denied: %', p_perm using errcode = '42501';
  end if;
  if not is_account_member(v_account, 'admin')
     and v_route.created_by <> v_uid
     and (v_route.primary_assignee_id is null
          or v_route.primary_assignee_id not in (select id from public.profiles where user_id = v_uid)) then
    raise exception 'You can only modify your own routes' using errcode = '42501';
  end if;
  if v_route.status = 'archived' then
    raise exception 'Archived routes cannot be modified; restore it first' using errcode = '23514';
  end if;
  return v_route;
end;
$$;

-- ===========================================================================
-- 2. route_upsert — create or edit; optionally set the exact customer set.
--    Optimistic concurrency via p_expected_version (NULL = skip check, e.g. create/offline).
--    Customer eligibility uses the shared rule and REJECTS ineligible/cross-route.
-- ===========================================================================
create or replace function public.route_upsert(
  p_route_id uuid,
  p_name text,
  p_description text default null,
  p_primary_assignee_id uuid default null,
  p_customer_ids uuid[] default null,
  p_expected_version integer default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_i int;
  v_cid uuid;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  if v_account is null then
    raise exception 'No profile for current user' using errcode = '42501';
  end if;
  perform public._route_assert_module(v_account);

  select * into v_route from public.routes where id = p_route_id;

  if not found then
    if not has_permission(v_uid, v_account, 'add_routes') then
      raise exception 'Not allowed to create routes' using errcode = '42501';
    end if;
    if p_name is null or btrim(p_name) = '' then
      raise exception 'Route name is required' using errcode = '23514';
    end if;
    insert into public.routes(id, account_id, name, description, primary_assignee_id, created_by, status)
      values (p_route_id, v_account, btrim(p_name), p_description, p_primary_assignee_id, v_uid, 'draft')
      returning * into v_route;
    insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
      values (v_account, v_uid, 'route', v_route.id, 'route_created', 'Route created',
              jsonb_build_object('name', v_route.name));
  else
    v_route := public._route_assert_editable(p_route_id, 'edit_routes');
    -- optimistic concurrency
    if p_expected_version is not null and p_expected_version <> v_route.version then
      raise exception 'Route was modified by someone else (expected v%, found v%). Reload and retry.',
        p_expected_version, v_route.version using errcode = '40001';
    end if;
    update public.routes
      set name = coalesce(nullif(btrim(p_name), ''), name),
          description = p_description,
          primary_assignee_id = p_primary_assignee_id,
          version = version + 1
      where id = p_route_id
      returning * into v_route;
    insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
      values (v_account, v_uid, 'route', v_route.id, 'route_edited', 'Route edited',
              jsonb_build_object('name', v_route.name));
  end if;

  -- Optional: set the exact customer set (sequence = array order). NULL = leave unchanged.
  if p_customer_ids is not null then
    if array_length(p_customer_ids, 1) is not null and v_route.primary_assignee_id is null then
      raise exception 'Set a primary assignee before adding customers' using errcode = '23514';
    end if;
    -- enforce the single eligibility rule (reject, since this is an explicit set)
    if array_length(p_customer_ids, 1) is not null then
      foreach v_cid in array p_customer_ids loop
        if not public._route_contact_eligible(v_account, v_route.primary_assignee_id, v_cid) then
          raise exception 'Customer % is not in the primary assignee''s territory', v_cid using errcode = '23514';
        end if;
      end loop;
    end if;
    delete from public.route_customers
      where route_id = p_route_id
        and (array_length(p_customer_ids, 1) is null or contact_id <> all(p_customer_ids));
    if array_length(p_customer_ids, 1) is not null then
      begin
        for v_i in 1 .. array_length(p_customer_ids, 1) loop
          insert into public.route_customers(account_id, route_id, contact_id, sequence)
            values (v_account, p_route_id, p_customer_ids[v_i], v_i)
            on conflict (route_id, contact_id) do update
              set sequence = excluded.sequence, archived_at = null;
        end loop;
      exception when unique_violation then
        raise exception 'One or more customers already belong to another route' using errcode = '23505';
      end;
    end if;
    update public.routes set version = version + 1 where id = p_route_id returning * into v_route;
    insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
      values (v_account, v_uid, 'route', p_route_id, 'customers_reordered', 'Customers set',
              jsonb_build_object('order', to_jsonb(p_customer_ids)));
  end if;

  return to_jsonb(v_route);
end;
$$;

-- ===========================================================================
-- 3. route_import_customers — bulk import eligible, not-already-routed contacts.
--    Uses the shared eligibility rule; SKIPS ineligible (bulk), reports counts.
-- ===========================================================================
create or replace function public.route_import_customers(
  p_route_id uuid,
  p_mode text default 'all',
  p_contact_ids uuid[] default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_maxseq int;
  v_added int := 0;
  v_skipped_routed int := 0;
  v_skipped_inelig int := 0;
  r record;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  v_route := public._route_assert_editable(p_route_id, 'add_route_customers');
  if v_route.primary_assignee_id is null then
    raise exception 'Set a primary assignee before importing customers' using errcode = '23514';
  end if;
  select coalesce(max(sequence), 0) into v_maxseq from public.route_customers where route_id = p_route_id;

  for r in
    select c.id
    from public.contacts c
    where c.account_id = v_account
      and (p_mode <> 'select' or c.id = any (coalesce(p_contact_ids, '{}'::uuid[])))
    order by c.company nulls last, c.name nulls last
  loop
    if not public._route_contact_eligible(v_account, v_route.primary_assignee_id, r.id) then
      v_skipped_inelig := v_skipped_inelig + 1;
      continue;
    end if;
    if exists (select 1 from public.route_customers rc where rc.contact_id = r.id and rc.archived_at is null) then
      v_skipped_routed := v_skipped_routed + 1;
      continue;
    end if;
    v_maxseq := v_maxseq + 1;
    insert into public.route_customers(account_id, route_id, contact_id, sequence)
      values (v_account, p_route_id, r.id, v_maxseq)
      on conflict (route_id, contact_id) do nothing;
    v_added := v_added + 1;
  end loop;

  if v_added > 0 then
    update public.routes set version = version + 1 where id = p_route_id;
  end if;
  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', p_route_id, 'customer_added', 'Customers imported',
            jsonb_build_object('count', v_added, 'mode', p_mode));

  return jsonb_build_object('added', v_added,
                            'skipped_already_routed', v_skipped_routed,
                            'skipped_ineligible', v_skipped_inelig);
end;
$$;

-- ===========================================================================
-- 4. route_add_customers — append specific customers (eligibility + cross-route).
-- ===========================================================================
create or replace function public.route_add_customers(p_route_id uuid, p_contact_ids uuid[])
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_maxseq int;
  v_added int := 0;
  v_skipped_routed int := 0;
  v_skipped_inelig int := 0;
  v_cid uuid;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  v_route := public._route_assert_editable(p_route_id, 'add_route_customers');
  if v_route.primary_assignee_id is null then
    raise exception 'Set a primary assignee before adding customers' using errcode = '23514';
  end if;
  select coalesce(max(sequence), 0) into v_maxseq from public.route_customers where route_id = p_route_id;
  foreach v_cid in array coalesce(p_contact_ids, '{}'::uuid[]) loop
    if not public._route_contact_eligible(v_account, v_route.primary_assignee_id, v_cid) then
      v_skipped_inelig := v_skipped_inelig + 1;
      continue;
    end if;
    if exists (select 1 from public.route_customers rc where rc.contact_id = v_cid and rc.archived_at is null) then
      v_skipped_routed := v_skipped_routed + 1;
      continue;
    end if;
    begin
      insert into public.route_customers(account_id, route_id, contact_id, sequence)
        values (v_account, p_route_id, v_cid, v_maxseq + 1);
      v_maxseq := v_maxseq + 1;
      v_added := v_added + 1;
    exception when unique_violation then
      v_skipped_routed := v_skipped_routed + 1;
    end;
  end loop;
  if v_added > 0 then
    update public.routes set version = version + 1 where id = p_route_id;
  end if;
  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', p_route_id, 'customer_added', 'Customers added',
            jsonb_build_object('count', v_added));
  return jsonb_build_object('added', v_added,
                            'skipped_already_routed', v_skipped_routed,
                            'skipped_ineligible', v_skipped_inelig);
end;
$$;

-- ===========================================================================
-- 5. route_remove_customer — remove one customer and resequence.
-- ===========================================================================
create or replace function public.route_remove_customer(p_route_id uuid, p_contact_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  v_route := public._route_assert_editable(p_route_id, 'remove_route_customers');
  delete from public.route_customers where route_id = p_route_id and contact_id = p_contact_id;
  with ordered as (
    select id, row_number() over (order by sequence) as rn
    from public.route_customers where route_id = p_route_id
  )
  update public.route_customers rc
    set sequence = o.rn
    from ordered o
    where rc.id = o.id and rc.route_id = p_route_id;
  update public.routes set version = version + 1 where id = p_route_id;
  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', p_route_id, 'customer_removed', 'Customer removed',
            jsonb_build_object('contact_id', p_contact_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- ===========================================================================
-- 6. route_reorder_customers — rewrite the full sequence in one transaction.
-- ===========================================================================
create or replace function public.route_reorder_customers(p_route_id uuid, p_ordered_contact_ids uuid[])
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_i int;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  v_route := public._route_assert_editable(p_route_id, 'reorder_route_customers');
  if p_ordered_contact_ids is not null then
    for v_i in 1 .. array_length(p_ordered_contact_ids, 1) loop
      update public.route_customers
        set sequence = v_i
        where route_id = p_route_id and contact_id = p_ordered_contact_ids[v_i];
    end loop;
  end if;
  update public.routes set version = version + 1 where id = p_route_id;
  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', p_route_id, 'customers_reordered', 'Customers reordered',
            jsonb_build_object('order', to_jsonb(p_ordered_contact_ids)));
  return jsonb_build_object('ok', true);
end;
$$;

-- ===========================================================================
-- 7. route_update_status — state machine + archive/restore side effects.
-- ===========================================================================
create or replace function public.route_update_status(p_route_id uuid, p_new_status text, p_reason text default null)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_old text;
  v_approval text;
  v_is_owner boolean;
  v_action text;
  v_ok boolean := false;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  select * into v_route from public.routes where id = p_route_id;
  if not found then raise exception 'Route not found' using errcode = '42501'; end if;
  perform public._route_assert_module(v_route.account_id);
  v_old := v_route.status;
  v_approval := coalesce((select settings->'route_settings'->>'approval_mode' from public.accounts where id = v_account), 'none');
  v_is_owner := is_account_member(v_account, 'admin')
                or v_route.created_by = v_uid
                or v_route.primary_assignee_id in (select id from public.profiles where user_id = v_uid);

  if v_old = 'draft' and p_new_status = 'pending_approval' then
    if not has_permission(v_uid, v_account, 'edit_routes') or not v_is_owner then
      raise exception 'Not allowed to submit this route' using errcode = '42501';
    end if;
    v_action := 'route_submitted'; v_ok := true;
  elsif v_old = 'draft' and p_new_status = 'active' and v_approval = 'none' then
    if not has_permission(v_uid, v_account, 'edit_routes') or not v_is_owner then
      raise exception 'Not allowed to activate this route' using errcode = '42501';
    end if;
    v_action := 'route_activated'; v_ok := true;
  elsif v_old = 'pending_approval' and p_new_status = 'active' then
    if not has_permission(v_uid, v_account, 'approve_routes') then
      raise exception 'Not allowed to approve routes' using errcode = '42501';
    end if;
    v_action := 'route_approved'; v_ok := true;
  elsif v_old = 'pending_approval' and p_new_status = 'rejected' then
    if not has_permission(v_uid, v_account, 'approve_routes') then
      raise exception 'Not allowed to reject routes' using errcode = '42501';
    end if;
    v_action := 'route_rejected'; v_ok := true;
  elsif v_old = 'rejected' and p_new_status = 'draft' then
    if not has_permission(v_uid, v_account, 'edit_routes') or not v_is_owner then
      raise exception 'Not allowed to reopen this route' using errcode = '42501';
    end if;
    v_action := 'route_reopened'; v_ok := true;
  elsif v_old = 'active' and p_new_status = 'archived' then
    if not has_permission(v_uid, v_account, 'archive_routes') or not v_is_owner then
      raise exception 'Not allowed to archive this route' using errcode = '42501';
    end if;
    v_action := 'route_archived'; v_ok := true;
  elsif v_old = 'archived' and p_new_status = 'active' then
    if not has_permission(v_uid, v_account, 'archive_routes') then
      raise exception 'Not allowed to restore routes' using errcode = '42501';
    end if;
    v_action := 'route_restored'; v_ok := true;
  end if;

  if not v_ok then
    raise exception 'Illegal route status transition % -> %', v_old, p_new_status using errcode = '23514';
  end if;

  if p_new_status = 'archived' then
    update public.routes set status = 'archived', archived_at = now(), version = version + 1 where id = p_route_id;
    update public.route_customers set archived_at = now() where route_id = p_route_id and archived_at is null;
  elsif v_old = 'archived' and p_new_status = 'active' then
    begin
      update public.route_customers set archived_at = null where route_id = p_route_id and archived_at is not null;
    exception when unique_violation then
      raise exception 'A customer on this route now belongs to another route; remove it there before restoring'
        using errcode = '23505';
    end;
    update public.routes set status = 'active', archived_at = null, version = version + 1 where id = p_route_id;
  else
    update public.routes set status = p_new_status, version = version + 1 where id = p_route_id;
  end if;

  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', p_route_id, v_action,
            format('Status %s -> %s', v_old, p_new_status),
            jsonb_build_object('from', v_old, 'to', p_new_status, 'reason', p_reason));
  return jsonb_build_object('status', p_new_status);
end;
$$;

-- ===========================================================================
-- 8. route_clone — copy the header only (one-customer-one-route ⇒ no customer copy).
-- ===========================================================================
create or replace function public.route_clone(p_route_id uuid, p_new_name text default null)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_src public.routes;
  v_new_id uuid := gen_random_uuid();
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'clone_routes') then
    raise exception 'Not allowed to clone routes' using errcode = '42501';
  end if;
  select * into v_src from public.routes where id = p_route_id;
  if not found then raise exception 'Route not found' using errcode = '42501'; end if;
  insert into public.routes(id, account_id, name, description, primary_assignee_id, created_by, status)
    values (v_new_id, v_account,
            coalesce(nullif(btrim(p_new_name), ''), v_src.name || ' (Copy)'),
            v_src.description, null, v_uid, 'draft');
  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', v_new_id, 'route_cloned', 'Route cloned',
            jsonb_build_object('source_route_id', p_route_id));
  return jsonb_build_object('id', v_new_id);
end;
$$;

-- ===========================================================================
-- 9. Planner: set / clear / move (move is atomic — one function body).
-- ===========================================================================
create or replace function public.route_planner_set(
  p_route_id uuid,
  p_assignee_id uuid,
  p_day_of_week smallint,
  p_is_active boolean default true,
  p_start_date date default null,
  p_end_date date default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_id uuid;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'assign_routes')
     and not has_permission(v_uid, v_account, 'manage_route_schedule') then
    raise exception 'Not allowed to assign routes' using errcode = '42501';
  end if;
  select * into v_route from public.routes where id = p_route_id;
  if not found then raise exception 'Route not found' using errcode = '42501'; end if;
  if v_route.status <> 'active' then
    raise exception 'Only active routes can be assigned in the planner' using errcode = '23514';
  end if;
  if p_day_of_week < 1 or p_day_of_week > 7 then
    raise exception 'day_of_week must be 1..7 (ISO Mon..Sun)' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_assignee_id and account_id = v_account) then
    raise exception 'Assignee is not in this account' using errcode = '23514';
  end if;

  update public.route_plan_assignments
    set route_id = p_route_id,
        is_active = coalesce(p_is_active, true),
        start_date = p_start_date,
        end_date = p_end_date,
        paused_at = case when coalesce(p_is_active, true) then null else now() end
    where account_id = v_account and assignee_id = p_assignee_id and day_of_week = p_day_of_week and end_date is null
    returning id into v_id;
  if v_id is null then
    insert into public.route_plan_assignments(account_id, route_id, assignee_id, day_of_week, is_active, start_date, end_date)
      values (v_account, p_route_id, p_assignee_id, p_day_of_week, coalesce(p_is_active, true), p_start_date, p_end_date)
      returning id into v_id;
  end if;
  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', p_route_id, 'route_assigned', 'Route assigned in planner',
            jsonb_build_object('assignee_id', p_assignee_id, 'day_of_week', p_day_of_week,
                               'is_active', coalesce(p_is_active, true)));
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.route_planner_clear(p_assignee_id uuid, p_day_of_week smallint)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route_id uuid;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'assign_routes')
     and not has_permission(v_uid, v_account, 'manage_route_schedule') then
    raise exception 'Not allowed to change the planner' using errcode = '42501';
  end if;
  select route_id into v_route_id from public.route_plan_assignments
    where account_id = v_account and assignee_id = p_assignee_id and day_of_week = p_day_of_week and end_date is null;
  delete from public.route_plan_assignments
    where account_id = v_account and assignee_id = p_assignee_id and day_of_week = p_day_of_week and end_date is null;
  if v_route_id is not null then
    insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
      values (v_account, v_uid, 'route', v_route_id, 'schedule_changed', 'Planner slot cleared',
              jsonb_build_object('assignee_id', p_assignee_id, 'day_of_week', p_day_of_week, 'cleared', true));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- route_planner_move: atomic set-target + clear-source in ONE function body.
-- Any failure aborts the whole call (no partial success).
create or replace function public.route_planner_move(
  p_route_id uuid, p_from_assignee uuid, p_from_dow smallint, p_to_assignee uuid, p_to_dow smallint)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_id uuid;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'assign_routes')
     and not has_permission(v_uid, v_account, 'manage_route_schedule') then
    raise exception 'Not allowed to change the planner' using errcode = '42501';
  end if;
  select * into v_route from public.routes where id = p_route_id;
  if not found then raise exception 'Route not found' using errcode = '42501'; end if;
  if v_route.status <> 'active' then
    raise exception 'Only active routes can be assigned in the planner' using errcode = '23514';
  end if;
  if p_to_dow < 1 or p_to_dow > 7 then
    raise exception 'day_of_week must be 1..7 (ISO Mon..Sun)' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_to_assignee and account_id = v_account) then
    raise exception 'Assignee is not in this account' using errcode = '23514';
  end if;

  -- clear the source slot
  delete from public.route_plan_assignments
    where account_id = v_account and assignee_id = p_from_assignee and day_of_week = p_from_dow and end_date is null;
  -- set the target slot (upsert)
  update public.route_plan_assignments
    set route_id = p_route_id, is_active = true, start_date = null, end_date = null, paused_at = null
    where account_id = v_account and assignee_id = p_to_assignee and day_of_week = p_to_dow and end_date is null
    returning id into v_id;
  if v_id is null then
    insert into public.route_plan_assignments(account_id, route_id, assignee_id, day_of_week, is_active)
      values (v_account, p_route_id, p_to_assignee, p_to_dow, true)
      returning id into v_id;
  end if;
  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', p_route_id, 'route_assigned', 'Route moved in planner',
            jsonb_build_object('from_assignee', p_from_assignee, 'from_dow', p_from_dow,
                               'to_assignee', p_to_assignee, 'to_dow', p_to_dow));
  return jsonb_build_object('id', v_id);
end;
$$;

-- ===========================================================================
-- 10. Grants — authenticated only (INVOKER callees must be executable by callers).
-- ===========================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._route_assert_module(uuid)',
    'public._route_contact_eligible(uuid,uuid,uuid)',
    'public._route_assert_editable(uuid,text)',
    'public.route_upsert(uuid,text,text,uuid,uuid[],integer)',
    'public.route_import_customers(uuid,text,uuid[])',
    'public.route_add_customers(uuid,uuid[])',
    'public.route_remove_customer(uuid,uuid)',
    'public.route_reorder_customers(uuid,uuid[])',
    'public.route_update_status(uuid,text,text)',
    'public.route_clone(uuid,text)',
    'public.route_planner_set(uuid,uuid,smallint,boolean,date,date)',
    'public.route_planner_clear(uuid,smallint)',
    'public.route_planner_move(uuid,uuid,smallint,uuid,smallint)'
  ] loop
    execute format('revoke all on function %s from public, anon;', fn);  -- PUBLIC grant must be removed, not just anon
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end $$;
