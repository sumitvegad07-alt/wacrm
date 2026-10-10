-- ============================================================
-- 20261010200000_revenue_discovery_worker_token.sql
--
-- Lead Discovery: let a harvest hand itself on without a shared secret.
--
-- WHAT WENT WRONG
--
-- The worker route was guarded by CRON_SECRET, copied from the retention job.
-- That variable is not set on this project, so `kickWorker` could never
-- authenticate — which meant a harvest did its first chunk and then stopped
-- dead, with no way for anything to pick it back up. It looked exactly like the
-- browser-tab problem it was meant to cure, and the run sat in 'queued' for
-- ever, blocking every later harvest with "a harvest is already going".
--
-- A feature should not be one unset environment variable away from silently not
-- working, so the hand-off no longer depends on one.
--
-- WHAT REPLACES IT
--
-- A single-use token on the run itself. The worker that is handing on mints a
-- fresh one, writes it here, and sends it; the next worker is let in only if it
-- presents the token currently on that run, and claiming it clears the token.
--
-- This is stronger than the shared secret it replaces, not weaker: a leaked
-- token is good for one hand-off of one harvest, where a leaked CRON_SECRET
-- would be good for every endpoint guarded by it, for ever. CRON_SECRET still
-- works if it is ever set, for prodding a run by hand.
-- ============================================================

alter table public.re_discovery_runs
  add column if not exists worker_token uuid;

comment on column public.re_discovery_runs.worker_token is
  'Single-use token letting one worker invocation hand this harvest on to the next. Cleared as it is redeemed; null means no hand-off is outstanding.';

-- ── Redeeming a hand-off ──
--
-- Verify and clear in one statement. Two invocations racing on the same token —
-- a retry, a duplicated request — must not both be let through, and checking
-- then clearing from the route would leave exactly that gap.
create or replace function public.re_discovery_redeem_token(p_run_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok uuid;
begin
  update public.re_discovery_runs
     set worker_token = null
   where id = p_run_id
     and worker_token is not null
     and worker_token = p_token
  returning id into v_ok;

  return v_ok is not null;
end;
$$;

comment on function public.re_discovery_redeem_token(uuid, uuid) is
  'Spends a hand-off token. True exactly once per token; false for a wrong, missing or already-spent one.';

revoke all on function public.re_discovery_redeem_token(uuid, uuid) from anon, authenticated;
