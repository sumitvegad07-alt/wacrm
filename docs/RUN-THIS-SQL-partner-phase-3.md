# Run this SQL — Partner Portal, Phase 3 (Push 1)

**One block to paste. It adds one new, empty column and changes nothing that already exists.**

Everything else in this push works without it. The only thing waiting on this block is
the link between a proposal and a customer — until you paste it, a proposal has no
"Their OZZO account" box to fill in, and a customer's record shows their invoices and
renewal date but not their proposals.

## What it does, in plain words

Until now a proposal only had the client's name **typed into it**. There was no real
connection between a proposal and the company's record in the portal, so the portal
could not honestly say "here are this customer's proposals" — it would have had to
guess by matching names, and the first time two of your clients had similar names it
would have shown the wrong figures on the wrong company. A wrong price on a customer's
page is worse than no price, so it showed nothing.

This adds the real connection. After you paste it:

- Open any proposal → there is a new **Their OZZO account** box at the top. Pick the
  company and save.
- Open that company in **Customers** → the proposal is listed beside their invoices
  and their renewal date, with a link to open it.

Leaving it blank is perfectly fine, and is what you want while a business is still only
a prospect.

## What it does NOT do

- **It does not touch a single existing row.** Every proposal you already have keeps
  working exactly as it does today, with the new box simply empty.
- **It does not guess.** Nothing is filled in automatically by matching names, for the
  reason above. You link the ones you care about, when you care about them.
- **It cannot be seen by any customer of yours.** This table is locked at the database
  level and only the Partner Portal's own server can read it.

## How to run it

1. Open the Supabase SQL Editor for the Mumbai project.
2. Paste the whole block below.
3. Run it.

Running it twice is harmless — it checks whether the column is already there.

```sql
alter table public.platform_proposals
  add column if not exists account_id uuid
    references public.accounts(id) on delete set null;

comment on column public.platform_proposals.account_id is
  'The real OZZO account this proposal is for, once somebody links it. NULL '
  'until then, and never inferred from client_name. on delete set null: a '
  'closed account must not erase the deal that won it.';

create index if not exists platform_proposals_account_idx
  on public.platform_proposals (account_id)
  where account_id is not null;
```

## If something looks wrong afterwards

To put it back exactly as it was, paste this:

```sql
alter table public.platform_proposals drop column account_id;
```

Nothing else in the portal depends on the column existing — the proposal box and the
customer's Proposals section simply go quiet again.

---

**Source:** `supabase/migrations/20261125120000_platform_proposals_account.sql`, which
carries the full reasoning and the five safety questions.
**Tested on:** the throwaway PostgreSQL harness, scenario
`supabase/tests/86_partner_proposal_account.sql` — three checks: a proposal may carry an
account or none; deleting an account clears the link without deleting the proposal; and
there is exactly **one** foreign key from proposals to accounts (a second one would break
every proposal screen, the way a second key broke every order screen in November).
