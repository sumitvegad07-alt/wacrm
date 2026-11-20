# Rollback — Partner Portal foundation

Undoes `20261120120000_partner_portal_foundation.sql`.

Nothing that existed before that migration references any of these objects, so
this rollback is clean: no tenant table, column, policy or function is touched
by applying it or by undoing it.

## What is lost

- Every partner employee record, and every role.
- **Not** the `auth.users` logins. Dropping `partner_employees` leaves the
  staff logins in place, unable to sign into anything (the portal's gate reads
  `partner_employees`, so they resolve to "not staff"). If the portal is being
  abandoned rather than rebuilt, remove them separately — see the last section.

## The rollback

Run in the Supabase SQL editor, in this order. Triggers before their
functions, functions before the tables they read.

```sql
begin;

drop trigger if exists trg_partner_prevent_manager_cycle on public.partner_employees;
drop trigger if exists trg_partner_roles_protect_system  on public.partner_roles;

drop function if exists public.partner_prevent_manager_cycle();
drop function if exists public.partner_roles_protect_system();
drop function if exists public.partner_scope_ids();
drop function if exists public.partner_has_right(text);
drop function if exists public.partner_me();

-- The policies go with the tables, so they need no separate drop.
-- partner_employees first: its role_id references partner_roles.
drop table if exists public.partner_employees;
drop table if exists public.partner_roles;

commit;
```

## Verify the rollback

```sql
select count(*) as leftovers
from pg_proc
where proname in ('partner_me', 'partner_has_right', 'partner_scope_ids',
                  'partner_prevent_manager_cycle', 'partner_roles_protect_system');
-- Expect 0.

select count(*) as leftovers
from pg_class where relname in ('partner_employees', 'partner_roles');
-- Expect 0.
```

## Removing the staff logins too

Only if the portal is being abandoned. This cannot be undone, and it signs
those people out of everything permanently.

```sql
-- LOOK at the list before deleting it. Anyone who is also a CRM user must NOT
-- be in here — check against profiles first.
select u.id, u.email
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id)
order by u.created_at desc;
```

Delete the ones you recognise as partner staff, one at a time, by id. Do not
delete the whole result set in one statement: the query above also catches any
DMS portal login, which is a customer's, not a staff member's.
