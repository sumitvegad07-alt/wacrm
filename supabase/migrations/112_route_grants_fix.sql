-- 112_route_grants_fix.sql
-- Fix: route RPCs were granted EXECUTE to PUBLIC implicitly at CREATE time; revoking from
-- anon alone left the PUBLIC grant in place (anon inherits via PUBLIC). Revoke from PUBLIC.
-- Caught by post-deploy verification (has_function_privilege('anon', ...) was true).

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
    'public.route_planner_move(uuid,uuid,smallint,uuid,smallint)',
    'public.get_route_for(uuid,date)',
    'public.route_execution_start(uuid,uuid,date,uuid,jsonb)',
    'public.route_stop_add(uuid,uuid,uuid)',
    'public.route_stop_complete(uuid,uuid,jsonb,integer)',
    'public.route_stop_skip(uuid,text,integer)',
    'public.route_execution_complete(uuid)',
    'public.route_health(uuid)'
  ] loop
    execute format('revoke all on function %s from public;', fn);
    execute format('revoke all on function %s from anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end $$;
