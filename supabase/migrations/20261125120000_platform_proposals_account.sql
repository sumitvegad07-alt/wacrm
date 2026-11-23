-- ============================================================
-- platform_proposals.account_id — the real link a proposal has lacked.
--
-- Phase 2B's customer billing panel shows a customer's invoices and their
-- renewal, and deliberately NOT their proposals, because the only thing
-- joining a proposal to a business was free-text client_name. Its own comment
-- says so, and says the link arrives in Phase 3:
--
--   "Matching a proposal to a customer by name would attach the wrong
--    proposal to the wrong business the first time two clients have similar
--    names, and a wrong invoice figure on a customer's page is worse than no
--    figure. Proposals get a real account link in Phase 3, when that module
--    moves across; this panel picks them up then."
--
-- This is that column.
--
-- ── THE FIVE QUESTIONS ──
--
-- 1. What breaks if this runs twice?
--    Nothing. `add column if not exists`, `create index if not exists`, and
--    `comment on` is idempotent by nature.
--
-- 2. What else reads these columns, in EITHER repo and in supabase/tests?
--    platform_proposals is selected in:
--      ozzo-partner/app/api/proposals/route.ts           (LIST_COLUMNS, named)
--      ozzo-partner/app/api/proposals/[id]/route.ts      (select *)
--      ozzo-partner/app/(portal)/invoices/new/page.tsx   (plan, ref, data)
--      ozzo-partner/app/(portal)/forecast/page.tsx       (7 named columns)
--      ozzo-partner/app/print/proposal/[id]/page.tsx     (5 named columns)
--    Every one names its columns except the `[id]` route's `select("*")`,
--    which returns one more field to a form that ignores unknown keys. No
--    existing result changes. Verify before applying:
--      grep -rn "platform_proposals" /c/Wacrm/wacrm-web /c/Wacrm/ozzo-partner
--
-- 3. What happens to rows that already exist?
--    account_id is NULL on all of them, and a proposal with no account simply
--    does not appear on any customer's page — which is today's behaviour
--    exactly. NOTHING is backfilled by matching client_name against
--    accounts.name: see the quoted comment above for why that would be worse
--    than leaving them unlinked.
--
-- 4. Which policy decides who may read the new rows?
--    None, and that is correct. platform_proposals has RLS enabled with no
--    policies at all, deliberately — a policy there would expose OZZO's
--    quoted prices to every signed-in tenant user. Every read goes through a
--    server route that has already called requirePartnerRight(). This
--    migration adds no policy and changes none.
--
-- 5. How is it undone?
--      alter table public.platform_proposals drop column account_id;
--    The index goes with the column. Nothing else refers to it.
--
-- ── SECOND-FK CHECK ──
--
-- platform_proposals' only existing foreign key is created_by -> auth.users.
-- This is its FIRST key to public.accounts, so no PostgREST embed on this
-- table becomes ambiguous. Anything that later wants a second route from a
-- proposal to an account must use a plain uuid with NO constraint: a second
-- FK between the same pair of tables is what killed every order screen for
-- three days. See orders-second-fk-broke-every-order.
-- ============================================================

alter table public.platform_proposals
  add column if not exists account_id uuid
    references public.accounts(id) on delete set null;

comment on column public.platform_proposals.account_id is
  'The real OZZO account this proposal is for, once somebody links it. NULL '
  'until then, and never inferred from client_name. on delete set null: a '
  'closed account must not erase the deal that won it.';

-- Partial, because the question asked is always "this account's proposals".
-- Unlinked rows are the majority today and are never searched for by id.
create index if not exists platform_proposals_account_idx
  on public.platform_proposals (account_id)
  where account_id is not null;
