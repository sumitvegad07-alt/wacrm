-- =====================================================================
-- 2026-11-25 — Converting a lead RETIRES it, moves its activities, and
--              cannot half-succeed.
--
-- Founder's review of the partner portal, point 5, in his own words:
--
--   "Converting lead to customer is working but that lead should be remove
--    from lead's database once it is saved in customer database."
--
-- He is describing the CRM's behaviour, and the CRM has it in one line.
-- `public.convert_lead_to_customer` (migration 091) ends with:
--
--     UPDATE leads SET is_converted = true,
--                      is_active    = false,     <-- THIS
--                      converted_contact_id = v_contact_id
--
-- `is_active = false` is the CRM's soft-delete flag, so a converted lead
-- drops out of the Leads list the moment it becomes a customer. The portal's
-- own flag is `record_status`, its Leads list defaults to
-- `record_status = ['active']`, and `partner_convert_lead_to_customer` never
-- touched it — so a won lead sat in the pipeline for ever, next to the
-- customer it had already become. Two records, one business, and a rep
-- chasing a shop that had already signed.
--
-- THREE other things the CRM's function does and this one did not:
--
--   1. It MOVES THE OPEN WORK. `UPDATE tasks SET lead_id = NULL,
--      contact_id = v_contact_id WHERE lead_id = p_lead_id`. Without it,
--      every call and follow-up planned while the business was a lead stays
--      attached to the retired lead: invisible on the customer's new page,
--      and still listed under a record nobody will open again. This is the
--      half of point 5 nobody asks for until a follow-up is missed.
--
--   2. It COPIES THE HISTORY. The lead's timeline is reproduced on the
--      customer, so "spoke to Nilesh on the 3rd" survives the conversion.
--      The portal wrote the customer one line — "Created by converting the
--      lead X" — and left the rest behind a record that no longer appears in
--      any list.
--
--   3. It CHECKS THAT THE UPDATE LANDED. `GET DIAGNOSTICS v_updated =
--      ROW_COUNT; IF v_updated = 0 THEN RAISE`. The portal's function is
--      SECURITY INVOKER, so its `UPDATE partner_leads` is filtered by
--      partner_leads_update — which requires `edit_leads`. A role holding
--      `convert_leads` and NOT `edit_leads` therefore created the customer,
--      updated nothing, and returned success: a customer with no lead
--      marked converted, and a lead that could be converted again tomorrow.
--      Nothing raised. Nothing logged. That is the worst failure shape there
--      is, and it was reachable with the rights screen as shipped.
--
-- ── A TRAP THIS MIGRATION WALKED INTO, AND THE HARNESS CAUGHT ──
--
-- The first draft copied the CRM's `SELECT * INTO v_lead ... FOR UPDATE`, to
-- stop two clicks a second apart both passing the already-converted guard.
--
-- **`SELECT ... FOR UPDATE` is not a read as far as RLS is concerned.**
-- Postgres applies the UPDATE policy's USING clause to a locking select as
-- well as the SELECT policy, because the row is being claimed as an update
-- target. `partner_leads_update` requires `edit_leads` — so adding FOR UPDATE
-- re-introduced the exact coupling this migration exists to remove, and more
-- loudly: a role with `convert_leads` and no `edit_leads` got
-- "That lead does not exist, or you cannot see it." Scenario V6 failed with
-- that message and V6b with `record_status=active converted=null`, which read
-- like a policy bug and was a one-word addition to a SELECT.
--
-- The lock is gone. What stops the double conversion instead is a UNIQUE
-- INDEX on `partner_customers.source_lead_id` (section 0): two simultaneous
-- conversions of one lead both read a lead with no customer, both insert, and
-- the second one is refused by the index. A constraint beats a lock here —
-- it also covers the case the lock never did, which is two different callers
-- in two different sessions.
--
-- ── THE FIVE QUESTIONS ──
--
-- 1. What breaks if this runs twice?
--    Nothing. Both functions are CREATE OR REPLACE. The conversion guard
--    (`converted_customer_id is not null`) makes converting the same lead a
--    second time raise, as before.
--
-- 2. What else in either repo, AND in supabase/tests, reads these columns?
--    `partner_leads.record_status` — ozzo-partner's leads list (its default
--    saved-view filter), lib/leads/columns.tsx, the lead detail page and
--    PATCH /api/leads. All of them already understand `inactive`; this
--    migration makes conversion produce it.
--    `partner_tasks.lead_id` / `.customer_id` — the My Activity list, both
--    record timelines and app/api/activity. Moving a row between the two is
--    the same shape of change the activity form already makes.
--    `supabase/tests/83_partner_customers.sql` C8/C9 exercise the convert
--    function; 85_partner_convert.sql (new) covers what this adds.
--    NO new foreign key is added between any pair of tables. See
--    [orders-second-fk-broke-every-order] for why that sentence is here.
--
-- 3. New trigger / policy / constraint on a table that gets written?
--    ONE new constraint: a partial unique index on
--    partner_customers.source_lead_id. No new policy, and one new SECURITY
--    DEFINER function, `partner_finish_conversion`, which is the subject of
--    scenarios V5 and V6.
--
-- 4. Can an existing row fail the new rule?
--    The unique index can, if two customers somehow already share one source
--    lead. The convert guard made that all but impossible, but "all but" is
--    not "cannot", so section 0 CHECKS FIRST and raises a sentence naming the
--    problem rather than letting CREATE INDEX fail with a duplicate-key
--    message nobody can act on.
--    Leads already converted keep whatever
--    `record_status` they have — this does NOT retroactively retire them,
--    deliberately: a migration that moved live records out of somebody's
--    working list without being asked is exactly the kind of surprise the
--    working agreement exists to prevent. The paste doc carries the one-line
--    UPDATE to tidy them up, to run only if he wants it.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing. Only partner_* objects are touched, and no tenant has any.
--
-- ── TO UNDO ──
--    See ROLLBACK-partner-convert-retires-lead.md.
-- =====================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 0. One customer per lead, enforced
--
-- This is what replaces the FOR UPDATE lock — see the trap at the top. A
-- partial index, because `source_lead_id` is null for every customer who was
-- never a lead, and NULLs do not conflict with each other anyway.
--
-- Checked before created, so a database that already holds a duplicate gets a
-- sentence it can act on instead of "could not create unique index".
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select source_lead_id
      from public.partner_customers
     where source_lead_id is not null
     group by source_lead_id
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'Cannot continue: % lead(s) have more than one customer. Find them with: select source_lead_id, count(*) from partner_customers where source_lead_id is not null group by 1 having count(*) > 1;',
      v_dupes;
  end if;
end $$;

create unique index if not exists uq_partner_customers_source_lead
  on public.partner_customers (source_lead_id)
  where source_lead_id is not null;

comment on index public.uq_partner_customers_source_lead is
  'One customer per converted lead. Replaces a FOR UPDATE lock in partner_convert_lead_to_customer, which RLS turned into an edit_leads requirement.';

-- ─────────────────────────────────────────────────────────────────────
-- 1. The bookkeeping half of a conversion, as a definer function
--
-- WHY A DEFINER FUNCTION AT ALL, when the spec says a definer function
-- "would quietly let anybody convert anything":
--
-- This one converts nothing. It takes a lead and a customer, and refuses
-- unless that customer's `source_lead_id` is that lead — which only
-- partner_convert_lead_to_customer can have set, inside the transaction
-- that created the customer. Called directly by anybody, on any pair of
-- ids, it either raises or does exactly what the conversion it belongs to
-- would have done anyway, and a second call is a no-op because no task
-- still carries that lead_id.
--
-- What it buys is that the three writes AFTER the customer exists cannot be
-- filtered away one at a time by rights the converting role may not hold.
-- `convert_leads` is the right to convert; it should not also require
-- `edit_leads` to retire the lead and `edit_activities` to carry its work
-- across. Before this, missing either one failed in silence.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_finish_conversion(
  p_lead_id     uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
  v_won     text;
begin
  -- The only authorisation this function has, and it is enough: the customer
  -- must say it came from this lead. Nothing but the conversion writes that.
  if not exists (
    select 1 from partner_customers
     where id = p_customer_id
       and source_lead_id = p_lead_id
  ) then
    raise exception 'That customer did not come from that lead.'
      using errcode = '42501';
  end if;

  -- 'Won', if the founder's status list has one. coalesce keeps whatever the
  -- lead already said when it does not, rather than blanking the stage.
  select name into v_won
    from partner_lead_statuses
   where lower(name) = 'won' and is_active
   limit 1;

  -- THE LINE THE FOUNDER ASKED FOR. record_status = 'inactive' is what takes
  -- the lead out of the Leads list, which defaults to active rows only.
  update partner_leads
     set converted_customer_id = p_customer_id,
         converted_at  = now(),
         status        = coalesce(v_won, status),
         record_status = 'inactive',
         updated_at    = now()
   where id = p_lead_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    -- Unreachable now that this runs as definer, and kept anyway: if it ever
    -- fires, the alternative is a customer whose lead was never marked, and
    -- a silent wrong answer is worse than a loud failure.
    raise exception 'The lead could not be updated.' using errcode = '42501';
  end if;

  -- Move the open work across. `lead_id = null` as well as the new
  -- `customer_id`: nothing in the schema forbids an activity carrying both,
  -- but validateActivityInput() refuses it ("Link this to a lead or to a
  -- customer, not to both") and linkedLabel() would show the customer and
  -- silently hide the lead. One record per activity, as the app means it.
  -- The CRM's own convert function nulls `lead_id` for the same reason.
  update partner_tasks
     set lead_id     = null,
         customer_id = p_customer_id,
         updated_at  = now()
   where lead_id = p_lead_id;

  -- Copy the lead's history onto the customer, keeping each entry's own
  -- author and timestamp. The lead keeps its copy: the conversion is not a
  -- rewrite of what happened, and the lead's page still has to read.
  insert into partner_module_activities
    (user_id, module_name, record_id, action, message, created_at)
  select user_id, 'customer', p_customer_id, action, message, created_at
    from partner_module_activities
   where module_name = 'lead'
     and record_id = p_lead_id;
end;
$$;

revoke all on function public.partner_finish_conversion(uuid, uuid) from public, anon;
grant execute on function public.partner_finish_conversion(uuid, uuid) to authenticated;

comment on function public.partner_finish_conversion(uuid, uuid) is
  'The writes that follow a conversion: retire the lead, move its activities to the customer, copy its timeline. Definer, and authorised solely by partner_customers.source_lead_id matching.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. The conversion itself
--
-- STILL SECURITY INVOKER, which is the part that matters. The lead is read
-- and the customer is inserted as the caller, so partner_leads_select and
-- partner_customers_insert decide whether this person may convert this lead
-- at all. `not found` covers both "no such lead" and "not yours", and they
-- are deliberately indistinguishable.
--
-- There is deliberately NO `FOR UPDATE` here. It was in the first draft,
-- copied from the CRM, and RLS treats a locking select as an update target —
-- so it silently required `edit_leads` to convert. The unique index in
-- section 0 does that job without touching what a caller may read.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_convert_lead_to_customer(p_lead_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead     partner_leads%rowtype;
  v_customer uuid;
  v_me       uuid := partner_me();
begin
  select * into v_lead from partner_leads where id = p_lead_id;
  if not found then
    raise exception 'That lead does not exist, or you cannot see it.'
      using errcode = '42501';
  end if;

  if v_lead.converted_customer_id is not null then
    raise exception 'This lead has already been converted.' using errcode = '23505';
  end if;

  insert into partner_customers (
    company, name, phone, whatsapp, email, address, area, city, state,
    country, pincode, owner_id, collaborator_ids, became_customer_on,
    source_lead_id, notes, created_by
  ) values (
    v_lead.name,            -- the BUSINESS
    v_lead.contact_person,  -- the PERSON
    v_lead.phone, v_lead.whatsapp, v_lead.email, v_lead.address, v_lead.area,
    v_lead.city, v_lead.state, v_lead.country, v_lead.pincode,
    v_lead.owner_id, v_lead.collaborator_ids, current_date, v_lead.id,
    v_lead.notes, v_me
  )
  returning id into v_customer;

  -- Retire the lead, move its activities, copy its timeline. One call, so
  -- none of the three can be filtered away by a right this role lacks.
  perform partner_finish_conversion(p_lead_id, v_customer);

  insert into partner_module_activities (user_id, module_name, record_id, action, message)
  values (auth.uid(), 'lead', p_lead_id, 'converted',
          'Converted to customer ' || v_lead.name || ' — this lead is now Inactive');

  -- The customer's own line, written AFTER the copied history so it reads
  -- as the most recent thing to have happened.
  insert into partner_module_activities (user_id, module_name, record_id, action, message)
  values (auth.uid(), 'customer', v_customer, 'created',
          'Created by converting the lead ' || v_lead.name);

  return v_customer;
end;
$$;

revoke all on function public.partner_convert_lead_to_customer(uuid) from public, anon;
grant execute on function public.partner_convert_lead_to_customer(uuid) to authenticated;

commit;
