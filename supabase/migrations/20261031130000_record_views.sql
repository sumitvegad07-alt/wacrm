-- Which records each user has already opened.
--
-- One row = "this user has opened this record". It exists so a list can show a
-- new entry differently — bolder, tinted — until the person looking at the list
-- has actually opened it. Not "new to the company": new *to you*. Two people
-- looking at the same Orders list see their own unopened rows highlighted, which
-- is the only reading of "new" that is useful to either of them.
--
-- Deliberately per record and not a per-screen high-water mark. A stored
-- "last time you opened the Orders list" timestamp is a fraction of the storage
-- and was the cheaper design, but one glance at the list would clear every row
-- in it, including the ones that glance never read. The founder asked for the
-- row to stay marked until he opens that row, and this is the only shape that
-- can do it.
--
-- user_id is the AUTH user id, not profiles.id. Those are two different id
-- spaces in this schema (profiles.id is its own uuid, profiles.user_id is the
-- auth id), they are genuinely confusable, and mixing them up is how a filter
-- silently matches nothing. `table_views` (migration 20261007120000) made the
-- same choice for the same reason; `saved_reports` got it wrong and references
-- profiles(id) while comparing against auth.uid().
--
-- record_id is intentionally NOT a foreign key. It points into nine different
-- tables depending on module_name, so no single reference is possible, and a
-- polymorphic FK is not a thing Postgres has. The consequence is that deleting
-- a record leaves its view rows behind as harmless orphans — see the retention
-- note at the bottom.

create table if not exists public.record_views (
  -- Who opened it. Cascades: a deleted login's reading history is meaningless.
  user_id     uuid not null references auth.users(id)       on delete cascade,
  -- Which list the record belongs to: 'contact', 'lead', 'deal', 'quotation',
  -- 'order', 'payment', 'expense', 'task' or 'product'. Same singular
  -- vocabulary as custom_fields.module_name and module_activities.module_name,
  -- so there is one set of module names in this schema rather than three.
  module_name text not null,
  record_id   uuid not null,
  -- Carried for tenant hygiene and for the retention jobs, which work per
  -- account. Cascades with the account like everything else tenant-scoped.
  account_id  uuid not null references public.accounts(id)  on delete cascade,
  viewed_at   timestamptz not null default now(),

  -- The natural key IS the row: one user, one record, opened or not opened.
  -- Being the primary key is also what makes the upsert on open a single
  -- statement with no read first, and what serves the list's lookup below.
  primary key (user_id, module_name, record_id)
);

-- The list's question is "of these twenty records, which have I opened?", i.e.
-- user_id = me AND module_name = this list AND record_id = ANY(...). The primary
-- key's leading columns answer exactly that, so no further index is needed for
-- the read path.

-- The purge path's question is "everything belonging to this account", which the
-- primary key cannot answer.
create index if not exists record_views_account_idx
  on public.record_views (account_id);

alter table public.record_views enable row level security;

-- A user may read and write only their own reading history. There is no policy
-- for reading anyone else's: whether a colleague has opened a record is not
-- information this feature needs, and not information worth exposing.
--
-- auth.uid() is wrapped in a scalar subquery so Postgres evaluates it once per
-- query instead of once per row (the September 2026 RLS initplan pass).
drop policy if exists record_views_own on public.record_views;
create policy record_views_own on public.record_views
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No delete: nothing in the app removes a view row, and a user cannot usefully
-- un-see a record. Pruning is the retention job's business, under the service
-- role, which RLS does not apply to.
grant select, insert, update on public.record_views to authenticated;

comment on table public.record_views is
  'Which records a user has already opened, so a list can highlight entries that '
  'user has not seen yet. user_id is an auth.users id. module_name uses the same '
  'singular vocabulary as custom_fields.module_name. record_id is polymorphic — it '
  'points into the table named by module_name — so it has no foreign key.';

-- ---------------------------------------------------------------------------
-- A note for whoever next touches the retention jobs (data-retention policy,
-- migration 20260903*): rows here can be pruned aggressively and safely.
--
-- A record only counts as "new" for a bounded window after it was created
-- (NEW_FOR_DAYS in src/lib/record-views/unseen.ts, 30 days at the time of
-- writing) — otherwise an employee's first login would light up every row in
-- the account and the highlight would mean nothing. Past that window the
-- record is never highlighted again whether or not a view row exists, so any
-- row here older than the window has no effect on anything and can be deleted:
--
--   delete from public.record_views where viewed_at < now() - interval '60 days';
--
-- That also sweeps up the orphans left behind by deleted records. Not wired up
-- here on purpose: this table has to earn its keep before it earns a cron job,
-- and at a few rows per record opened it will be small for a long time.
-- ---------------------------------------------------------------------------
