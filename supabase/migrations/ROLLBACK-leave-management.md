# Rollback plan — Leave Management v1 (`20260817170000_leave_management.sql`)

Additive. Four new tables, one new column on `account_sequences`, one new key inside
`accounts.settings.tracking_settings`, and a set of functions. **No existing table, column or
row was altered or dropped**, with one exception called out in Level 1 below.

## Level 0 — the only thing this migration changes about existing behaviour

`accounts.settings.tracking_settings.working_days` is written as `[1,2,3,4,5,6]` (Mon–Sat) for
every account that did not already have the key. Nothing read that key before this migration, so
the write itself is inert — but the web attendance page starts reading it, replacing a hardcoded
Mon–Fri week. **Total Days rises by roughly four per month and presence % falls accordingly.**
That is a correction, not a regression, but it is the one visible change.

To restore the previous five-day behaviour without touching anything else:
```sql
UPDATE accounts
   SET settings = jsonb_set(settings, '{tracking_settings,working_days}', '[1,2,3,4,5]'::jsonb, true)
 WHERE id = '<ACCOUNT_ID>';
```
Admins can also do this from Settings → Organisation Settings → Working Days; no SQL needed.

## Level 1 — hide the feature, keep the data

Remove the sidebar entry (`/location-tracking/leaves`) and the Leave Settings section from
`settings-sections.ts`. The tables keep their rows and nothing else in the product reads them,
apart from the attendance page's leave lookup, which returns nothing once there are no approved
leave days.

## Level 2 — clear the data, keep the schema

```sql
DELETE FROM leave_days WHERE account_id = '<ACCOUNT_ID>';
DELETE FROM leaves     WHERE account_id = '<ACCOUNT_ID>';
DELETE FROM holidays   WHERE account_id = '<ACCOUNT_ID>';
DELETE FROM leave_types WHERE account_id = '<ACCOUNT_ID>';
DELETE FROM module_activities WHERE module_name = 'leave' AND account_id = '<ACCOUNT_ID>';
```
`leave_days` first — `leaves` is its parent. (The FK cascades, but deleting explicitly keeps the
intent obvious.)

## Level 3 — full teardown

```sql
DROP TRIGGER IF EXISTS trg_sync_leave_days_status ON public.leaves;
DROP TRIGGER IF EXISTS set_leave_number_trigger ON public.leaves;
DROP TRIGGER IF EXISTS set_leaves_updated_at ON public.leaves;
DROP TRIGGER IF EXISTS set_leave_types_updated_at ON public.leave_types;
DROP TRIGGER IF EXISTS set_holidays_updated_at ON public.holidays;

DROP FUNCTION IF EXISTS public.update_leave_request(uuid, uuid, date, date, jsonb, text, text, text, text);
DROP FUNCTION IF EXISTS public.update_leave_status(uuid, text, text);
DROP FUNCTION IF EXISTS public.create_leave_request(uuid, uuid, date, date, jsonb, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.write_leave_days(uuid, uuid, uuid, date, date, jsonb, text);
DROP FUNCTION IF EXISTS public.leave_status_transition_allowed(text, text);
DROP FUNCTION IF EXISTS public.leave_day_value(text);
DROP FUNCTION IF EXISTS public.leave_eligible_dates(uuid, date, date);
DROP FUNCTION IF EXISTS public.account_working_days(uuid);
DROP FUNCTION IF EXISTS public.trg_set_leave_number();
DROP FUNCTION IF EXISTS public.get_next_leave_number(uuid);
DROP FUNCTION IF EXISTS public.sync_leave_days_status();

DROP TABLE IF EXISTS public.leave_days;
DROP TABLE IF EXISTS public.leaves;
DROP TABLE IF EXISTS public.holidays;
DROP TABLE IF EXISTS public.leave_types;

ALTER TABLE public.account_sequences DROP COLUMN IF EXISTS leave_seq;

UPDATE accounts
   SET settings = jsonb_set(settings, '{tracking_settings}',
                            (settings->'tracking_settings') - 'working_days')
 WHERE settings->'tracking_settings' ? 'working_days';
```

**Do not drop `module_activities`, `account_sequences`, `is_in_downline`, `has_permission` or
`update_updated_at_column`** — all five predate this module and are used across the product.

## What a teardown does not undo

`leave_seq` values consumed on `account_sequences` are gone; a rebuilt module would continue
numbering from wherever the counter stopped (or from zero if the column was dropped and re-added).
Leave numbers are not referenced by any other table, so this has no downstream effect.
