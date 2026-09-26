-- ============================================================
-- platform_proposals — OZZO's own sales proposals.
--
-- This is platform data, not tenant data: there is no account_id and no
-- tenant-scoped policy, because no tenant should ever see a row here. RLS is
-- enabled with NO policies at all, so the `authenticated` role has zero access
-- through the anon/publishable key — including for the founder's own session.
--
-- Every read and write goes through /api/admin/proposals, which calls
-- requireFounder() on the caller's own session and only then uses the
-- service-role key. That is the same pattern the rest of the superadmin panel
-- follows (see src/lib/auth/superadmin.ts): verify on the user's session,
-- execute with the service role. Consequence: not even a second superadmin, or
-- a compromised superadmin session, can read OZZO's pricing history.
--
-- The denormalised columns (ref, client_name, totals…) exist so the history
-- list can answer "what did I quote them" with an ordinary indexed query
-- instead of parsing JSONB. `data` holds the full editable payload.
-- ============================================================

create table if not exists public.platform_proposals (
  id             uuid primary key default gen_random_uuid(),
  ref            text        not null,
  plan           text        not null default 'SFA',
  client_name    text        not null default '',
  proposal_date  date        not null default current_date,
  gst_enabled    boolean     not null default false,
  users_total    integer     not null default 0,
  annual_total   numeric(12,2) not null default 0,
  grand_total    numeric(12,2) not null default 0,
  data           jsonb       not null default '{}'::jsonb,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.platform_proposals is
  'OZZO sales proposals (founder-only). RLS denies all; access via /api/admin/proposals with the service role.';

-- The history list is ordered newest-first and filtered by month when
-- generating the next reference number.
create index if not exists platform_proposals_date_idx
  on public.platform_proposals (proposal_date desc);

create index if not exists platform_proposals_created_idx
  on public.platform_proposals (created_at desc);

alter table public.platform_proposals enable row level security;

-- Deliberately no policies. Do not add one "for convenience": a policy here
-- would expose OZZO's quoted prices to every signed-in tenant user.

-- Belt and braces alongside the empty policy set: even if a policy were added
-- by mistake, the table grants nothing to the client-facing roles. The
-- service-role key bypasses both, which is how the API reaches it.
revoke all on public.platform_proposals from anon, authenticated;

-- Keep updated_at honest without relying on the API to remember.
create or replace function public.touch_platform_proposals_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_proposals_touch_updated_at on public.platform_proposals;
create trigger platform_proposals_touch_updated_at
  before update on public.platform_proposals
  for each row execute function public.touch_platform_proposals_updated_at();
