-- ============================================================
-- Stop asking a rep to re-approve a phone they have already had approved.
--
-- THE PROBLEM
--
-- `employee_devices.device_id` is a random string the app keeps in AsyncStorage.
-- Uninstalling the app wipes it, so the same handset comes back as a stranger
-- and lands in 'pending' all over again. One employee in this database has
-- EIGHT rows, every one of them the same physical phone (SM-A066B), created on
-- a different reinstall. The approval gate was working correctly; the identity
-- was the thing that kept changing.
--
-- THE FIX
--
-- The app now also sends a hardware fingerprint (Android's ANDROID_ID), which
-- survives a reinstall. `device_register` matches in this order:
--
--   1. Known device_id            -> exactly as before. Also backfills the
--                                    fingerprint, so devices approved BEFORE
--                                    this shipped are protected from their next
--                                    login onward.
--   2. Known fingerprint for this -> the same phone, same person. That row
--      employee                      adopts the new install id and keeps its
--                                    EXISTING status. No new row, no re-approval.
--   3. Anything else              -> a genuinely new device; unchanged rules
--                                    (first one is trusted, the rest pend).
--
-- Two properties this must keep, and does:
--
--   * A rejected or deactivated phone STAYS that way. Step 2 returns the row's
--     existing status, so reinstalling can never launder a blocked device back
--     into 'active'.
--   * Approval remains PER EMPLOYEE. A different person signing in on the same
--     handset still gets their own row and still needs approving -- which is
--     the entire point of the feature.
--
-- Older duplicate rows carry no fingerprint, so they are never matched again and
-- simply go stale. They are deliberately NOT touched here: guessing which of two
-- identically-modelled handsets to deactivate could lock a rep out.
--
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.employee_devices
  add column if not exists hardware_id text;

comment on column public.employee_devices.hardware_id is
  'Platform device fingerprint (Android ANDROID_ID) that survives an app reinstall. Null for rows created before this existed, and for handsets that report an untrustworthy value.';

-- Every lookup is "this employee, this fingerprint". Partial: the column is null
-- for legacy rows and those are never searched by it.
create index if not exists idx_employee_devices_profile_hardware
  on public.employee_devices (profile_id, hardware_id)
  where hardware_id is not null;

-- The old function takes five arguments; adding a sixth would CREATE AN OVERLOAD
-- rather than replace it, leaving two candidates and an ambiguous call from the
-- app. Drop the old signature explicitly. Both statements run in one
-- transaction, so there is no window where the function is missing.
drop function if exists public.device_register(text, text, text, text, text);

create or replace function public.device_register(
  p_device_id text,
  p_device_name text default null,
  p_device_model text default null,
  p_os text default null,
  p_app_version text default null,
  p_hardware_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile uuid;
  v_existing public.employee_devices;
  v_active_count int;
  v_status text;
  v_hw text := nullif(btrim(lower(coalesce(p_hardware_id, ''))), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null or btrim(p_device_id) = '' then
    raise exception 'device_id is required' using errcode = '23514';
  end if;

  select id into v_profile from public.profiles where user_id = v_uid limit 1;
  if v_profile is null then
    raise exception 'No profile for current user' using errcode = '42501';
  end if;

  -- 1. This exact install, already known.
  select * into v_existing
  from public.employee_devices
  where profile_id = v_profile and device_id = p_device_id
  limit 1;

  if found then
    -- Refresh metadata and last_login, and take the fingerprint if we did not
    -- have one. NEVER change status here: only an admin moves a device between
    -- statuses.
    update public.employee_devices
       set last_login = now(),
           device_name = coalesce(p_device_name, device_name),
           device_model = coalesce(p_device_model, device_model),
           os = coalesce(p_os, os),
           application_version = coalesce(p_app_version, application_version),
           hardware_id = coalesce(hardware_id, v_hw),
           updated_at = now()
     where id = v_existing.id;

    return jsonb_build_object(
      'status', v_existing.status, 'device_id', p_device_id, 'new', false, 'matched_by', 'device_id'
    );
  end if;

  -- 2. A different install of the app on a handset this employee already has a
  --    decision recorded for. Prefer the most recently used row if somehow more
  --    than one carries the fingerprint.
  if v_hw is not null then
    select * into v_existing
    from public.employee_devices
    where profile_id = v_profile and hardware_id = v_hw
    order by last_login desc nulls last, created_at desc
    limit 1;

    if found then
      update public.employee_devices
         set device_id = p_device_id,
             last_login = now(),
             device_name = coalesce(p_device_name, device_name),
             device_model = coalesce(p_device_model, device_model),
             os = coalesce(p_os, os),
             application_version = coalesce(p_app_version, application_version),
             updated_at = now()
       where id = v_existing.id;

      -- Self-cleaning: any other row for this employee carrying the SAME
      -- fingerprint is a superseded install of the same phone. Only rows we can
      -- positively identify by fingerprint are touched.
      update public.employee_devices
         set status = 'inactive', updated_at = now()
       where profile_id = v_profile
         and hardware_id = v_hw
         and id <> v_existing.id
         and status <> 'inactive';

      -- The row's EXISTING status: a rejected phone stays rejected.
      return jsonb_build_object(
        'status', v_existing.status, 'device_id', p_device_id, 'new', false, 'matched_by', 'hardware_id'
      );
    end if;
  end if;

  -- 3. Genuinely new device. First device for this profile is trusted; any
  --    additional one must be approved by an admin.
  select count(*) into v_active_count
  from public.employee_devices
  where profile_id = v_profile and status = 'active';

  v_status := case when v_active_count = 0 then 'active' else 'pending' end;

  insert into public.employee_devices(
    profile_id, device_id, device_name, device_model, os, status, last_login,
    application_version, hardware_id
  ) values (
    v_profile, p_device_id, p_device_name, p_device_model, p_os, v_status, now(),
    p_app_version, v_hw
  );

  return jsonb_build_object(
    'status', v_status, 'device_id', p_device_id, 'new', true, 'matched_by', 'new'
  );
end;
$$;

-- The dropped function took its grants with it; restore exactly what it had.
revoke all on function public.device_register(text, text, text, text, text, text) from public;
grant execute on function public.device_register(text, text, text, text, text, text)
  to anon, authenticated, service_role;
