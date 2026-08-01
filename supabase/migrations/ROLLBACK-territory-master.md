# Rollback plan — Territory Master (migrations 101–104)

The whole change is **additive and non-destructive**. The legacy
`contacts.country/state/city/area` text columns are never dropped and never overwritten — the
migration RPC only *reads* them — so the original geography is always recoverable.

## Level 1 — revert the contact backfill only (most likely need)

`territory_migrate_contact_geo()` only writes `contacts.territory_id` and
`contacts.needs_territory_review`. To undo the backfill without removing the module:

```sql
-- Per tenant (scope by account_id):
UPDATE contacts
   SET territory_id = NULL, needs_territory_review = false
 WHERE account_id = '<ACCOUNT_ID>';
```

The legacy `country/state/city/area` values are untouched, so customers keep their original
geography. Re-running `territory_migrate_contact_geo('<ACCOUNT_ID>')` re-applies it (idempotent).

## Level 2 — disable the module (keep the data/tables)

Set the Module Settings toggle off (Settings → Module Settings → Territory), or:

```sql
UPDATE accounts
   SET module_settings = jsonb_set(module_settings, '{territory}', 'false')
 WHERE id = '<ACCOUNT_ID>';
```

The Customer form + list immediately fall back to the legacy `country/state/city/area` fields;
the `/territories` nav item and Employee Area Assignment card hide. No data is lost.

## Level 3 — full teardown (remove the module entirely)

Additive objects, so dropping them restores the pre-101 schema. Run in this order:

```sql
-- functions
DROP FUNCTION IF EXISTS public.territory_bulk_seed(uuid, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.territory_migrate_contact_geo(uuid);
DROP FUNCTION IF EXISTS public.territory_update_settings(uuid, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public.territory_assign_employee_areas(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.territory_delete(uuid);
DROP FUNCTION IF EXISTS public.territory_restore(uuid);
DROP FUNCTION IF EXISTS public.territory_archive(uuid, boolean);

-- contacts columns (safe: legacy geo columns are separate and stay)
ALTER TABLE public.contacts DROP COLUMN IF EXISTS territory_id;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS needs_territory_review;

-- tables + enum
DROP TABLE IF EXISTS public.employee_area_assignments;
DROP TABLE IF EXISTS public.territories;
DROP TYPE  IF EXISTS territory_status;

-- optional: remove the settings keys
UPDATE accounts SET settings = settings - 'territory_settings';
UPDATE accounts SET module_settings = module_settings - 'territory';
```

Then revert the web/mobile code (the `territory` module key normalises missing → `true`, so the
app tolerates the jsonb key being absent; the app code referencing the dropped tables must be
reverted alongside a teardown).

## Notes
- `contacts.territory_id` FK is `ON DELETE RESTRICT`; a territory with attached customers can't be
  hard-deleted (only archived), so teardown of `territories` requires the `contacts.territory_id`
  column to be dropped first (as ordered above) or all rows detached.
- No production customer currently has geo data (verified 2026-07-31: 9 contacts, 0 with any
  country/state/city/area), so the Level-1 backfill revert is a no-op today.
