# Database tests for the November 2026 modules

45 scenarios covering Buying Status (incl. Blacklist), Customer mapping,
Automatic codes and the territory "area is not mandatory" fix. They exercise the
triggers, CHECK constraints and RPCs directly — the layer that had no automated
test of any kind before, and where the rules these modules promise actually live.

They are not run by `npm test`: they need a real PostgreSQL with the migrations
applied, not a mock. `tools/pgsql` in this workspace is a complete PostgreSQL
17.6, which is what they were written against.

## Running them

```
initdb -D "$PGDATA" -U postgres -A trust -E UTF8 --no-locale
pg_ctl -D "$PGDATA" -o "-p 54399 -c listen_addresses=127.0.0.1" -l "$PGDATA/log.txt" -w start
```

Then create the Supabase primitives a bare PostgreSQL has not got — the `anon`,
`authenticated` and `service_role` roles, an `auth` schema with a `users` table,
and `auth.uid()` reading `current_setting('test.uid', true)` so a test can "log
in" as anybody — apply `supabase/migrations/*.sql` in filename order, and run:

```
psql -p 54399 -U postgres -f supabase/tests/00_fixture.sql
psql -p 54399 -U postgres -f supabase/tests/10_buying_status.sql
psql -p 54399 -U postgres -f supabase/tests/20_mapping_codes_territory.sql
psql -p 54399 -U postgres -f supabase/tests/30_territory_coverage_rls.sql
select * from qa_results where pass is not true;   -- must be empty
```

**Always reload `00_fixture.sql` before the others.** They mutate the rows they
share, so running one twice without reloading reports failures that are only
leftover state — which cost an hour the first time.

Two things a bare PostgreSQL needs that are easy to miss: `authenticated` must
hold `select` on `profiles` and `territories` (the `contacts_select` policy has
an inline sub-query on `profiles` that runs as the caller), and the
`on_auth_user_created` trigger has to be disabled while the fixture loads or it
invents an account per test user.

## What they found

- Orders could not be saved on a tenant with Customer Level switched on, for any
  customer without a level — `recalc_contact_outstanding` wrote a derived column
  without `is_ozzo_system_write()`. Fixed in `20261104120000`.
- `contacts.customer_code` was created by no migration at all, so the migration
  chain could not rebuild the database. Declared in `20261104110000`.
