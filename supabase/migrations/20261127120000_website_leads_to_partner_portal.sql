-- ════════════════════════════════════════════════════════════════════════
-- Website leads land in the Partner Portal, source "Website"
--
-- WHAT WAS WRONG
--
-- Every lead the marketing site takes — the demo form, the price calculator —
-- is inserted into public.website_inquiries and nothing has ever read that
-- table. Grep both app repos for the name: zero hits. The leads existed, the
-- founder got an email and a WhatsApp alert, and then they sat in a table
-- with no screen, no owner and no follow-up. 30 of them by 25 November 2026,
-- 29 in the last thirty days.
--
-- WHY A DATABASE TRIGGER AND NOT AN API CALL
--
-- The site could POST to the portal after it saves. That adds a second thing
-- that must be up at the moment a stranger fills a form, a shared secret in
-- two Vercel projects, and a silent failure mode — the one the alerts already
-- have, where a stale token loses the lead and nothing says so.
--
-- A trigger cannot be out of date, cannot be forgotten by the next route
-- somebody adds, and runs inside the same transaction as the insert that
-- causes it. Any path that writes a website_inquiries row — today's two
-- routes, tomorrow's third — lands in the portal by construction.
--
-- NOTHING HERE MAY EVER FAIL A SUBMISSION. A stranger filling in a form must
-- not see an error because the portal end of this had a problem. Every step
-- after the inquiry row itself runs inside an exception block: if it breaks,
-- the reason is written to website_inquiries.portal_note and the submission
-- still succeeds. A lead in the raw table with a note is recoverable. A lead
-- that was never taken is gone.
--
-- READ THIS BEFORE EXPECTING IT TO WORK
--
-- The site writes to the OLD Singapore project (gxurqwpfvfktmreqmzqb), not
-- to Mumbai where the portal lives. That is the real reason the portal cannot
-- see these leads and no trigger can fix it from inside the database. The
-- site's two Vercel variables have to point at Mumbai as well — the steps are
-- in RUN-THIS-IN-SUPABASE-website-leads.sql, and the 30 leads already in
-- Singapore are rescued by the same file.
--
-- ── THE FIVE QUESTIONS (docs/engineering/WORKING-AGREEMENT.md) ──
--
-- 1. A SECOND foreign key between two tables that already have one?
--    No. website_inquiries.partner_lead_id is the FIRST and only key between
--    website_inquiries and partner_leads, so PostgREST has one relationship
--    to resolve and cannot be made ambiguous. This is the question that broke
--    every order screen for three days when orders got a second key to
--    contacts — see ROLLBACK notes and the orders incident. partner_leads
--    already has incoming keys from partner_tasks and website_inquiries now,
--    but from DIFFERENT tables, which is not the failing shape.
--
-- 2. Does a touched column appear in a `.select()` string anywhere?
--    No. `website_inquiries` appears in NO select string in either app repo —
--    grep both: zero hits before this migration. Nothing existing selects the
--    two columns added here, and no existing column is altered or renamed.
--
-- 3. A new trigger, policy or constraint on a written table — so it needs a
--    scenario?
--    Yes, all three, and it has one: supabase/tests/87_website_lead_intake.sql
--    (24 assertions), registered in scripts/run-db-tests.sh. It covers the
--    happy path, the de-duplicate path, both owner fallbacks, re-running the
--    backfill, and — the one that matters — that a submission still succeeds
--    when the portal end fails, proven by breaking the lead insert on purpose
--    with a temporary CHECK constraint.
--
-- 4. Can an existing row fail the new rule?
--    No. Both new columns are nullable with no default and no constraint, the
--    new table starts empty with one seeded row, and nothing existing is
--    revalidated. The only new constraint is on partner_intake_settings,
--    which this migration creates.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing, which is the required answer. Every table here is OZZO's own —
--    website_inquiries and the partner_* family are not tenant data and carry
--    no account_id. No customer tenant has a row in any of them, no customer
--    screen reads them, and the trigger fires only on an insert into
--    website_inquiries, which only the marketing site does.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. The raw intake table
--
-- It exists on Mumbai already (it came across in the September restore,
-- empty), so all of this is guarded. Spelled out in full anyway: a fresh
-- project restored from migrations alone must end up with the same table,
-- and "it was already there" is not something a migration may assume.
--
-- The raw row is kept rather than turned into a lead and discarded. It is
-- what the visitor actually typed, including the fields the portal has no
-- column for, and it is the only way to tell later whether a mapping was
-- wrong or the visitor simply wrote nothing.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.website_inquiries (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  name             text not null,
  company          text,
  email            text,
  phone            text not null,
  product_interest text,
  team_size        text,
  message          text,
  source           text not null default 'website',
  page_path        text,
  status           text not null default 'new',
  handled_by       uuid,
  handled_at       timestamptz,
  notes            text,
  user_agent       text
);

create index if not exists website_inquiries_created_at_idx
  on public.website_inquiries (created_at desc);
create index if not exists website_inquiries_status_idx
  on public.website_inquiries (status);

-- Which lead this enquiry became, and what happened if it became none.
-- ON DELETE SET NULL, not cascade: retiring a lead must not delete the
-- evidence of where it came from.
alter table public.website_inquiries
  add column if not exists partner_lead_id uuid
    references public.partner_leads(id) on delete set null,
  add column if not exists portal_note text;

comment on column public.website_inquiries.partner_lead_id is
  'The partner_leads row this enquiry became, or the existing lead it was folded into. Null means it is not in the portal — portal_note says why.';
comment on column public.website_inquiries.portal_note is
  'Plain English, for the founder: what the portal did with this enquiry, or why it could not.';

create index if not exists ix_website_inquiries_lead
  on public.website_inquiries (partner_lead_id);

alter table public.website_inquiries enable row level security;

-- Anonymous insert, as before: a stranger on the marketing site is not
-- logged in. INSERT only — anon may add an enquiry and read nothing back.
drop policy if exists website_inquiries_insert_public on public.website_inquiries;
create policy website_inquiries_insert_public on public.website_inquiries
  for insert to anon, authenticated
  with check (true);

-- Portal staff may read the raw enquiries. They are the same leads these
-- people already see in the portal, and when a mapping looks wrong this
-- table is the only place to check what the visitor actually wrote.
drop policy if exists website_inquiries_select_partner on public.website_inquiries;
create policy website_inquiries_select_partner on public.website_inquiries
  for select to authenticated
  using (public.partner_me() is not null);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Who owns a lead that nobody brought in
--
-- partner_leads.owner_id is NOT NULL and for good reason: an unowned lead is
-- a lead nobody rings. So an inbound enquiry needs a name against it the
-- moment it arrives, and that name has to be changeable without a developer.
--
-- One row, enforced by the primary key: `id boolean default true check (id)`
-- means there is exactly one settings row and no code has to remember which.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.partner_intake_settings (
  id                    boolean primary key default true check (id),
  website_lead_owner_id uuid references public.partner_employees(id) on delete set null,
  updated_at            timestamptz not null default now()
);

insert into public.partner_intake_settings (id) values (true)
on conflict (id) do nothing;

comment on table public.partner_intake_settings is
  'Portal-wide intake settings. Exactly one row. website_lead_owner_id is who gets leads that arrive from the website on their own.';

alter table public.partner_intake_settings enable row level security;

-- Everyone in the portal may read it: the Settings screen shows it, and a
-- lead's owner is not a secret from the team that works the leads.
drop policy if exists partner_intake_settings_select on public.partner_intake_settings;
create policy partner_intake_settings_select on public.partner_intake_settings
  for select to authenticated
  using (public.partner_me() is not null);

drop policy if exists partner_intake_settings_write on public.partner_intake_settings;
create policy partner_intake_settings_write on public.partner_intake_settings
  for update to authenticated
  using (public.partner_has_right('manage_settings'))
  with check (public.partner_has_right('manage_settings'));

-- ─────────────────────────────────────────────────────────────────────
-- 3. Two phone numbers that are one number
--
-- "+91 98765 43210", "098765 43210" and "9876543210" are one number to a
-- person and three strings to a database. The last ten digits are what make
-- a leading zero or a +91 stop mattering — the same rule lead import already
-- uses in lib/leads/types.ts (phoneKey), here so the database agrees with it.
--
-- IMMUTABLE so it may be used in an index if the lead table ever grows past
-- the point where scanning it per enquiry is sensible.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.partner_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) > 10
      then right(regexp_replace(p_phone, '\D', '', 'g'), 10)
    else regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Resolving the owner
--
-- In order: whoever was chosen in Settings, then the longest-standing active
-- administrator, then the longest-standing active member of staff. The
-- fallbacks matter more than they look — on the day somebody is deactivated,
-- the choice in Settings silently points at a person who can no longer sign
-- in, and leads arriving that afternoon must still reach somebody.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.partner_website_lead_owner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.website_lead_owner_id
       from public.partner_intake_settings s
       join public.partner_employees e on e.id = s.website_lead_owner_id
      where s.id and e.status = 'active'),
    (select e.id
       from public.partner_employees e
       join public.partner_roles r on r.id = e.role_id
      where e.status = 'active'
        and r.permissions -> 'all' = 'true'::jsonb
      order by e.created_at
      limit 1),
    (select e.id
       from public.partner_employees e
      where e.status = 'active'
      order by e.created_at
      limit 1)
  );
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. One enquiry becomes one lead
--
-- Takes an id rather than a row so the trigger and the backfill run the same
-- code. Two copies of "what a website lead looks like" would drift the first
-- time a field is added, and the backfill is the copy nobody would re-test.
--
-- Returns the lead id, or null when it deliberately made none.
--
-- WHAT GOES WHERE, and why:
--   name           the company if they gave one, else the person's name.
--                  For a lead the business name IS the company — the CRM's
--                  rule, and the portal mirrors name into company by trigger.
--   contact_person the person, dropped when it would just repeat the name.
--   whatsapp       the same number they gave. Every number on this site
--                  arrives through a form that asks for WhatsApp, and the
--                  first thing anybody does with one of these leads is
--                  message it.
--   source         "Website" — already in partner_lead_sources, seeded in
--                  Phase 2. Which form it was is in the notes; counting them
--                  apart is the raw table's job, not the pipeline's.
--   status         "New", the first status in the list.
--   notes          everything the portal has no column for, in the order a
--                  person reads it: what they want, how big they are, what
--                  they wrote, where they were standing.
--   created_at     the moment the visitor pressed send, not the moment this
--                  ran. A rescued lead from six weeks ago must not arrive
--                  looking like it came in today.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.website_inquiry_to_lead(p_inquiry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inq      public.website_inquiries;
  v_owner    uuid;
  v_source   text;
  v_name     text;
  v_contact  text;
  v_email    text;
  v_notes    text;
  v_key      text;
  v_existing uuid;
  v_lead     uuid;
begin
  select * into v_inq from public.website_inquiries where id = p_inquiry_id;
  if not found then
    return null;
  end if;

  -- Already handled. Makes the backfill re-runnable and stops a second
  -- trigger ever duplicating a lead.
  if v_inq.partner_lead_id is not null then
    return v_inq.partner_lead_id;
  end if;

  v_owner := public.partner_website_lead_owner();
  if v_owner is null then
    update public.website_inquiries
       set portal_note = 'Not in the portal: there is no active member of staff to own it. '
                      || 'Add somebody in the portal and this will come across.'
     where id = p_inquiry_id;
    return null;
  end if;

  -- The site's own labels ("website", "quote-calculator") are its business.
  -- The portal has one source for all of them, because they are one channel
  -- to the person ringing the lead back.
  v_source := case
    when lower(coalesce(v_inq.source, '')) like '%whatsapp%' then 'WhatsApp'
    else 'Website'
  end;

  v_name    := nullif(btrim(coalesce(v_inq.company, '')), '');
  if v_name is null then
    v_name := btrim(v_inq.name);
  end if;
  v_contact := nullif(btrim(coalesce(v_inq.name, '')), '');
  if v_contact = v_name then
    v_contact := null;
  end if;
  v_email   := lower(nullif(btrim(coalesce(v_inq.email, '')), ''));

  v_notes := concat_ws(
    chr(10),
    'Came in from the website on its own.',
    nullif(concat('Interested in: ', nullif(btrim(coalesce(v_inq.product_interest, '')), '')), 'Interested in: '),
    nullif(concat('Team size: ',     nullif(btrim(coalesce(v_inq.team_size, '')), '')),        'Team size: '),
    nullif(concat('They wrote: ',    nullif(btrim(coalesce(v_inq.message, '')), '')),          'They wrote: '),
    nullif(concat('Page: ',          nullif(btrim(coalesce(v_inq.page_path, '')), '')),        'Page: '),
    concat('Form: ', v_inq.source)
  );

  -- Same number, same lead. A visitor who fills the form and then prices
  -- themselves on the calculator is one lead with two enquiries against it,
  -- not two leads for two people to ring on the same afternoon.
  v_key := public.partner_phone_key(v_inq.phone);
  if v_key <> '' then
    select l.id
      into v_existing
      from public.partner_leads l
     where l.record_status = 'active'
       and public.partner_phone_key(l.phone) = v_key
     order by l.created_at
     limit 1;
  end if;

  if v_existing is not null then
    update public.website_inquiries
       set partner_lead_id = v_existing,
           portal_note     = 'Added to the lead that already had this number, rather than making a second one.'
     where id = p_inquiry_id;

    -- user_id null: nobody did this, the website did. The timeline column is
    -- nullable for exactly this case.
    insert into public.partner_module_activities
      (user_id, module_name, record_id, action, message, details)
    values
      (null, 'lead', v_existing, 'note',
       concat('Another enquiry from the website',
              coalesce(concat(' (', v_inq.page_path, ')'), ''), '.', chr(10), v_notes),
       jsonb_build_object('website_inquiry_id', v_inq.id, 'source', v_inq.source));

    return v_existing;
  end if;

  insert into public.partner_leads
    (name, contact_person, phone, whatsapp, email, status, source,
     owner_id, notes, created_at, updated_at)
  values
    (v_name, v_contact, v_inq.phone, v_inq.phone, v_email, 'New', v_source,
     v_owner, v_notes, v_inq.created_at, now())
  returning id into v_lead;

  update public.website_inquiries
     set partner_lead_id = v_lead,
         portal_note     = 'In the portal as a new lead.'
   where id = p_inquiry_id;

  insert into public.partner_module_activities
    (user_id, module_name, record_id, action, message, details)
  values
    (null, 'lead', v_lead, 'created',
     concat('Lead created from the website: ', v_name),
     jsonb_build_object('website_inquiry_id', v_inq.id, 'source', v_inq.source));

  return v_lead;
end;
$$;

comment on function public.website_inquiry_to_lead(uuid) is
  'Turns one website_inquiries row into a partner_leads row with source Website, or folds it into the existing lead with the same phone number. Idempotent: a row that already has partner_lead_id is left alone.';

-- ─────────────────────────────────────────────────────────────────────
-- 6. The trigger
--
-- AFTER INSERT, and everything inside it is caught. The enquiry row is
-- already written by the time this runs; an exception here would roll that
-- back and show a stranger an error for something that worked.
--
-- The reason goes on the row itself, because a lead the portal failed to
-- receive is only findable if it says so somewhere a person looks. It cannot
-- be written with an UPDATE — the transaction is fine, but this is an AFTER
-- trigger on the row being inserted, so pg_notice plus a column set through
-- a separate statement is the honest way. Hence the UPDATE in the handler,
-- which touches a different statement's snapshot and is allowed.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.trg_website_inquiry_to_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.website_inquiry_to_lead(new.id);
  exception when others then
    -- Never fail the submission. Record why and carry on.
    begin
      update public.website_inquiries
         set portal_note = concat('Could not reach the portal: ', sqlerrm)
       where id = new.id;
    exception when others then
      null;
    end;
    raise warning 'website_inquiry_to_lead failed for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_website_inquiries_to_portal on public.website_inquiries;
create trigger trg_website_inquiries_to_portal
  after insert on public.website_inquiries
  for each row execute function public.trg_website_inquiry_to_lead();

-- ─────────────────────────────────────────────────────────────────────
-- 7. Everything already in the table
--
-- Oldest first, so the dedupe folds later enquiries into the lead the first
-- one created rather than the other way round.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  r      record;
  v_made integer := 0;
  v_seen integer := 0;
begin
  for r in
    select id from public.website_inquiries
     where partner_lead_id is null
     order by created_at
  loop
    v_seen := v_seen + 1;
    if public.website_inquiry_to_lead(r.id) is not null then
      v_made := v_made + 1;
    end if;
  end loop;
  raise notice 'website leads: % enquiries checked, % now in the portal', v_seen, v_made;
end;
$$;

commit;
