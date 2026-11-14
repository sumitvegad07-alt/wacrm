# Run this SQL — close four tables that anyone could read

**Run this one before anything else.** It is not part of the DMS. It fixes a
hole that is live right now, on every company's account.

## What is wrong

Four tables had no lock on them at all:

| Table | What it holds |
|---|---|
| `user_custom_values` | your own custom fields on an employee |
| `customer_visit_custom_values` | your own custom fields on a customer visit |
| `lead_visit_custom_values` | your own custom fields on a lead visit |
| `dispatch_custom_values` | your own custom fields on a dispatch |

Every other table in OZZO carries a rule saying "only people who belong to this
company may read this row". These four carried the rule `true` — meaning
**anyone at all**. I tested it rather than assuming it, on the throwaway test
database:

* a **DMS customer of one company read another company's rows**,
* a **visitor who was not signed in at all** read them too,
* and a signed-in outsider could **add rows to another company** and **change
  another company's rows**.

The key the website uses to talk to the database for signed-out visitors is
public — it is inside every browser page — so "anyone signed in or not" really
does mean anyone.

## How bad is it today

**Nothing has leaked.** I counted the rows on your live database: all four
tables are **empty**, for every company. These tables only start holding data
the first time someone adds a custom field to an employee, a visit or a
dispatch. So this is a door left unlocked on a room that happens to be empty.

It would not have stayed empty — the employee form, the dispatch form, the
visits screen and the mobile app all write to these tables as soon as a custom
field exists.

## What the fix does

It puts the same lock on these four that every other table already has: you can
read and write a row only if you belong to that company. Nothing else changes.

I checked all four places that write to these tables — the employee form (new
and edit), the dispatch form, and the mobile app's offline queue — and every one
of them already sends the company id, so the lock has what it needs and no form
stops working. Nine tests cover it, including two that check **your own** reads
and writes still work; they all failed before the fix and all pass after.

Open Supabase → SQL Editor → paste the SQL below, Run. Safe to run twice.

Source file: `supabase/migrations/20261114140000_scope_public_custom_values_policies.sql`

```sql
-- customer_visit_custom_values
DROP POLICY IF EXISTS customer_visit_cv_all ON public.customer_visit_custom_values;
CREATE POLICY customer_visit_cv_all ON public.customer_visit_custom_values
  FOR ALL
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));

-- lead_visit_custom_values
DROP POLICY IF EXISTS lead_visit_cv_all ON public.lead_visit_custom_values;
CREATE POLICY lead_visit_cv_all ON public.lead_visit_custom_values
  FOR ALL
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));

-- dispatch_custom_values
DROP POLICY IF EXISTS dispatch_cv_all ON public.dispatch_custom_values;
CREATE POLICY dispatch_cv_all ON public.dispatch_custom_values
  FOR ALL
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));

-- user_custom_values
DROP POLICY IF EXISTS user_cv_all ON public.user_custom_values;
CREATE POLICY user_cv_all ON public.user_custom_values
  FOR ALL
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));

ALTER TABLE public.customer_visit_custom_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_visit_custom_values     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_custom_values       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_custom_values           ENABLE ROW LEVEL SECURITY;
```

**What you should see.** "Success. No rows returned."

**Then check it worked.** Paste this and send me what it shows — all four should
say `locked`:

```sql
select tablename,
       case when coalesce(qual,'true') = 'true' then 'STILL OPEN' else 'locked' end as state
  from pg_policies
 where schemaname = 'public'
   and tablename in ('customer_visit_custom_values','lead_visit_custom_values',
                     'dispatch_custom_values','user_custom_values')
 order by tablename;
```

**Then test it in the app**, because this is the part that must not break: open
an employee who has a custom field, change that field, and save. If your
Organization Settings has no custom field on employees, visits or dispatches,
there is nothing to test and nothing was affected.

**How to undo it**, if a form ever refuses to save and you need it working this
minute — tell me straight away if you use this, because it reopens the hole:

```sql
DROP POLICY IF EXISTS user_cv_all ON public.user_custom_values;
CREATE POLICY user_cv_all ON public.user_custom_values FOR ALL USING (true);
```

## How it was found

The DMS plan told me, before giving a distributor permission to read anything,
to list **every** rule in the database that never checks which company you
belong to, and to judge each one rather than assume. Ten came back. Five are
harmless (they describe how the report engine is built and hold no company
data), one is deliberate (published help pages), and these four were holes.
