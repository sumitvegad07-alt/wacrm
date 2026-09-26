-- ============================================================
-- Proposal status, for the forecasting dashboard.
--
--   draft → sent → won | lost
--
-- Only `sent` counts as pipeline, so an abandoned draft never inflates the
-- forecast. `decided_at` is stamped when a proposal is marked won or lost, and
-- it is the month the dashboard counts the business in — marking an old
-- proposal won today books it in today's month, which is how the founder
-- tracks what actually landed.
-- ============================================================

alter table public.platform_proposals
  add column if not exists status     text not null default 'draft',
  add column if not exists sent_at    timestamptz,
  add column if not exists decided_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'platform_proposals_status_check'
  ) then
    alter table public.platform_proposals
      add constraint platform_proposals_status_check
      check (status in ('draft', 'sent', 'won', 'lost'));
  end if;
end $$;

comment on column public.platform_proposals.decided_at is
  'When the proposal was marked won or lost. Its month is the month the business is counted in.';

-- The dashboard filters by status and buckets won deals by decided_at.
create index if not exists platform_proposals_status_idx
  on public.platform_proposals (status);

create index if not exists platform_proposals_decided_idx
  on public.platform_proposals (decided_at desc);
