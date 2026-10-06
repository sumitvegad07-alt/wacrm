-- ============================================================
-- 20261006100000_revenue_lead_discovery.sql
--
-- Lead Discovery: the founder's own prospecting tool at
-- /admin/revenue/discover. Searches Google Places for SFA prospects and hands
-- back a CSV. First of the `re_*` (revenue engine) tables.
--
-- WHAT THESE TABLES DELIBERATELY DO NOT STORE
--
-- No business names, no phone numbers, no addresses. Only the Google Place ID,
-- which is the one field Google's terms allow keeping indefinitely — everything
-- else must not be warehoused. So the prospect data lives in the CSV on the
-- founder's own machine and in the leads table of HIS OWN sales account, while
-- the server keeps just enough to (a) count calls against the free quota and
-- (b) know which places an earlier harvest already produced.
--
-- That restraint is also why this is cheap: three small tables, no tenant data,
-- no RLS surface. They touch neither `leads` nor `contacts`.
--
-- Founder-only, like every other `/admin` table: RLS on, no policies, reachable
-- only through the service role after requireFounder() has passed.
-- ============================================================

-- ── 1. One row per harvest ──
create table if not exists public.re_discovery_runs (
  id               uuid primary key default gen_random_uuid(),
  -- auth.users id of whoever ran it. Present from day one so a telecaller
  -- login later is a login, not a migration.
  owner_id         uuid not null references auth.users (id) on delete cascade,
  industry         text not null,
  industry_label   text not null,
  category         text not null,
  state            text not null,
  districts        text[] not null default '{}',
  areas            text[] not null default '{}',
  pincode          text,
  queries_planned  integer not null default 0,
  queries_done     integer not null default 0,
  calls_used       integer not null default 0,
  rows_found       integer not null default 0,
  rows_new         integer not null default 0,
  status           text not null default 'running'
                     check (status in ('running', 'finished', 'abandoned')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

comment on table public.re_discovery_runs is
  'One row per Lead Discovery harvest (founder tool). Counts only — no prospect names, phones or addresses are stored here by design.';

create index if not exists re_discovery_runs_owner_started_idx
  on public.re_discovery_runs (owner_id, started_at desc);

-- ── 2. One row per search, which is what the quota counter reads ──
--
-- Per-query rather than per-run: if the browser tab closes mid-harvest the calls
-- already spent are still counted, so the daily cap cannot be walked past by
-- restarting.
create table if not exists public.re_discovery_queries (
  id             bigserial primary key,
  run_id         uuid not null references public.re_discovery_runs (id) on delete cascade,
  query_text     text not null,
  district       text,
  area           text,
  pages_fetched  integer not null default 0,
  -- Billable Google calls this query cost: one per page fetched.
  calls_used     integer not null default 0,
  results_count  integer not null default 0,
  new_count      integer not null default 0,
  error          text,
  created_at     timestamptz not null default now()
);

comment on table public.re_discovery_queries is
  'One row per Google Places search. calls_used is the billable page count; summed over today it enforces the daily free-tier cap.';

create index if not exists re_discovery_queries_created_idx
  on public.re_discovery_queries (created_at desc);

create index if not exists re_discovery_queries_run_idx
  on public.re_discovery_queries (run_id);

-- ── 3. Place IDs already harvested ──
--
-- The whole cross-run deduplication mechanism. A Google Place ID is an opaque
-- key, not business data, and is the one Places field that may be stored
-- permanently — so this table gives "never show me a company I already pulled"
-- for free, with nothing sensitive in it.
create table if not exists public.re_discovery_seen_places (
  place_id    text primary key,
  run_id      uuid references public.re_discovery_runs (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.re_discovery_seen_places is
  'Google Place IDs seen by any past harvest, so later harvests never repeat a company. Place IDs only — Google permits storing these indefinitely, unlike names, phones and addresses.';

comment on column public.re_discovery_seen_places.run_id is
  'The harvest that first produced this place. Nullable: the ID must survive its run row being deleted, or deduplication silently regresses.';

-- ── 4. Lock all three down ──
alter table public.re_discovery_runs enable row level security;
alter table public.re_discovery_queries enable row level security;
alter table public.re_discovery_seen_places enable row level security;

revoke all on public.re_discovery_runs from anon, authenticated;
revoke all on public.re_discovery_queries from anon, authenticated;
revoke all on public.re_discovery_seen_places from anon, authenticated;
revoke all on sequence public.re_discovery_queries_id_seq from anon, authenticated;
-- Deliberately no policies: platform-owner business data, not tenant data.
