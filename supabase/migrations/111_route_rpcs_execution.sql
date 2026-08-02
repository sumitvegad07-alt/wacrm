-- 111_route_rpcs_execution.sql
-- Route Management V1 — execution + read RPCs (Phase 1b, hardened per CTO review 2026-08-02).
-- Spec: docs/engineering/specifications/route-management.md (Revision 3).
-- All SECURITY INVOKER, WHERE-qualified, idempotent via client-supplied ids.
-- Depends on helpers from 110 (_route_assert_module).

-- ---------------------------------------------------------------------------
-- get_route_for: the SINGLE resolver for "which route runs today". Returns null
-- when the module is off or nothing is planned. Future calendar/leave/temp-reassign
-- precedence plugs in here only.
-- ---------------------------------------------------------------------------
create or replace function public.get_route_for(p_assignee_id uuid, p_date date default current_date)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_account uuid;
  v_dow smallint;
  v_assign public.route_plan_assignments;
  v_route public.routes;
  v_customers jsonb;
begin
  v_account := (select account_id from public.profiles where id = p_assignee_id);
  if v_account is null
     or not coalesce((select (module_settings->>'route')::boolean from public.accounts where id = v_account), false) then
    return null;  -- module off / unknown assignee → no route
  end if;

  v_dow := extract(isodow from p_date)::smallint;
  select * into v_assign
    from public.route_plan_assignments
    where assignee_id = p_assignee_id and day_of_week = v_dow and is_active
      and (start_date is null or start_date <= p_date)
      and (end_date is null or end_date >= p_date)
    order by (end_date is not null) desc   -- date-bounded (temporary) wins over open-ended default
    limit 1;
  if not found then return null; end if;

  select * into v_route from public.routes where id = v_assign.route_id;
  if not found or v_route.status <> 'active' then return null; end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'contact_id', rc.contact_id, 'sequence', rc.sequence,
             'company', c.company, 'name', c.name,
             'latitude', c.latitude, 'longitude', c.longitude, 'address', c.address
           ) order by rc.sequence), '[]'::jsonb)
    into v_customers
    from public.route_customers rc
    join public.contacts c on c.id = rc.contact_id
    where rc.route_id = v_route.id and rc.archived_at is null;

  return jsonb_build_object('route', to_jsonb(v_route), 'customers', v_customers, 'assignment_id', v_assign.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- route_execution_start: create the execution + upsert client-authoritative stops.
-- ---------------------------------------------------------------------------
create or replace function public.route_execution_start(
  p_execution_id uuid,
  p_route_id uuid,
  p_execution_date date default current_date,
  p_tracking_session_id uuid default null,
  p_stops jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_exec public.route_executions;
  v_stop jsonb;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'execute_route') then
    raise exception 'Not allowed to execute routes' using errcode = '42501';
  end if;

  select * into v_exec from public.route_executions where id = p_execution_id;  -- idempotent
  if found then return to_jsonb(v_exec); end if;

  insert into public.route_executions(id, account_id, route_id, user_id, execution_date, status, started_at, tracking_session_id)
    values (p_execution_id, v_account, p_route_id, v_uid, coalesce(p_execution_date, current_date),
            'in_progress', now(), p_tracking_session_id)
    returning * into v_exec;

  for v_stop in select * from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) loop
    insert into public.route_execution_stops(id, account_id, execution_id, contact_id, planned_sequence, status)
      values ((v_stop->>'stop_id')::uuid, v_account, p_execution_id,
              (v_stop->>'contact_id')::uuid, nullif(v_stop->>'planned_sequence', '')::int, 'pending')
      on conflict (id) do nothing;
  end loop;

  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', p_route_id, 'route_started', 'Route started',
            jsonb_build_object('execution_id', p_execution_id));
  return to_jsonb(v_exec);
end;
$$;

-- ---------------------------------------------------------------------------
-- route_stop_add: add an unplanned stop mid-round (planned_sequence NULL).
-- Validates the contact exists in-account before creating the stop.
-- ---------------------------------------------------------------------------
create or replace function public.route_stop_add(p_execution_id uuid, p_stop_id uuid, p_contact_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'execute_route') then
    raise exception 'Not allowed to execute routes' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts where id = p_contact_id and account_id = v_account) then
    raise exception 'Customer does not exist' using errcode = '23503';
  end if;
  insert into public.route_execution_stops(id, account_id, execution_id, contact_id, planned_sequence, status)
    values (p_stop_id, v_account, p_execution_id, p_contact_id, null, 'pending')
    on conflict (id) do nothing;
  return jsonb_build_object('id', p_stop_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- route_stop_complete: create a linked site_visit + mark the stop completed.
-- Validates contact existence; enforces out-of-sequence rule; idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.route_stop_complete(
  p_stop_id uuid,
  p_site_visit_id uuid,
  p_visit jsonb default '{}'::jsonb,
  p_actual_sequence int default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_stop public.route_execution_stops;
  v_settings jsonb;
  v_oos boolean;
  v_minpending int;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'execute_route') then
    raise exception 'Not allowed to execute routes' using errcode = '42501';
  end if;
  select * into v_stop from public.route_execution_stops where id = p_stop_id;
  if not found then raise exception 'Stop not found' using errcode = '42501'; end if;

  -- validate the contact still exists in-account before creating the visit
  if not exists (select 1 from public.contacts where id = v_stop.contact_id and account_id = v_account) then
    raise exception 'Customer no longer exists' using errcode = '23503';
  end if;

  v_settings := (select settings->'route_settings' from public.accounts where id = v_account);
  v_oos := coalesce((v_settings->'execution'->>'out_of_sequence_allowed')::boolean, true);
  if not v_oos and not has_permission(v_uid, v_account, 'modify_route_sequence') then
    select min(planned_sequence) into v_minpending
      from public.route_execution_stops
      where execution_id = v_stop.execution_id and status = 'pending' and planned_sequence is not null;
    if v_stop.planned_sequence is not null and v_minpending is not null and v_stop.planned_sequence > v_minpending then
      raise exception 'Visit stops in planned order' using errcode = '23514';
    end if;
  end if;

  insert into public.site_visits(
      id, account_id, user_id, contact_id, target_type, target_id,
      check_in_at, check_in_lat, check_in_lng, check_in_method,
      notes, visit_photo_url, feedback_type, feedback_text, route_execution_id)
    values (
      p_site_visit_id, v_account, v_uid, v_stop.contact_id, 'Customer', v_stop.contact_id,
      coalesce((p_visit->>'check_in_at')::timestamptz, now()),
      (p_visit->>'check_in_lat')::double precision, (p_visit->>'check_in_lng')::double precision,
      coalesce(p_visit->>'check_in_method', 'manual'),  -- site_visits CHECK allows: geofence_auto|manual|qr_scan
      p_visit->>'notes', p_visit->>'visit_photo_url',
      p_visit->>'feedback_type', p_visit->>'feedback_text', v_stop.execution_id)
    on conflict (id) do nothing;

  update public.route_execution_stops
    set status = 'completed', site_visit_id = p_site_visit_id,
        actual_sequence = p_actual_sequence, visited_at = now()
    where id = p_stop_id;

  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', v_stop.execution_id, 'stop_completed', 'Stop completed',
            jsonb_build_object('execution_id', v_stop.execution_id, 'contact_id', v_stop.contact_id,
                               'actual_sequence', p_actual_sequence));
  return jsonb_build_object('ok', true, 'site_visit_id', p_site_visit_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- route_stop_skip: mark a stop skipped (subject to settings).
-- ---------------------------------------------------------------------------
create or replace function public.route_stop_skip(
  p_stop_id uuid, p_reason text default null, p_actual_sequence int default null)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_stop public.route_execution_stops;
  v_settings jsonb;
  v_oos boolean;
  v_minpending int;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'skip_route_stop') then
    raise exception 'Not allowed to skip stops' using errcode = '42501';
  end if;
  select * into v_stop from public.route_execution_stops where id = p_stop_id;
  if not found then raise exception 'Stop not found' using errcode = '42501'; end if;

  v_settings := (select settings->'route_settings' from public.accounts where id = v_account);
  if not coalesce((v_settings->'execution'->>'skip_allowed')::boolean, true) then
    raise exception 'Skipping is disabled for this account' using errcode = '42501';
  end if;
  if coalesce((v_settings->'execution'->>'skip_reason_mandatory')::boolean, true)
     and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'A reason is required to skip a stop' using errcode = '23514';
  end if;
  v_oos := coalesce((v_settings->'execution'->>'out_of_sequence_allowed')::boolean, true);
  if not v_oos and not has_permission(v_uid, v_account, 'modify_route_sequence') then
    select min(planned_sequence) into v_minpending
      from public.route_execution_stops
      where execution_id = v_stop.execution_id and status = 'pending' and planned_sequence is not null;
    if v_stop.planned_sequence is not null and v_minpending is not null and v_stop.planned_sequence > v_minpending then
      raise exception 'Visit stops in planned order' using errcode = '23514';
    end if;
  end if;

  update public.route_execution_stops
    set status = 'skipped', skip_reason = p_reason, actual_sequence = p_actual_sequence, visited_at = now()
    where id = p_stop_id;

  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', v_stop.execution_id, 'stop_skipped', 'Stop skipped',
            jsonb_build_object('execution_id', v_stop.execution_id, 'contact_id', v_stop.contact_id,
                               'skip_reason', p_reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- route_execution_complete: close out the day's run.
-- Blocks completion while stops are still pending unless the account setting
-- execution.allow_complete_with_pending is true (default false).
-- ---------------------------------------------------------------------------
create or replace function public.route_execution_complete(p_execution_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route_id uuid;
  v_allow_pending boolean;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  perform public._route_assert_module(v_account);
  if not has_permission(v_uid, v_account, 'execute_route') then
    raise exception 'Not allowed to execute routes' using errcode = '42501';
  end if;

  v_allow_pending := coalesce(
    (select (settings->'route_settings'->'execution'->>'allow_complete_with_pending')::boolean
     from public.accounts where id = v_account), false);
  if not v_allow_pending
     and exists (select 1 from public.route_execution_stops
                 where execution_id = p_execution_id and status = 'pending') then
    raise exception 'Complete or skip all stops before finishing the route' using errcode = '23514';
  end if;

  update public.route_executions
    set status = 'completed', completed_at = now()
    where id = p_execution_id and user_id = v_uid
    returning route_id into v_route_id;
  if v_route_id is null then
    raise exception 'Execution not found' using errcode = '42501';
  end if;
  insert into public.module_activities(account_id, user_id, module_name, record_id, action, message, details)
    values (v_account, v_uid, 'route', v_route_id, 'route_completed', 'Route completed',
            jsonb_build_object('execution_id', p_execution_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- route_health: non-blocking validation engine. Gated by view_routes (min).
-- Returns { score, checks[] }. Never blocks anything — admin-facing guidance only.
-- ---------------------------------------------------------------------------
create or replace function public.route_health(p_route_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid;
  v_route public.routes;
  v_cust_count int;
  v_cap int;
  v_assignee_uid uuid;
  v_terr uuid[];
  v_checks jsonb;
  v_total int;
  v_passed int;
begin
  v_account := (select account_id from public.profiles where user_id = v_uid);
  if not has_permission(v_uid, v_account, 'view_routes') then
    raise exception 'Not allowed to view routes' using errcode = '42501';
  end if;
  select * into v_route from public.routes where id = p_route_id;
  if not found then raise exception 'Route not found' using errcode = '42501'; end if;
  v_cap := coalesce((select (settings->'route_settings'->'capacity'->>'max_customers')::int
                     from public.accounts where id = v_route.account_id), 50);
  select count(*) into v_cust_count from public.route_customers where route_id = p_route_id and archived_at is null;
  v_assignee_uid := (select user_id from public.profiles where id = v_route.primary_assignee_id);
  if v_assignee_uid is not null then v_terr := employee_area_territory_ids(v_assignee_uid); end if;

  with defs(code, ok) as (
    values
      ('no_customers',              v_cust_count > 0),
      ('primary_assignee_missing',  v_route.primary_assignee_id is not null),
      ('not_assigned',              exists (select 1 from public.route_plan_assignments where route_id = p_route_id and is_active)),
      ('duplicate_name',            not exists (select 1 from public.routes r2
                                                where r2.account_id = v_route.account_id and r2.id <> p_route_id
                                                  and r2.status <> 'archived' and lower(r2.name) = lower(v_route.name))),
      ('capacity_exceeded',         v_cust_count <= v_cap),
      ('contains_flagged_customer', not exists (select 1 from public.route_customers rc
                                                join public.contacts c on c.id = rc.contact_id
                                                where rc.route_id = p_route_id and rc.archived_at is null
                                                  and c.needs_territory_review)),
      ('outside_territory',         v_terr is null or not exists (select 1 from public.route_customers rc
                                                join public.contacts c on c.id = rc.contact_id
                                                where rc.route_id = p_route_id and rc.archived_at is null
                                                  and (c.territory_id is null or not (c.territory_id = any(v_terr)))))
  )
  select jsonb_agg(jsonb_build_object('code', code, 'ok', ok, 'severity', 'warning')),
         count(*), count(*) filter (where ok)
    into v_checks, v_total, v_passed
    from defs;

  return jsonb_build_object(
    'score', case when v_total = 0 then 100 else round(100.0 * v_passed / v_total) end,
    'checks', v_checks);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.get_route_for(uuid,date)',
    'public.route_execution_start(uuid,uuid,date,uuid,jsonb)',
    'public.route_stop_add(uuid,uuid,uuid)',
    'public.route_stop_complete(uuid,uuid,jsonb,integer)',
    'public.route_stop_skip(uuid,text,integer)',
    'public.route_execution_complete(uuid)',
    'public.route_health(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon;', fn);  -- PUBLIC grant must be removed, not just anon
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end $$;
