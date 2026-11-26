-- ============================================================
-- platform_proposals.partner_lead_id / .partner_customer_id — a proposal can
-- be written for a prospect, not only for a business that has already signed
-- up.
--
-- Phase 3 gave the table `account_id`, a key to `public.accounts`. `accounts`
-- holds OZZO's TENANTS: a row exists there only once a business has signed up
-- and been given a Customer ID. So the proposal form's only picker listed
-- signed-up tenants, which is the founder's 26 November 2026 report:
--
--   "The proposal can be created for leads as well not only with our Existing
--    Customer id's sign up only."
--
-- The portal's own CRM is where a prospect actually lives — partner_leads
-- before they buy, partner_customers after — and neither was reachable from a
-- proposal. These are those two links.
--
-- account_id is NOT replaced. It still carries its own meaning (which TENANT
-- this proposal is for) and the customer billing panel still reads it. A
-- proposal written for a partner_customer who has since signed up carries
-- both, and the two agree because the route copies the account from the
-- customer's own row rather than asking anybody to pick it twice.
--
-- ── THE FIVE QUESTIONS ──
--
-- 1. What breaks if this runs twice?
--    Nothing. Every statement is `if not exists`, and the CHECK is added
--    inside a guard that looks for its own name first. `comment on` is
--    idempotent by nature.
--
-- 2. What else reads these columns, in EITHER repo and in supabase/tests?
--    platform_proposals is selected in:
--      ozzo-partner/app/api/proposals/route.ts           (LIST_COLUMNS, named)
--      ozzo-partner/app/api/proposals/[id]/route.ts      (select *)
--      ozzo-partner/app/api/proposals/for/route.ts       (named — new, and the
--                                                         only reader of these
--                                                         two columns)
--      ozzo-partner/app/api/customers/billing/route.ts   (named)
--      ozzo-partner/app/(portal)/invoices/new/page.tsx   (plan, ref, data)
--      ozzo-partner/app/(portal)/forecast/page.tsx       (7 named columns)
--      ozzo-partner/app/print/proposal/[id]/page.tsx     (5 named columns)
--    Every one names its columns except the `[id]` route's `select("*")`,
--    which returns two more fields to a form that reads them on purpose. No
--    existing result changes. Verify before applying:
--      grep -rn "platform_proposals" /c/Wacrm/wacrm-web /c/Wacrm/ozzo-partner
--
-- 3. What happens to rows that already exist?
--    Both columns are NULL on all of them, which reads as "not linked to a
--    lead or a customer" — today's behaviour exactly, since neither link
--    existed. NOTHING is backfilled by matching client_name against
--    partner_leads.name or partner_customers.company: a free-text name match
--    is what the Phase 3 migration refused to do, for the same reason. Two
--    businesses with similar names would swap each other's quotations.
--
-- 4. Which policy decides who may read the new rows?
--    None, and that is correct. platform_proposals has RLS enabled with NO
--    policies at all, deliberately — a policy there would expose OZZO's quoted
--    prices to every signed-in tenant user. Every read goes through a server
--    route that has already called requirePartnerRight(), and the new
--    /api/proposals/for route additionally EARNS the id it is given: it looks
--    the lead or customer up on the caller's OWN RLS-scoped session first, so
--    partner_leads' and partner_customers' own policies decide whose
--    proposals a salesperson can pull. This migration adds no policy and
--    changes none.
--
-- 5. How is it undone?
--      alter table public.platform_proposals
--        drop constraint if exists platform_proposals_one_owner,
--        drop column if exists partner_lead_id,
--        drop column if exists partner_customer_id;
--    The indexes go with the columns. Nothing else refers to them.
--
-- ── SECOND-FK CHECK ──
--
-- platform_proposals' existing foreign keys are created_by -> auth.users and
-- account_id -> public.accounts. These are its FIRST keys to
-- public.partner_leads and public.partner_customers, so no PostgREST embed on
-- any of the four tables becomes ambiguous. Anything that later wants a
-- SECOND route from a proposal to a lead or a customer must use a plain uuid
-- with NO constraint: a second FK between the same pair of tables is what
-- killed every order screen for three days. See
-- orders-second-fk-broke-every-order.
--
-- ── WHY NOT `customer_id` / `lead_id` ──
--
-- `customer_id` already means something else in this schema and it is NOT a
-- uuid: accounts.customer_id and platform_subscriptions.customer_id are the
-- TEXT customer code ("001288"), and the renewals join is built on it. A uuid
-- column called customer_id on a neighbouring platform_* table would be read
-- as that code by the next person to touch this, and the join would be
-- written against the wrong thing. The columns are named for the tables they
-- point at.
-- ============================================================

alter table public.platform_proposals
  add column if not exists partner_lead_id uuid
    references public.partner_leads(id) on delete set null,
  add column if not exists partner_customer_id uuid
    references public.partner_customers(id) on delete set null;

comment on column public.platform_proposals.partner_lead_id is
  'The portal lead this proposal was written for. NULL when it was written '
  'for a customer instead, or for nobody on record yet. Never inferred from '
  'client_name. on delete set null: a lead that is retired or merged away '
  'must not erase the quotation that was sent to them.';

comment on column public.platform_proposals.partner_customer_id is
  'The portal customer this proposal was written for, whether or not they '
  'have signed up with OZZO. When they have, account_id carries the tenant '
  'as well, copied from this customer''s own row. NULL when the proposal was '
  'written for a lead instead, or for nobody on record yet.';

-- A proposal is for ONE business. Both set at once would put the same
-- quotation on two different records' pages, each claiming it as theirs, and
-- nothing downstream could say which was right. Neither set stays legal: that
-- is a quotation for a prospect who is not on the CRM yet, which is how most
-- of them start.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'platform_proposals_one_owner'
  ) then
    alter table public.platform_proposals
      add constraint platform_proposals_one_owner
      check (num_nonnulls(partner_lead_id, partner_customer_id) <= 1);
  end if;
end $$;

-- Partial, because the question asked is always "this record's proposals".
-- Unlinked rows are the majority today and are never searched for by id.
create index if not exists platform_proposals_partner_lead_idx
  on public.platform_proposals (partner_lead_id)
  where partner_lead_id is not null;

create index if not exists platform_proposals_partner_customer_idx
  on public.platform_proposals (partner_customer_id)
  where partner_customer_id is not null;
