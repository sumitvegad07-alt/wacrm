-- Saved table views.
--
-- One row = one named arrangement of one list screen, owned by one user:
-- its column filters, its visible columns and their order, and its rows-per-page.
--
-- Private per user. No sharing: `saved_reports` shipped a private/team/organization
-- sharing mode in which 'team' had no RLS policy behind it and silently behaved as
-- private, and it was torn out on 2026-08-16. Sharing here would need a real
-- permission model, so until it has one there is none.
--
-- user_id is the AUTH user id, not profiles.id. Those are two different id spaces in
-- this schema (profiles.id is its own uuid, profiles.user_id is the auth id), and
-- saved_reports got that wrong: it references profiles(id) while its policies compare
-- against auth.uid().

create table if not exists public.table_views (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  user_id     uuid not null references auth.users(id)      on delete cascade,
  -- The DataTable storage key with any trailing _v<n> stripped, e.g.
  -- 'wacrm_leads_table_columns'. Developers bump those suffixes to force-reset stored
  -- column layouts; keying views off the raw string would orphan every saved view the
  -- next time someone did that.
  table_key   text not null,
  name        text not null,
  -- { filters: {...}, columns: { active: [...], visible: [...] } | null, pageSize: int | null }
  config      jsonb not null default '{}'::jsonb,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint table_views_name_not_blank check (btrim(name) <> '')
);

-- No two views with the same name on the same table, case-insensitively.
create unique index if not exists table_views_user_table_name_key
  on public.table_views (user_id, table_key, lower(name));

-- At most one default per user per table, enforced by the database rather than by the
-- app remembering to clear the old one.
create unique index if not exists table_views_one_default_per_table
  on public.table_views (user_id, table_key)
  where is_default;

create index if not exists table_views_user_table_idx
  on public.table_views (user_id, table_key);

alter table public.table_views enable row level security;

-- auth.uid() is wrapped in a scalar subquery so Postgres evaluates it once per query
-- instead of once per row (the September 2026 RLS initplan pass).
drop policy if exists table_views_own on public.table_views;
create policy table_views_own on public.table_views
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.table_views to authenticated;

create or replace function public.table_views_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists table_views_touch on public.table_views;
create trigger table_views_touch
  before update on public.table_views
  for each row execute function public.table_views_touch_updated_at();

comment on table public.table_views is
  'Named list-screen arrangements (filters, column layout, rows per page) saved by a user. '
  'Private to user_id, which is an auth.users id. table_key is the DataTable storage key '
  'with any trailing _v<n> removed.';
