-- ============================================================
-- 20261010100000_revenue_discovery_leads.sql
--
-- Lead Discovery: keep the harvested rows for 90 days so a CSV can be
-- downloaded again.
--
-- WHY THIS REVERSES A DELIBERATE DECISION
--
-- 20261006100000_revenue_lead_discovery.sql stored no company names, phones or
-- addresses on purpose: Google's Places terms let a Place ID be kept forever
-- but not the rest. The cost of that restraint turned out to be higher than the
-- restraint was worth:
--
--   * the rows existed only in one browser tab, so Chrome discarding that tab
--     (Memory Saver) or a stray click on another menu item threw away a harvest
--     that had already been paid for in quota;
--   * a CSV saved to the wrong folder, or opened and closed without saving, was
--     gone — and getting it back meant paying the quota a second time.
--
-- So the rows are now kept, but only for 90 DAYS, which is a defensible read of
-- the caching terms rather than warehousing. After that the rows are deleted and
-- only the Place IDs remain, so duplicate checking keeps working forever while
-- the prospect data does not linger.
--
-- The purge runs from the API route on page load (see
-- src/app/api/admin/revenue/discover/route.ts). A cron job would be a second
-- place to go wrong for a table only the founder's own tool writes to.
--
-- Founder-only, like the other three re_discovery_* tables: RLS on, no
-- policies, reachable only through the service role after requireFounder().
-- ============================================================

-- ── 1. The rows a harvest produced ──
create table if not exists public.re_discovery_leads (
  id                     bigserial primary key,
  run_id                 uuid not null references public.re_discovery_runs (id) on delete cascade,
  -- The exact search this row came out of. Carried so "download what I found
  -- last time for this combination" can be answered precisely: a run may cover
  -- more districts than the selection being asked about.
  query_text             text not null,
  place_id               text not null,
  name                   text not null default '',
  phone                  text not null default '',
  website                text not null default '',
  address                text not null default '',
  area                   text not null default '',
  city                   text not null default '',
  district               text not null default '',
  state                  text not null default '',
  pincode                text not null default '',
  searched_in            text not null default '',
  outside_searched_area  boolean not null default false,
  latitude               text not null default '',
  longitude              text not null default '',
  rating                 text not null default '',
  reviews                text not null default '',
  primary_type           text not null default '',
  industry               text not null default '',
  created_at             timestamptz not null default now(),
  -- One row per company per harvest. With "Ignore my previous harvests" ticked
  -- the same company can come back from two searches of the same run; this
  -- keeps the first and drops the repeat instead of doubling the CSV.
  unique (run_id, place_id)
);

comment on table public.re_discovery_leads is
  'Rows a Lead Discovery harvest produced, kept 90 days so the CSV can be downloaded again. Purged by the discover API; re_discovery_seen_places keeps the Place IDs permanently for deduplication.';

comment on column public.re_discovery_leads.query_text is
  'The Google search text this row came from, so a re-download can be scoped to one district/area selection rather than a whole run.';

create index if not exists re_discovery_leads_run_idx
  on public.re_discovery_leads (run_id);

-- The purge reads this.
create index if not exists re_discovery_leads_created_idx
  on public.re_discovery_leads (created_at);

-- "What did I find last time for this exact search?"
create index if not exists re_discovery_leads_query_idx
  on public.re_discovery_leads (query_text, created_at desc);

-- ── 2. How many rows a past harvest still has ──
--
-- Denormalised so the Past harvests list can offer "Download 1,240 leads"
-- without counting rows across every listed run on each page load.
alter table public.re_discovery_runs
  add column if not exists leads_stored integer not null default 0;

comment on column public.re_discovery_runs.leads_stored is
  'Rows of this harvest still held in re_discovery_leads. Zeroed by the 90-day purge, so 0 means "nothing left to download".';

-- Whether this harvest was started with "Ignore my previous harvests" ticked.
--
-- Recorded because resuming an interrupted harvest has to rebuild the plan the
-- same way it was built the first time. Without this, a run started to pull a
-- district again from scratch would resume with every search marked "already
-- done" and finish instantly, having fetched nothing.
alter table public.re_discovery_runs
  add column if not exists ignore_seen boolean not null default false;

-- ── 3. Counting up, atomically ──
--
-- The harvest writes one batch per search. Read-modify-write from the route
-- would be correct today (one browser loop writes per run, in order) and wrong
-- the moment two tabs resume the same run, so the increment happens in the
-- database instead.
create or replace function public.re_discovery_add_leads(p_run_id uuid, p_count integer)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.re_discovery_runs
     set leads_stored = leads_stored + greatest(p_count, 0)
   where id = p_run_id;
$$;

comment on function public.re_discovery_add_leads(uuid, integer) is
  'Adds to re_discovery_runs.leads_stored atomically. Founder tool only; execute is revoked from anon and authenticated.';

-- ── 4. Lock it down ──
alter table public.re_discovery_leads enable row level security;

revoke all on public.re_discovery_leads from anon, authenticated;
revoke all on sequence public.re_discovery_leads_id_seq from anon, authenticated;
revoke all on function public.re_discovery_add_leads(uuid, integer) from anon, authenticated;
-- Deliberately no policies: platform-owner business data, not tenant data.
