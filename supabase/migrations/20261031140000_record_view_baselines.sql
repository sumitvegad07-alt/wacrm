-- When each user first looked at each list.
--
-- This is the correction to a flaw in record_views (migration 20261031130000)
-- that only showed up against real data.
--
-- "Highlight any record you have never opened" sounds right and is useless on
-- its own. On the founder's own Leads list every one of 201 records was created
-- inside the thirty-day window and none had ever been opened through the new
-- code, so every single row qualified — and a list where every row is
-- highlighted looks exactly like a list where none is. His words were "no
-- difference at all", and he was right: the feature was working perfectly and
-- showing him nothing.
--
-- The missing idea is the one every unread-marker has: a starting line. What
-- was already there when you first looked is not unread, it is just old. Only
-- what arrives after that can be new. So one row per user per list, holding the
-- moment that user first opened it, written once and never updated.
--
-- Consequence worth being clear about: a record created before the user's
-- baseline is never highlighted, however long it sits unopened. That is the
-- point. The highlight answers "what landed since I last cared?", not "what
-- have I never clicked?" — the second question has 201 answers and no use.
--
-- user_id is the AUTH user id, matching record_views and table_views. See the
-- note in 20261031130000 about the two id spaces in this schema.

create table if not exists public.record_view_baselines (
  user_id     uuid not null references auth.users(id)      on delete cascade,
  -- Same singular vocabulary as record_views.module_name and
  -- custom_fields.module_name: 'contact', 'lead', 'deal', 'quotation', 'order',
  -- 'payment', 'expense', 'task', 'product'.
  module_name text not null,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  -- Nothing created at or before this instant is ever new to this user on this
  -- list. Set once, on that user's first visit, and never moved: moving it
  -- forward on later visits would silently clear records they never read, which
  -- is the per-screen high-water mark that was rejected when this was designed.
  baseline_at timestamptz not null default now(),

  primary key (user_id, module_name)
);

create index if not exists record_view_baselines_account_idx
  on public.record_view_baselines (account_id);

alter table public.record_view_baselines enable row level security;

-- Own rows only, same as record_views. auth.uid() in a scalar subquery so it is
-- evaluated once per query rather than once per row.
drop policy if exists record_view_baselines_own on public.record_view_baselines;
create policy record_view_baselines_own on public.record_view_baselines
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Select and insert only. No update grant, deliberately: the app has no reason
-- to move a baseline, and not granting it is a cheaper guarantee than
-- remembering not to.
grant select, insert on public.record_view_baselines to authenticated;

comment on table public.record_view_baselines is
  'The moment each user first opened each list. Records created at or before it are '
  'never highlighted as new for that user, so switching the highlight on does not '
  'light up every row that already existed. Written once per user per module and '
  'never updated. user_id is an auth.users id.';
