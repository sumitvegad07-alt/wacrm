-- =====================================================================
-- 2026-11-26 — Territories for the partner portal.
--
-- Founder's review of the partner portal, point 9, in his own words:
--
--   "Settings must have area/territory creation option just as we used to
--    create in existing OZZO. you can simply copy & paste all the
--    territories here too."
--
-- Two requests in one sentence, and this migration answers both:
--
--   (a) a territory tree the portal owns, created and edited from Settings
--       exactly as the CRM's Territory Master is; and
--   (b) a way to bring the CRM's existing tree across rather than retyping
--       India, its 36 states and its ~762 districts by hand.
--
-- ── The shape, and why it is the CRM's ──
--
-- `public.territories` (migration 101) is an adjacency list: `parent_id`,
-- `level`, a partial unique index on (parent, lower(name)), `status`, a
-- soft-delete `deleted_at`, and an `is_seed_data` flag that tells loaded
-- reference data apart from what a human typed. Every one of those earns its
-- place and the reasoning is already recorded in 101, so this table is that
-- table minus `account_id` — the portal is one organisation, OZZO itself.
--
-- `COALESCE(parent_id, '000…0')` in the unique index is the one subtlety
-- worth repeating: two children of different parents may share a name
-- ("Rajkot" the city and "Rajkot" the district are different rows), but two
-- ROOTS may not both be called India, and NULL never equals NULL, so the
-- roots have to be folded into one comparison bucket by hand.
--
-- The LEVEL NAMES are not a table. The CRM keeps them in
-- accounts.settings.territory_settings so a tenant can rename them; the
-- portal has no accounts row of its own and the founder asked for the
-- familiar four, so Country / State / City / Area are fixed in
-- ozzo-partner/lib/territories/types.ts and `level` here is just 1–4. A
-- fifth level is a migration away and nothing stores a level name, so
-- renaming one later cannot orphan data.
--
-- ── THE FIVE QUESTIONS ──
--
-- 1. What breaks if this runs twice?
--    Nothing. Every object is `if not exists` / `create or replace`, and
--    `partner_territory_copy_from_crm()` returns `skipped` the moment the
--    table already holds a copied row.
--
-- 2. What else in either repo, AND in supabase/tests, reads these columns?
--    Nothing yet — the table is new. `public.territories` is READ by the
--    copy function and never written, so no CRM screen, report or policy is
--    affected; `wacrm-web` has 41 files touching `territories` and none of
--    them can see this table. NO new foreign key is added between any
--    existing pair of tables — the only FK here is this table to itself.
--    That sentence is here because of
--    [orders-second-fk-broke-every-order], where an additive nullable FK
--    stopped PostgREST resolving an embed and broke every order screen for
--    three days.
--
-- 3. New trigger / policy / constraint on a table that gets written?
--    Four new policies and one trigger, all on this new table, so nothing
--    that exists today can start failing. The trigger is the depth guard:
--    `level` must be exactly one more than the parent's, which is what
--    stops a City being filed under a Country and makes the tree walkable
--    without a recursive query in every screen.
--
-- 4. Can an existing row fail the new rule?
--    There are no existing rows.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing. No tenant can reach this table, and the lead and customer
--    forms fall back to the distinct values already on their own records
--    when it is empty — so the portal works exactly as it does today until
--    somebody loads a tree.
--
-- ── TO UNDO ──
--    See ROLLBACK-partner-territories.md.
-- =====================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.partner_territories (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid null references public.partner_territories(id) on delete restrict,
  -- 1 Country, 2 State, 3 City, 4 Area. The names live in the app; see the
  -- note at the top about why they are not a table.
  level        int  not null check (level between 1 and 4),
  name         text not null check (btrim(name) <> ''),
  code         text null,
  status       text not null default 'active'
               check (status in ('active', 'inactive')),
  notes        text null,
  -- True for rows brought over from the CRM or loaded as reference data,
  -- false for anything a person typed. It is what lets "start again" mean
  -- "drop the loaded tree" without touching the areas somebody added by
  -- hand, and it is how the copy function stays idempotent.
  is_seed_data boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid null
);

-- Duplicate names rejected under the SAME parent, allowed under DIFFERENT
-- parents. COALESCE folds the roots into one bucket so two root "India"s
-- cannot both exist — NULL = NULL is never true, so without it the index
-- would not see them as duplicates at all.
create unique index if not exists uq_partner_territories_name_per_parent
  on public.partner_territories (
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create index if not exists ix_partner_territories_parent
  on public.partner_territories (parent_id);
create index if not exists ix_partner_territories_level
  on public.partner_territories (level);
-- The lead and customer forms ask "every active City", so the level+status
-- pair is the hot path, not either column alone.
create index if not exists ix_partner_territories_level_status
  on public.partner_territories (level, status);

comment on table public.partner_territories is
  'OZZO''s own geography tree — Country > State > City > Area. public.territories without account_id, because the portal is one organisation.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. The depth guard
--
-- A row''s level must be exactly one more than its parent''s, and a root
-- must be level 1. Without this, nothing stops an Area being filed directly
-- under a Country: no error, and then every screen that walks the tree by
-- level disagrees with every screen that walks it by parent_id.
--
-- A BEFORE trigger rather than a CHECK, because a CHECK cannot read another
-- row. It also rejects a row that is its own parent, which is the one-row
-- case of the cycle that `prevent_manager_cycle` exists for on
-- partner_employees — and the reason that one exists is an infinite
-- recursion inside a scope walk.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_territory_check_level()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_level int;
begin
  if new.parent_id is null then
    if new.level <> 1 then
      raise exception 'A territory with no parent must be a Country (level 1), not level %.',
        new.level using errcode = '23514';
    end if;
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A territory cannot be its own parent.' using errcode = '23514';
  end if;

  select level into v_parent_level
    from partner_territories where id = new.parent_id;

  if v_parent_level is null then
    raise exception 'That parent territory does not exist.' using errcode = '23503';
  end if;

  if new.level <> v_parent_level + 1 then
    raise exception 'A level % territory cannot sit under a level % one.',
      new.level, v_parent_level using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_partner_territory_check_level on public.partner_territories;
create trigger trg_partner_territory_check_level
  before insert or update of parent_id, level on public.partner_territories
  for each row execute function public.partner_territory_check_level();

-- updated_at, the same way every other partner_* table does it.
drop trigger if exists trg_partner_territories_updated_at on public.partner_territories;
create trigger trg_partner_territories_updated_at
  before update on public.partner_territories
  for each row execute function public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Who may read and write
--
-- Read: anybody in the portal. A city name is not confidential, every lead
-- and customer form needs the list, and gating it behind a right would mean
-- a Sales Executive could not fill in an address.
--
-- Write: `manage_masters`, which is the right the other four master lists
-- already use — lead statuses, sources, industries and activity types. A
-- fifth list with a fifth rule would be a fifth thing to get wrong.
-- ─────────────────────────────────────────────────────────────────────

alter table public.partner_territories enable row level security;

drop policy if exists partner_territories_select on public.partner_territories;
create policy partner_territories_select on public.partner_territories
  for select to authenticated
  using (public.partner_me() is not null);

drop policy if exists partner_territories_insert on public.partner_territories;
create policy partner_territories_insert on public.partner_territories
  for insert to authenticated
  with check (public.partner_has_right('manage_masters'));

drop policy if exists partner_territories_update on public.partner_territories;
create policy partner_territories_update on public.partner_territories
  for update to authenticated
  using (public.partner_has_right('manage_masters'))
  with check (public.partner_has_right('manage_masters'));

-- No DELETE policy, on purpose and for the same reason the master lists have
-- none: a lead stores its city BY NAME, so removing a territory would leave
-- existing records showing a value that is in no dropdown and no filter.
-- Retiring is `status = 'inactive'`, which the UPDATE policy covers.

revoke all on table public.partner_territories from anon;
grant select on table public.partner_territories to authenticated;
grant insert, update on table public.partner_territories to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. "you can simply copy & paste all the territories here too"
--
-- The CRM's tree and this one live in the same Postgres database, so the
-- copy is one INSERT … SELECT per level rather than a thousand rows pushed
-- up from a browser. That is the whole reason this is a function and not a
-- button that posts JSON.
--
-- WHICH account's tree? The one with the most active territories. Prod holds
-- the founder's own tenant plus the four demo tenants, and the real tree is
-- the big one — the demo accounts carry whatever their seed gave them. It is
-- decided here rather than passed in so that nobody has to know an account
-- id, and `p_account_id` is there for the case where the guess is wrong.
--
-- SECURITY DEFINER because it reads `public.territories`, which is
-- account-scoped by RLS and which no partner employee is a member of — a
-- partner employee has no `profiles` row at all, by design. The right is
-- checked FIRST, on the caller's own session, exactly as every API route in
-- the portal does it.
--
-- Idempotent: a second run finds seed rows and does nothing. That matters
-- because this is pasted into the SQL editor by hand and may well be run
-- twice.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_territory_copy_from_crm(
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account    uuid;
  v_countries  int := 0;
  v_states     int := 0;
  v_cities     int := 0;
  v_areas      int := 0;
begin
  if not public.partner_has_right('manage_masters') then
    raise exception 'You cannot change the master lists.' using errcode = '42501';
  end if;

  if exists (select 1 from partner_territories where is_seed_data) then
    return jsonb_build_object('ok', true, 'skipped', true,
      'reason', 'The territories have already been copied.');
  end if;

  -- The account with the most live territories, which is the real tree.
  v_account := coalesce(
    p_account_id,
    (select t.account_id
       from territories t
      where t.deleted_at is null and t.status = 'active'
      group by t.account_id
      order by count(*) desc, t.account_id
      limit 1)
  );

  if v_account is null then
    return jsonb_build_object('ok', true, 'skipped', true,
      'reason', 'There are no territories in the CRM to copy.');
  end if;

  -- One level at a time, parents before children, so every child has a
  -- parent_id to point at and the depth trigger is satisfied as it goes.
  --
  -- `crm_id` carries the source row's id through each step purely so the
  -- next level can find its parent. It is not stored: a copied tree is the
  -- portal's own from the moment it lands, and a column pointing into an
  -- account-scoped table would be a second route to tenant data.
  -- A scratch map from each CRM row to its copy, so the next level down can
  -- find its parent. `on commit drop` ties it to the calling transaction;
  -- the explicit drop first is for the case where this function is called
  -- twice inside one transaction, where CREATE would otherwise fail with
  -- "relation already exists" and read as a broken copy.
  drop table if exists pg_temp.partner_tcopy;
  create temporary table partner_tcopy (
    crm_id    uuid primary key,
    new_id    uuid not null,
    level     int  not null
  ) on commit drop;

  -- Level 1 — countries.
  with src as (
    select t.id, t.name, t.code
      from territories t
     where t.account_id = v_account
       and t.deleted_at is null
       and t.level = 1
  ), ins as (
    insert into partner_territories (parent_id, level, name, code, status, is_seed_data)
    select null, 1, src.name, src.code, 'active', true
      from src
    -- A tree copied onto a tree somebody has already started by hand: keep
    -- what is there rather than failing the whole copy on one clash.
    on conflict do nothing
    returning id, lower(name) as lname
  )
  insert into partner_tcopy (crm_id, new_id, level)
  select src.id, coalesce(ins.id, existing.id), 1
    from src
    left join ins on ins.lname = lower(src.name)
    left join partner_territories existing
           on existing.parent_id is null and lower(existing.name) = lower(src.name)
   where coalesce(ins.id, existing.id) is not null;
  select count(*) into v_countries from partner_tcopy where level = 1;

  -- Levels 2, 3 and 4 — states, cities, areas. The same step three times,
  -- written out rather than looped: a loop would have to build the INSERT as
  -- text and EXECUTE it, and dynamic SQL inside a SECURITY DEFINER function
  -- is not worth saving thirty lines.

  -- Level 2 — states.
  with src as (
    select t.id, t.name, t.code, t.parent_id
      from territories t
     where t.account_id = v_account and t.deleted_at is null and t.level = 2
  ), ins as (
    insert into partner_territories (parent_id, level, name, code, status, is_seed_data)
    select p.new_id, 2, src.name, src.code, 'active', true
      from src join partner_tcopy p on p.crm_id = src.parent_id and p.level = 1
    on conflict do nothing
    returning id, parent_id, lower(name) as lname
  )
  insert into partner_tcopy (crm_id, new_id, level)
  select src.id, coalesce(ins.id, existing.id), 2
    from src
    join partner_tcopy p on p.crm_id = src.parent_id and p.level = 1
    left join ins on ins.parent_id = p.new_id and ins.lname = lower(src.name)
    left join partner_territories existing
           on existing.parent_id = p.new_id and lower(existing.name) = lower(src.name)
   where coalesce(ins.id, existing.id) is not null
  on conflict (crm_id) do nothing;
  select count(*) into v_states from partner_tcopy where level = 2;

  -- Level 3 — cities.
  with src as (
    select t.id, t.name, t.code, t.parent_id
      from territories t
     where t.account_id = v_account and t.deleted_at is null and t.level = 3
  ), ins as (
    insert into partner_territories (parent_id, level, name, code, status, is_seed_data)
    select p.new_id, 3, src.name, src.code, 'active', true
      from src join partner_tcopy p on p.crm_id = src.parent_id and p.level = 2
    on conflict do nothing
    returning id, parent_id, lower(name) as lname
  )
  insert into partner_tcopy (crm_id, new_id, level)
  select src.id, coalesce(ins.id, existing.id), 3
    from src
    join partner_tcopy p on p.crm_id = src.parent_id and p.level = 2
    left join ins on ins.parent_id = p.new_id and ins.lname = lower(src.name)
    left join partner_territories existing
           on existing.parent_id = p.new_id and lower(existing.name) = lower(src.name)
   where coalesce(ins.id, existing.id) is not null
  on conflict (crm_id) do nothing;
  select count(*) into v_cities from partner_tcopy where level = 3;

  -- Level 4 — areas.
  with src as (
    select t.id, t.name, t.code, t.parent_id
      from territories t
     where t.account_id = v_account and t.deleted_at is null and t.level = 4
  ), ins as (
    insert into partner_territories (parent_id, level, name, code, status, is_seed_data)
    select p.new_id, 4, src.name, src.code, 'active', true
      from src join partner_tcopy p on p.crm_id = src.parent_id and p.level = 3
    on conflict do nothing
    returning id, parent_id, lower(name) as lname
  )
  insert into partner_tcopy (crm_id, new_id, level)
  select src.id, coalesce(ins.id, existing.id), 4
    from src
    join partner_tcopy p on p.crm_id = src.parent_id and p.level = 3
    left join ins on ins.parent_id = p.new_id and ins.lname = lower(src.name)
    left join partner_territories existing
           on existing.parent_id = p.new_id and lower(existing.name) = lower(src.name)
   where coalesce(ins.id, existing.id) is not null
  on conflict (crm_id) do nothing;
  select count(*) into v_areas from partner_tcopy where level = 4;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'countries', v_countries,
    'states', v_states,
    'cities', v_cities,
    'areas', v_areas
  );
end;
$$;

revoke all on function public.partner_territory_copy_from_crm(uuid) from public, anon;
grant execute on function public.partner_territory_copy_from_crm(uuid) to authenticated;

comment on function public.partner_territory_copy_from_crm(uuid) is
  'Copies the CRM''s territory tree into partner_territories, parents first. Definer because it reads account-scoped territories; manage_masters is checked on the caller''s own session first. Idempotent.';

commit;
