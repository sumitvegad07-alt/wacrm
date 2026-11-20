# Rollback — Partner Portal Phase 2

Undoes `20261121120000_partner_portal_phase2.sql`.

## Read this first

Unlike the Phase 1 rollback, **this one destroys business data**. Once the
sales team has started working, these tables hold every lead they have
chased, every customer they have signed and every call they have logged.
Dropping them is not reversible and there is no export step built in.

If the aim is only to stop people using the module, turn the rights off
instead: clear `view_leads`, `view_customers` and `view_activities` from every
role in Employee Roles. The data stays, the screens disappear.

**Before dropping anything,** take a copy:

```sql
-- Run each and save the result as CSV from the Supabase editor.
select * from public.partner_leads;
select * from public.partner_customers;
select * from public.partner_tasks;
```

## The rollback

Dependency order matters: tasks reference leads and customers, leads
reference customers.

```sql
begin;

drop function if exists public.partner_distinct_values(text, text);

drop table if exists public.partner_tasks;
drop table if exists public.partner_leads;
drop table if exists public.partner_customers;
drop table if exists public.partner_lead_statuses;
drop table if exists public.partner_lead_sources;
drop table if exists public.partner_industries;
drop table if exists public.partner_table_views;
drop table if exists public.partner_record_views;

commit;
```

Policies are dropped with their tables, so they need no separate statement.

Phase 1's tables — `partner_employees` and `partner_roles` — are deliberately
left alone. Staff and their logins survive this rollback, and the portal still
works; it is just back to Employees, Employee Roles and Settings only.

## Verify the rollback

```sql
select count(*) as leftovers from pg_class
where relname in ('partner_lead_statuses','partner_lead_sources','partner_industries',
                  'partner_leads','partner_customers','partner_tasks',
                  'partner_table_views','partner_record_views');
-- Expect 0.

select count(*) as leftovers from pg_proc where proname = 'partner_distinct_values';
-- Expect 0.
```

## Afterwards

The app will still try to open `/leads` and `/settings`, and both will error
rather than 404, because the pages exist and their queries no longer do. Set
`built: false` on those items in `ozzo-partner/lib/nav.ts` and deploy, or
remove the pages — `lib/nav.test.ts` will otherwise fail, which is the intended
nudge.
