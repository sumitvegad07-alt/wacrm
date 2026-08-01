# Rollback plan — Reporting Hierarchy (migration 106)

Additive and reversible. Ships OFF by default, so it affects nothing until an admin enables it
and sets managers.

## Level 1 — disable the module (keep data)
Settings → Module Settings → Reporting Hierarchy → off, or:
```sql
UPDATE accounts SET module_settings = jsonb_set(module_settings, '{reporting_hierarchy}', 'false')
 WHERE id = '<ACCOUNT_ID>';
```
The Employee Master reporting fields hide and the expense "suggested approver" line disappears.
**`manager_id` / `default_approver_id` are NOT cleared** — re-enabling restores the same
structure (spec's confirmed behavior).

## Level 2 — clear the configured relationships (keep the module)
```sql
UPDATE profiles SET manager_id = NULL, default_approver_id = NULL WHERE account_id = '<ACCOUNT_ID>';
```

## Level 3 — full teardown
```sql
DROP TRIGGER IF EXISTS trg_prevent_manager_cycle ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_manager_cycle();
DROP FUNCTION IF EXISTS public.get_approver(uuid);
DROP FUNCTION IF EXISTS public.is_in_downline(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_all_reports(uuid);
DROP FUNCTION IF EXISTS public.get_reporting_chain(uuid);
ALTER TABLE public.profiles DROP COLUMN IF EXISTS default_approver_id;   -- manager_id is pre-existing; leave it
UPDATE accounts SET module_settings = module_settings - 'reporting_hierarchy';
```
`profiles.manager_id` predates this module — do **not** drop it. No expenses RLS was changed
(approval stayed "any admin"), so there is nothing to revert on the expenses flow.
