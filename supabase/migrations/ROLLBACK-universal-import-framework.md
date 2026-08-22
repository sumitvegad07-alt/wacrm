# Rollback — Universal Import Framework v1 (Wave 0)

Migration: `20260822120000_universal_import_framework_v1.sql`

Purely additive (new tables, functions, one index, permission keys are plain
JSONB strings). Nothing in existing data is modified, so rollback is safe and
optional. Run only if the feature must be fully removed.

```sql
-- Functions
DROP FUNCTION IF EXISTS public.import_undo(uuid);
DROP FUNCTION IF EXISTS public.import_commit(uuid, jsonb, boolean);

-- Realtime publication (ignore error if not present)
ALTER PUBLICATION supabase_realtime DROP TABLE public.import_jobs;

-- Dedupe backstop index on the pilot table
DROP INDEX IF EXISTS public.product_units_account_name_uniq;

-- Tables (order matters: row_map & jobs FK templates; row_map FKs jobs)
DROP TABLE IF EXISTS public.import_row_map;
DROP TABLE IF EXISTS public.import_jobs;
DROP TABLE IF EXISTS public.import_templates;
```

Notes:
- The `import_data` / `import_manage` permission keys live inside
  `employee_roles.permissions` JSONB. They are inert once the UI is removed; no
  data migration is needed to clean them up, but they can be stripped with a
  `jsonb - 'import_data' - 'import_manage'` update per role if desired.
- Dropping `import_jobs` cascades to `import_row_map`. Any rows a completed
  import created in `product_units` are **not** removed by this rollback — they
  are real data. Undo an import through the UI first if you want those gone.
