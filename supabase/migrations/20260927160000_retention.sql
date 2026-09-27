-- ============================================================
-- Data retention: the daily location summary, the per-account override, and
-- the run log.
--
-- Implements the published policy at ozzo.co.in/privacy#retention — business
-- data kept while the account is active, tracking data one year, technical logs
-- 90 days. What is eligible for deletion is decided in
-- src/lib/retention/policy.ts, which is the single source of truth and is
-- tested; this migration only provides the places to write to.
--
-- The ordering rule that makes this safe: a day's pings may only be deleted
-- once that day exists in location_daily_summary. The summary is the only
-- record that survives, so writing it must come first and must have succeeded.
-- ============================================================

-- ── 1. The summary that outlives the raw points ──
create table if not exists public.location_daily_summary (
  id            bigserial primary key,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  user_id       uuid not null,
  day           date not null,
  distance_km   numeric(10,3) not null default 0,
  ping_count    integer not null default 0,
  mocked_count  integer not null default 0,
  first_at      timestamptz not null,
  last_at       timestamptz not null,
  first_lat     double precision not null,
  first_lng     double precision not null,
  last_lat      double precision not null,
  last_lng      double precision not null,
  created_at    timestamptz not null default now(),
  unique (account_id, user_id, day)
);

comment on table public.location_daily_summary is
  'One row per user per day, derived from location_pings before those pings are deleted. Distance excludes pings flagged is_mocked; mocked_count records how many were excluded.';
comment on column public.location_daily_summary.distance_km is
  'Kilometres over genuine pings only. A faked location can sit anywhere on earth and would add hundreds of km.';

-- The reports read this by account and date range, and the retention job checks
-- "does a summary exist for this user and day" on every batch.
create index if not exists location_daily_summary_account_day_idx
  on public.location_daily_summary (account_id, day desc);

create index if not exists location_daily_summary_user_day_idx
  on public.location_daily_summary (user_id, day desc);

alter table public.location_daily_summary enable row level security;

-- Mirrors location_pings_select exactly: a user sees their own days, and anyone
-- with agent rights on the account sees the account's. Summarising must not
-- widen who can see where somebody has been.
drop policy if exists location_daily_summary_select on public.location_daily_summary;
create policy location_daily_summary_select
  on public.location_daily_summary
  for select
  using (
    (user_id = (select auth.uid()))
    or public.is_account_member(account_id, 'agent'::account_role_enum)
  );

-- Written only by the retention job through the service role. No insert, update
-- or delete policy exists, so nothing else can forge or alter a summary.

-- ── 2. Per-account retention override ──
alter table public.accounts
  add column if not exists retention_days integer;

comment on column public.accounts.retention_days is
  'Days to keep TRACKING data for this account. NULL means the platform default (365). Founder-set only; never exposed to tenants. Does not affect technical logs.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_retention_days_check'
  ) then
    alter table public.accounts
      add constraint accounts_retention_days_check
      check (retention_days is null or (retention_days >= 30 and retention_days <= 3650));
  end if;
end $$;

-- ── 3. Run log ──
-- Deletion is irreversible, so every run leaves a record of what it did, in
-- preview mode as well as in earnest. Without this there is no way to answer
-- "what did the job remove last Tuesday".
create table if not exists public.retention_runs (
  id               bigserial primary key,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  mode             text not null check (mode in ('preview', 'delete')),
  summarised_days  integer not null default 0,
  rows_affected    integer not null default 0,
  detail           jsonb not null default '{}'::jsonb,
  error            text
);

comment on table public.retention_runs is
  'One row per retention job run. mode=preview counts what WOULD be removed and changes nothing. Founder-only; RLS denies all, reachable through the service role.';

create index if not exists retention_runs_started_idx
  on public.retention_runs (started_at desc);

alter table public.retention_runs enable row level security;
revoke all on public.retention_runs from anon, authenticated;
revoke all on sequence public.retention_runs_id_seq from anon, authenticated;
-- Deliberately no policies: platform operations data, not tenant data.

-- ── 4. Which days still need summarising ──
--
-- Deliberately a query helper, not policy: it answers "which user-days older
-- than this cutoff have pings but no summary yet". What the cutoff IS, and
-- which tables are eligible at all, stays in src/lib/retention/policy.ts where
-- it is tested. Two copies of the rules in two languages is the drift the
-- pricing engine already had to be rescued from.
--
-- The day is computed in the ACCOUNT'S timezone. On UTC, 20:30 is already the
-- next morning in India, and a rep's evening would be filed under the wrong day
-- — permanently, because the raw pings are deleted immediately afterwards.
create or replace function public.retention_pending_days(
  p_account uuid,
  p_before  timestamptz,
  p_tz      text default 'Asia/Kolkata',
  p_limit   integer default 200
)
returns table (user_id uuid, day date)
language sql
security definer
set search_path = public, pg_temp
as $$
  select p.user_id,
         (p.recorded_at at time zone p_tz)::date as day
  from public.location_pings p
  where p.account_id = p_account
    and p.recorded_at < p_before
  group by 1, 2
  having not exists (
    select 1
    from public.location_daily_summary s
    where s.account_id = p_account
      and s.user_id = p.user_id
      and s.day = (p.recorded_at at time zone p_tz)::date
  )
  order by 2, 1
  limit p_limit;
$$;

comment on function public.retention_pending_days is
  'User-days with pings older than the cutoff and no summary yet. Called by the retention job through the service role only.';

revoke all on function public.retention_pending_days(uuid, timestamptz, text, integer)
  from anon, authenticated;
