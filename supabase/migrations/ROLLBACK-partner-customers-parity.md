# Rollback — Customers brought into line with the CRM

Undoes `20261123120000_partner_customers_crm_parity.sql`.

## Read this first

This one is a **rename**, not an addition, so undoing it is not simply
dropping things. If customers have been created or converted since it ran,
their data is in the renamed columns and the rollback moves it back rather
than deleting it.

What is genuinely lost: `whatsapp`, `address`, `area`, `country`, `pincode`
and `collaborator_ids`, with whatever is in them.

**Take a copy first:**

```sql
select * from public.partner_customers;
```

## The rollback

```sql
begin;

-- The columns go back to the names they had, which the Customers screens
-- do NOT use — so roll the app back too, or those screens will break.
alter table public.partner_customers rename column company to business_name;
alter table public.partner_customers rename column name to contact_person;

alter table public.partner_customers
  drop column if exists whatsapp,
  drop column if exists address,
  drop column if exists area,
  drop column if exists country,
  drop column if exists pincode,
  drop column if exists collaborator_ids;

-- business_name was NOT NULL before, so this stays as it is. Nothing to undo.

-- Back to the owner-only read.
drop policy if exists partner_customers_select on public.partner_customers;
create policy partner_customers_select on public.partner_customers
  for select to authenticated
  using (public.partner_has_right('view_customers')
         and owner_id in (select public.partner_scope_ids()));

commit;
```

**Then restore the previous convert function** from
`20261122120000_partner_leads_crm_parity.sql`, section 5 — copy that
`create or replace function public.partner_convert_lead_to_customer` block
and run it. Skipping this leaves a function inserting `company` and `name`
into a table that no longer has them, and every conversion fails.

`partner_distinct_values` can be left as it is: the `customer` branch simply
returns nothing once the columns are gone, and the `lead` branch is
unaffected.

## Verify the rollback

```sql
select column_name from information_schema.columns
where table_name = 'partner_customers'
  and column_name in ('company','name','business_name','contact_person')
order by column_name;
-- Expect: business_name, contact_person.
```

```sql
-- Converting works again.
select prosrc like '%business_name%' as uses_old_names
from pg_proc where proname = 'partner_convert_lead_to_customer';
-- Expect true. False means the function was not restored.
```
