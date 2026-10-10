-- ============================================================
-- 20261010180000_revenue_discovery_background_runs.sql
--
-- Lead Discovery: the harvest moves off the founder's browser tab and onto
-- the server.
--
-- WHY THE BROWSER DROVE IT IN THE FIRST PLACE
--
-- One harvest is up to ~163 Google searches, several minutes of wall clock,
-- which does not fit in a single serverless invocation. Driving it from the
-- page meant one short request per search and no job queue to get stuck. The
-- stated cost was "the tab must stay open".
--
-- That cost turned out to be the whole feature. Chrome discards a background
-- tab within seconds of switching to another browser, and nobody watches a
-- progress bar for ten minutes — the founder starts a harvest and goes to do
-- other work, which is exactly when the tab dies. Saving the rows as they
-- arrived made the loss recoverable, and resuming automatically made the
-- recovery invisible, but both were treatments for a wound that should not
-- exist: the harvest was never the browser's job.
--
-- WHAT RUNS IT NOW
--
-- The run row IS the job. `next_index` is where the worker has got to,
-- `heartbeat_at` is proof it is still alive, and any worker invocation can pick
-- up any run that has gone quiet. A worker harvests until it runs out of time,
-- then hands on to a fresh invocation; if a hand-off is ever lost, the next
-- worker to look — a page load is enough — carries it on. Nothing is lost
-- either way, because every row is already in re_discovery_leads.
--
-- The claim is `where heartbeat_at < now() - interval`, which is what stops two
-- workers harvesting the same run and paying Google twice.
-- ============================================================

-- ── 1. The run row becomes the job ──
alter table public.re_discovery_runs
  -- Where the worker has got to in the plan. The plan itself is rebuilt
  -- deterministically from the industry/state/districts columns, so an index is
  -- all that has to be stored.
  add column if not exists next_index             integer not null default 0,
  -- Last sign of life. A run whose heartbeat has gone stale is free to claim.
  add column if not exists heartbeat_at           timestamptz,
  -- Was a per-request flag from the browser; the server now owns the whole
  -- harvest, so it has to be part of the job.
  add column if not exists include_without_phone  boolean not null default false,
  -- Set by Stop. Read between searches, never mid-search: a search already paid
  -- for is always banked.
  add column if not exists cancel_requested       boolean not null default false,
  -- Why the harvest ended, in the founder's words — daily cap, free calls gone,
  -- Google refusing. Shown on the page when he comes back to it.
  add column if not exists stop_reason            text,
  add column if not exists last_error             text;

comment on column public.re_discovery_runs.next_index is
  'First search of the rebuilt plan not yet done. The worker resumes here, so a lost invocation costs nothing.';

comment on column public.re_discovery_runs.heartbeat_at is
  'Last time a worker touched this run. Stale means abandoned and claimable; it is the lock that stops two workers paying Google for the same search.';

-- ── 2. Statuses for a job, not for a page ──
--
-- 'abandoned' is kept only because rows already carry it. New runs use
-- 'stopped' when the founder stops one and 'failed' when the worker cannot
-- carry on, which the old vocabulary could not tell apart.
alter table public.re_discovery_runs
  drop constraint if exists re_discovery_runs_status_check;

alter table public.re_discovery_runs
  add constraint re_discovery_runs_status_check
  check (status in ('queued', 'running', 'finished', 'abandoned', 'stopped', 'failed'));

alter table public.re_discovery_runs
  alter column status set default 'queued';

-- Finding the one run that still needs work, without reading the history.
create index if not exists re_discovery_runs_active_idx
  on public.re_discovery_runs (status, heartbeat_at)
  where status in ('queued', 'running');

-- ── 3. Claiming a run, atomically ──
--
-- The whole safety of running this anywhere other than one browser tab rests
-- on this function. Two workers waking at once — a page load and a hand-off,
-- say — must not both start harvesting: the loser would re-run searches the
-- winner is already paying for.
--
-- `for update skip locked` makes the race a non-event rather than something to
-- detect afterwards, and the heartbeat window means a worker that died without
-- tidying up releases its run on its own.
create or replace function public.re_discovery_claim_run(
  p_run_id      uuid,
  p_stale_after interval default interval '90 seconds'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed uuid;
begin
  select id into v_claimed
    from public.re_discovery_runs
   where id = p_run_id
     and status in ('queued', 'running')
     and cancel_requested = false
     and (heartbeat_at is null or heartbeat_at < now() - p_stale_after)
     for update skip locked;

  if v_claimed is null then
    return false;
  end if;

  update public.re_discovery_runs
     set status = 'running', heartbeat_at = now()
   where id = v_claimed;

  return true;
end;
$$;

comment on function public.re_discovery_claim_run(uuid, interval) is
  'Takes ownership of a harvest if nothing else holds it. False means another worker has it; the caller must then do nothing at all.';

revoke all on function public.re_discovery_claim_run(uuid, interval) from anon, authenticated;

-- ── 4. Runs orphaned by the change ──
--
-- Anything left 'running' was driven by a browser tab that is long gone. The
-- worker would otherwise treat these as live work and start harvesting history
-- the moment it looked.
update public.re_discovery_runs
   set status = 'abandoned'
 where status = 'running'
   and heartbeat_at is null;
