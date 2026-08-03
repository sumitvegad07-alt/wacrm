-- 113_route_bulk_update_status.sql
-- Route Management (Phase 2E) — Shared Bulk Approval/Status RPC.
-- Atomic, set-based RPC for both Web (Manager Console) and Mobile (Primary approval interface).
-- Reuses public.route_update_status() internally so 100% of permission checks, state
-- transitions, business rules, and module_activities audit entries are preserved.
-- Supports optimistic concurrency via p_expected_version.

create or replace function public.route_bulk_update_status(
  p_route_ids uuid[],
  p_new_status text,
  p_reason text default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_curr_ver integer;
  v_res jsonb;
  v_total integer := 0;
  v_updated integer := 0;
  v_failed integer := 0;
  v_ok_ids uuid[] := array[]::uuid[];
  v_errors jsonb := '[]'::jsonb;
begin
  if p_route_ids is null or array_length(p_route_ids, 1) is null then
    return jsonb_build_object(
      'total', 0,
      'updated', 0,
      'failed', 0,
      'ok_ids', '[]'::jsonb,
      'errors', '[]'::jsonb
    );
  end if;

  v_total := array_length(p_route_ids, 1);

  for v_id in select distinct unnest(p_route_ids) loop
    begin
      -- 1. Optimistic concurrency validation (if p_expected_version provided)
      if p_expected_version is not null then
        select version into v_curr_ver from public.routes where id = v_id;
        if not found then
          raise exception 'Route not found' using errcode = '42501';
        end if;
        if v_curr_ver <> p_expected_version then
          raise exception 'Route version mismatch (expected %, found %)', p_expected_version, v_curr_ver using errcode = '40001';
        end if;
      end if;

      -- 2. Call existing route_update_status to execute all business rules, RLS, and audit trail
      v_res := public.route_update_status(v_id, p_new_status, p_reason);
      v_updated := v_updated + 1;
      v_ok_ids := array_append(v_ok_ids, v_id);

    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'route_id', v_id,
        'error', SQLERRM,
        'code', SQLSTATE
      );
    end;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'updated', v_updated,
    'failed', v_failed,
    'ok_ids', to_jsonb(v_ok_ids),
    'errors', v_errors
  );
end;
$$;

revoke execute on function public.route_bulk_update_status(uuid[], text, text, integer) from public, anon;
grant execute on function public.route_bulk_update_status(uuid[], text, text, integer) to authenticated, service_role;
