-- Device registration + approval, made server-authoritative.
--
-- Problems this fixes:
--  1. Registration only ran inside the mobile signIn() path, so any user whose session was
--     restored from storage (the normal case) never registered a device at all — which is why
--     active agents showed "no device registration data" on the admin screen.
--  2. The client decided its OWN status ('active' vs 'pending') and inserted it directly. The
--     insert policy allows self-insert, so a modified client could simply register itself as
--     'active' and walk straight past device approval. The status decision now lives here.
--  3. employee_devices UPDATE is admin-only, so a normal user could not even refresh their own
--     last_login. That is now done by this function instead of a direct update.

CREATE OR REPLACE FUNCTION public.device_register(
  p_device_id   text,
  p_device_name text DEFAULT NULL,
  p_device_model text DEFAULT NULL,
  p_os          text DEFAULT NULL,
  p_app_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_uid uuid := auth.uid();
  v_profile uuid;
  v_existing public.employee_devices;
  v_active_count int;
  v_status text;
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

  select * into v_existing
  from public.employee_devices
  where profile_id = v_profile and device_id = p_device_id
  limit 1;

  if found then
    -- Known device: refresh its metadata/last_login but NEVER change its status here.
    -- Only an admin can move a device between statuses.
    update public.employee_devices
       set last_login = now(),
           device_name = coalesce(p_device_name, device_name),
           device_model = coalesce(p_device_model, device_model),
           os = coalesce(p_os, os),
           application_version = coalesce(p_app_version, application_version),
           updated_at = now()
     where id = v_existing.id;

    return jsonb_build_object('status', v_existing.status, 'device_id', p_device_id, 'new', false);
  end if;

  -- New device. First device for this profile is trusted automatically; any additional device
  -- must be approved by an admin, which is the whole point of the feature.
  select count(*) into v_active_count
  from public.employee_devices
  where profile_id = v_profile and status = 'active';

  v_status := case when v_active_count = 0 then 'active' else 'pending' end;

  insert into public.employee_devices(
    profile_id, device_id, device_name, device_model, os, status, last_login, application_version
  ) values (
    v_profile, p_device_id, p_device_name, p_device_model, p_os, v_status, now(), p_app_version
  );

  return jsonb_build_object('status', v_status, 'device_id', p_device_id, 'new', true);
end;
$function$;

ALTER FUNCTION public.device_register(text, text, text, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.device_register(text, text, text, text, text) TO authenticated;

-- Lets the mobile app poll its own device's approval state while sitting on the pending screen.
CREATE OR REPLACE FUNCTION public.device_status(p_device_id text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT d.status
  FROM public.employee_devices d
  JOIN public.profiles p ON p.id = d.profile_id
  WHERE p.user_id = auth.uid() AND d.device_id = p_device_id
  LIMIT 1;
$function$;

ALTER FUNCTION public.device_status(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.device_status(text) TO authenticated;

-- Close the self-registration hole: a client can no longer INSERT its own device row directly
-- (and therefore can't choose its own 'active' status). Registration goes through
-- device_register() above, which is SECURITY DEFINER and decides the status itself.
-- Admins keep the ability to insert on a user's behalf.
DROP POLICY IF EXISTS employee_devices_insert ON employee_devices;
CREATE POLICY employee_devices_insert ON employee_devices FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = employee_devices.profile_id
        AND is_account_member(p.account_id, 'admin'::account_role_enum)
    )
  );
