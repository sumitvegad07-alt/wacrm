-- ============================================================
-- 2026-11-27 — per-client custom features (20261127120000).
--
-- The question this answers: can a client end up with a custom feature nobody
-- granted them, or lose one they were granted?
--
-- The dangerous paths, in order of how much they would cost:
--   1. A tenant admin granting themselves a key — the same hole the add-on
--      guard closed for plans and seats, reopened by a new column. accounts_update
--      is a ROW policy and cannot restrict columns, so without the trigger
--      every tenant admin could PATCH their own accounts row.
--   2. The switch leaking across tenants, so one client's one-off screen shows
--      up for everybody on a legacy Enterprise plan.
--   3. A junk key stored and silently granting nothing, which looks like a bug
--      in the feature rather than in the grant.
--
-- This file establishes its own state and inherits nothing: files that assume a
-- previous file's end state is how scenarios fail for unrelated reasons.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ACCT_B '''bbbb0000-0000-0000-0000-000000000002'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''

\set PORTAL_U '''00000000-0000-0000-0000-00000000cf01'''
\set CF_DIST  '''cc000000-0000-0000-0000-0000000000f1'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

UPDATE public.accounts SET custom_features = '{}' WHERE id IN (:ACCT_A, :ACCT_B);

-- ── M: the column ────────────────────────────────────────────
SELECT qa('M1 the column exists and is NOT NULL with an empty default',
  (SELECT is_nullable = 'NO' AND column_default LIKE '%{}%'
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounts'
      AND column_name = 'custom_features'),
  'accounts.custom_features must be NOT NULL DEFAULT ''{}''');

SELECT qa('M2 an account nobody granted anything has no custom feature',
  account_has_custom_feature(:ACCT_A, 'acme_crate_label') = false,
  'an empty array must answer false');

SELECT qa('M3 an unknown account id answers false rather than erroring',
  account_has_custom_feature('99999999-9999-9999-9999-999999999999', 'acme_crate_label') = false,
  'the helper must fail closed, not raise');

-- ── M4-M6: granting, and who may ─────────────────────────────
-- The service role is the superadmin panel's own path (/api/admin/accounts/[id]
-- writes with the service key), and triggers still fire for it.
SET ROLE service_role;
UPDATE public.accounts SET custom_features = ARRAY['acme_crate_label'] WHERE id = :ACCT_A;
RESET ROLE;

SELECT qa('M4 OZZO can grant a key through the service role',
  account_has_custom_feature(:ACCT_A, 'acme_crate_label'),
  'the superadmin write path must work');

SELECT qa('M5 the grant does NOT reach the other tenant',
  account_has_custom_feature(:ACCT_B, 'acme_crate_label') = false,
  'a per-client switch must stay with that client');

SELECT qa('M6 a different key on the same account is still false',
  account_has_custom_feature(:ACCT_A, 'someone_elses_feature') = false,
  'only the exact key granted may read true');

-- ── M7-M10: the guard ────────────────────────────────────────
-- qa_refused passes on ANY error, so M-msg below also asserts that each refusal
-- carries the guard's own sentence rather than a syntax error.
SET ROLE authenticated;

SELECT qa_refused('M7 a tenant admin cannot grant themselves a custom feature',
  'UPDATE public.accounts SET custom_features = ARRAY[''acme_crate_label'',''free_stuff'']
     WHERE id = ' || quote_literal(:ACCT_A));

SELECT qa_refused('M8 a tenant admin cannot take one away either',
  'UPDATE public.accounts SET custom_features = ''{}'' WHERE id = ' || quote_literal(:ACCT_A));

SELECT qa_refused('M9 a custom feature hidden inside an innocent update is still refused',
  'UPDATE public.accounts SET name = ''Sneaky'', custom_features = ARRAY[''free_stuff'']
     WHERE id = ' || quote_literal(:ACCT_A));

SELECT qa('M-msg M7-M9 are all the OZZO guard, not some other error',
  (SELECT count(*) FROM qa_results
    WHERE scenario ~ '^M(7|8|9) ' AND pass AND detail LIKE '%are set by OZZO%') = 3,
  coalesce((SELECT string_agg(scenario || ' => ' || detail, ' | ') FROM qa_results
             WHERE scenario ~ '^M(7|8|9) '), 'none recorded'));

SELECT qa_allowed('M10 an ordinary tenant save (rename) still works',
  'UPDATE public.accounts SET name = ''Renamed by its admin'' WHERE id = ' || quote_literal(:ACCT_A));

SELECT qa_allowed('M11 a tenant admin can still toggle their own modules',
  'UPDATE public.accounts SET module_settings = ''{"payment": true}''::jsonb
     WHERE id = ' || quote_literal(:ACCT_A));

RESET ROLE;

SELECT qa('M12 none of M7-M11 changed the granted list',
  (SELECT custom_features FROM public.accounts WHERE id = :ACCT_A) = ARRAY['acme_crate_label'],
  coalesce((SELECT array_to_string(custom_features, ',') FROM public.accounts WHERE id = :ACCT_A), 'null'));

-- ── M13-M15: key shape, for every writer ─────────────────────
-- A key is matched exactly by the code. A capital, a space or an empty string
-- grants nothing and cannot be seen on the screen, so it is refused at the door
-- even for the service role and even in the SQL editor.
SET ROLE service_role;
SELECT qa_refused('M13 a capitalised key is refused even for the service role',
  'UPDATE public.accounts SET custom_features = ARRAY[''Acme_Crate''] WHERE id = ' || quote_literal(:ACCT_B));
SELECT qa_refused('M14 a key with a space is refused',
  'UPDATE public.accounts SET custom_features = ARRAY[''acme crate''] WHERE id = ' || quote_literal(:ACCT_B));
SELECT qa_refused('M15 an empty string is refused',
  'UPDATE public.accounts SET custom_features = ARRAY[''''] WHERE id = ' || quote_literal(:ACCT_B));
SELECT qa_refused('M16 a NULL element is refused',
  'UPDATE public.accounts SET custom_features = ARRAY[''ok_key'', NULL] WHERE id = ' || quote_literal(:ACCT_B));
RESET ROLE;

SELECT qa('M-shape M13-M16 are all the key-shape refusal',
  (SELECT count(*) FROM qa_results
    WHERE scenario ~ '^M1(3|4|5|6) ' AND pass AND detail LIKE '%Not a custom feature key%') = 4,
  coalesce((SELECT string_agg(scenario || ' => ' || detail, ' | ') FROM qa_results
             WHERE scenario ~ '^M1(3|4|5|6) '), 'none recorded'));

SELECT qa('M17 tenant B still holds nothing after four refused writes',
  (SELECT custom_features FROM public.accounts WHERE id = :ACCT_B) = '{}'::text[],
  coalesce((SELECT array_to_string(custom_features, ',') FROM public.accounts WHERE id = :ACCT_B), 'null'));

-- ── M18-M20: the DMS portal's own read ───────────────────────
-- The portal holds SELECT on no table, so it asks portal_custom_features().
SET ROLE authenticated;
SELECT qa('M18 a signed-in employee is not a portal caller and gets nothing',
  coalesce(portal_custom_features(), '{}'::text[]) = '{}'::text[],
  'portal_custom_features must answer nothing for a non-portal caller');
RESET ROLE;

ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
DELETE FROM public.contacts WHERE id = :CF_DIST;
DELETE FROM auth.users WHERE id = :PORTAL_U;
INSERT INTO auth.users (id, email) VALUES (:PORTAL_U, 'cf-dist@portal.test');
INSERT INTO public.contacts (id, account_id, user_id, name, company, phone, hierarchy_level)
VALUES (:CF_DIST, :ACCT_A, :ADMIN_A, 'CF Dist', 'CF Distributor', '6900000001', 1);
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_user_id = :PORTAL_U, portal_email = 'cf-dist@portal.test',
       portal_access = true, portal_access_set_at = now() WHERE id = :CF_DIST;
-- The DMS add-on is what makes a portal login valid at all (portal_caller).
UPDATE public.accounts SET addon_lines = ARRAY['dms'], portal_seats_limit = 10 WHERE id = :ACCT_A;
RESET ROLE;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

SELECT set_config('test.uid', :PORTAL_U, false);
SET ROLE authenticated;

SELECT qa('M19 the portal login reads its own account''s granted list',
  portal_custom_features() = ARRAY['acme_crate_label'],
  coalesce(array_to_string(portal_custom_features(), ','), 'null'));

-- A portal login's write is stopped EARLIER than the guard, and it matters that
-- the difference is written down: a portal customer has no `profiles` row, so
-- is_account_member() is false and accounts_update offers it no row at all. The
-- UPDATE therefore succeeds against ZERO rows instead of raising — the trigger
-- never runs, because there is no row to run it on. Measured as a row count, so
-- this stays true if the guard is ever changed. (Written as a refusal first; the
-- suite reported "ALLOWED", which is how this was found.)
WITH upd AS (
  UPDATE public.accounts SET custom_features = ARRAY['free_stuff']
   WHERE id = 'aaaa0000-0000-0000-0000-000000000001'::uuid
  RETURNING 1
)
SELECT qa('M20 a portal login''s write to accounts reaches no row at all',
  (SELECT count(*) FROM upd) = 0,
  'a portal customer has no profiles row, so accounts_update must offer it nothing');

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

SELECT qa('M21 the portal write changed nothing',
  (SELECT custom_features FROM public.accounts WHERE id = :ACCT_A) = ARRAY['acme_crate_label'],
  coalesce((SELECT array_to_string(custom_features, ',') FROM public.accounts WHERE id = :ACCT_A), 'null'));

-- ── Put the tenant back ──────────────────────────────────────
-- A later file reading accounts must not inherit this file's grant.
UPDATE public.accounts SET custom_features = '{}' WHERE id IN (:ACCT_A, :ACCT_B);
