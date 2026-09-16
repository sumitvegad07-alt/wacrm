-- When Territory Master is enabled, a customer's geography is entered via the
-- Territory picker (contacts.territory_id) and the flat country/state/city/area
-- columns are hidden on the form. But those flat columns are what reports, list
-- views, exports and the mobile app read -- so they must stay in sync with the
-- assigned territory. Previously they were left blank on every territory-driven
-- write (import, web form, mobile), so a customer imported/created with only a
-- territory had no city/state/country/area. This denormalizes the territory
-- hierarchy back into the flat columns for EVERY write path via one trigger
-- (import_commit, web contact form, mobile, and any future module).

-- territories.level == the settings level position: 1=Country, 2=State,
-- 3=City, 4=Area (levels 5+ have no flat column and are ignored). Walk from the
-- assigned node up to the root, filling each flat column from its ancestor.
create or replace function public.territory_flat_geo(p_territory_id uuid)
returns table(country text, state text, city text, area text)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_id uuid := p_territory_id;
  v_name text; v_level int; v_parent uuid; v_guard int := 0;
begin
  country := null; state := null; city := null; area := null;
  while v_id is not null and v_guard < 12 loop
    select t.name, t.level, t.parent_id
      into v_name, v_level, v_parent
      from territories t
      where t.id = v_id and t.deleted_at is null;
    exit when not found;
    if    v_level = 1 then country := v_name;
    elsif v_level = 2 then state   := v_name;
    elsif v_level = 3 then city    := v_name;
    elsif v_level = 4 then area    := v_name;
    end if;
    v_id := v_parent;
    v_guard := v_guard + 1;
  end loop;
  return next;
end;
$function$;

-- BEFORE INSERT/UPDATE: whenever a contact carries a territory_id, mirror the
-- hierarchy into the flat geo columns. Only recompute on insert or when the
-- territory actually changes, so plain edits stay cheap. territory_id NULL
-- (Territory Master off) leaves user-entered geo untouched.
create or replace function public.contacts_sync_geo_from_territory()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare g record;
begin
  if NEW.territory_id is not null
     and (TG_OP = 'INSERT' or NEW.territory_id is distinct from OLD.territory_id) then
    select * into g from public.territory_flat_geo(NEW.territory_id);
    NEW.country := g.country;
    NEW.state   := g.state;
    NEW.city    := g.city;
    NEW.area    := g.area;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_contacts_sync_geo on public.contacts;
create trigger trg_contacts_sync_geo
before insert or update on public.contacts
for each row execute function public.contacts_sync_geo_from_territory();

-- Backfill every existing tenant: customers that already carry a territory but
-- have blank/stale flat geo get corrected in place.
-- (A set-returning function in UPDATE...FROM cannot take a column from the
-- update target directly, so join a second reference to contacts and call the
-- function LATERAL against it.)
update public.contacts c
set country = g.country,
    state   = g.state,
    city    = g.city,
    area    = g.area
from public.contacts c2
cross join lateral public.territory_flat_geo(c2.territory_id) g
where c2.id = c.id
  and c.territory_id is not null
  and (c.country is distinct from g.country
    or c.state   is distinct from g.state
    or c.city    is distinct from g.city
    or c.area    is distinct from g.area);
