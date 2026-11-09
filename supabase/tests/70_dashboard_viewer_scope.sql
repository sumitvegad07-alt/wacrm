-- ============================================================
-- 2026-11-09 — the dashboard's viewer scope (20261109120000).
--
-- The mobile dashboard showed a Sales Executive the whole company's totals
-- while every list on the same phone correctly showed only his own work.
-- Those figures come from `execute_report` and the dashboard_* aggregates,
-- which are SECURITY INVOKER and so answer to RLS — and RLS still implements
-- the older rule where a non-admin goes account-wide once Reporting Hierarchy
-- is off. So the viewer's scope has to be passed in explicitly.
--
-- WHY THIS FILE EXISTS. The migration PATCHES the live `execute_report`
-- rather than re-creating it, because its module switch is not described by
-- any single file in the repo: task, dsr, product_summary and
-- order_outstanding each splice their own ELSIF in via pg_get_functiondef. A
-- patch landing on text that has moved is the whole risk — and the first
-- version of that patch DID fail: it looked for the nine-argument function by
-- comparing `pg_get_function_identity_arguments` against a list of TYPES,
-- when that function prints parameter NAMES as well, so nothing matched and
-- the guard refused to apply. Nothing else in this suite calls the report
-- engine, so a silently broken engine would have left all 181 existing
-- scenarios green.
--
-- Assertions are top-level `SELECT qa(...)` on purpose: the runner counts
-- those to detect a file that aborted half way, and a file written as DO
-- blocks records fewer results instead of reporting an error.
--
-- Runs last, and establishes its own starting state.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT '''aaaa0000-0000-0000-0000-000000000001'''
\set ADMIN_UID '''11110000-0000-0000-0000-000000000001'''
\set AGENT_UID '''11110000-0000-0000-0000-000000000002'''
\set SHOP1 '''c0000000-0000-0000-0000-000000000001'''
\set SHOP2 '''c0000000-0000-0000-0000-000000000002'''

SELECT set_config('test.uid', :ADMIN_UID, false);

-- Hierarchy off, so a level-less customer can be written (migration 076).
UPDATE accounts
   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb),
                            '{order_settings,hierarchy_enabled}', 'false'::jsonb, true)
 WHERE id = :ACCT;

-- Two orders for the admin, one for the agent. Distinct amounts, so a wrong
-- total is unmistakable rather than off by a rounding.
DELETE FROM orders WHERE account_id = :ACCT;
INSERT INTO orders(account_id, user_id, order_number, contact_id, status, date, total_amount) VALUES
 (:ACCT, :ADMIN_UID, 'SCOPE-A1', :SHOP1, 'Closed', CURRENT_DATE, 100),
 (:ACCT, :ADMIN_UID, 'SCOPE-A2', :SHOP2, 'Closed', CURRENT_DATE, 200),
 (:ACCT, :AGENT_UID, 'SCOPE-B1', :SHOP1, 'Closed', CURRENT_DATE,  40);


-- ── 1. The parameter exists, and defaults to unrestricted ────
-- Every caller that predates this migration — the whole web app, every report
-- screen and saved view — sends nine arguments and must keep seeing
-- everything. This is the compatibility guarantee, and the easiest thing to
-- break by accident.
SELECT qa('scope: a nine-argument call still sees the whole account',
          (public.execute_report(:ACCT::uuid, 'order', ARRAY[]::text[], ARRAY['net_amount'])
             -> 0 ->> 'net_amount')::numeric = 340,
          'got ' || COALESCE((public.execute_report(:ACCT::uuid, 'order', ARRAY[]::text[], ARRAY['net_amount'])
             -> 0 ->> 'net_amount'), 'NULL') || ', expected 340');

-- ── 2. A scope narrows the figure to that person ─────────────
SELECT qa('scope: one user sees only their own orders',
          (public.execute_report(:ACCT::uuid, 'order', ARRAY[]::text[], ARRAY['net_amount'],
                                 '{}'::jsonb, NULL, 'asc', NULL, 0,
                                 ARRAY[:AGENT_UID]::uuid[])
             -> 0 ->> 'net_amount')::numeric = 40,
          'the agent booked 40 of the account''s 340');

-- ── 3. A manager's tree is the union, not just themselves ────
SELECT qa('scope: a reporting tree sees the union of its members',
          (public.execute_report(:ACCT::uuid, 'order', ARRAY[]::text[], ARRAY['net_amount'],
                                 '{}'::jsonb, NULL, 'asc', NULL, 0,
                                 ARRAY[:ADMIN_UID, :AGENT_UID]::uuid[])
             -> 0 ->> 'net_amount')::numeric = 340,
          'both members together booked all 340');

-- ── 4. An empty scope matches NOTHING, never everything ──────
-- The same choice the app-side hook makes with its sentinel uuid. Getting
-- this backwards turns "this person may see nobody" into "this person may see
-- everyone", which is the worst available direction to fail in.
SELECT qa('scope: an empty id list matches nothing',
          COALESCE((public.execute_report(:ACCT::uuid, 'order', ARRAY[]::text[], ARRAY['net_amount'],
                                          '{}'::jsonb, NULL, 'asc', NULL, 0, ARRAY[]::uuid[])
                      -> 0 ->> 'net_amount')::numeric, 0) = 0,
          'an empty scope must not fall back to the whole account');

-- ── 5. The spliced-in modules survived the patch ─────────────
-- These four branches exist only in the LIVE function body — task (20260818160000),
-- dsr (20260818180000), product_summary and order_outstanding (20261019120000)
-- each add theirs by string replacement. Re-creating the function from the
-- newest full CREATE in this repo would delete all four, and the Task, DSR,
-- Product Summary and Customer Outstanding reports would start answering
-- "Unsupported module". Asserted against the function source, so it is the
-- splice itself being checked rather than a report that might fail for its
-- own reasons.
SELECT qa('scope: the modules spliced in by later migrations survived the patch',
          (SELECT bool_and(pg_get_functiondef(p.oid) LIKE '%p_module = ''' || m || '''%')
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN unnest(ARRAY['task','dsr','product_summary','order_outstanding']) AS m
            WHERE n.nspname = 'public' AND p.proname = 'execute_report'),
          'task / dsr / product_summary / order_outstanding must all still resolve');

-- ── 6. Exactly one execute_report, with ten arguments ────────
-- Adding an argument with CREATE OR REPLACE makes a second OVERLOAD rather
-- than replacing anything, and with two candidates PostgREST answers PGRST203
-- for every report in the product.
SELECT qa('scope: there is exactly one execute_report, and it takes ten arguments',
          (SELECT count(*) = 1 AND bool_and(p.pronargs = 10)
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'execute_report'),
          'two overloads would break every report');

-- ── 7. A module with no scope rule REFUSES to run unscoped ───
-- Fail closed. A module added later and forgotten in report_registry_scopes
-- must be a loud error on one dashboard, never a quiet leak of the whole
-- account onto every rep's phone.
DELETE FROM report_registry_scopes WHERE module_name = 'order';

SELECT qa_refused('scope: a module with no rule refuses rather than running unscoped',
                  format($q$SELECT public.execute_report(%L::uuid, 'order',
                              ARRAY[]::text[], ARRAY['net_amount'],
                              '{}'::jsonb, NULL, 'asc', NULL, 0,
                              ARRAY[%L]::uuid[])$q$,
                         'aaaa0000-0000-0000-0000-000000000001',
                         '11110000-0000-0000-0000-000000000002'));

INSERT INTO report_registry_scopes(module_name, sql_where, note)
VALUES ('order', 'base.user_id = ANY($3)', 'orders.user_id is an auth user id')
ON CONFLICT (module_name) DO UPDATE SET sql_where = EXCLUDED.sql_where;

-- ── 8. The dashboard aggregates take it too ──────────────────
SELECT qa('scope: dashboard_orders_by_status is unrestricted by default',
          (SELECT COALESCE(SUM(order_value), 0)
             FROM public.dashboard_orders_by_status(:ACCT::uuid, CURRENT_DATE, CURRENT_DATE)) = 340,
          'no scope argument must keep today''s behaviour');

SELECT qa('scope: dashboard_orders_by_status narrows to the given users',
          (SELECT COALESCE(SUM(order_value), 0)
             FROM public.dashboard_orders_by_status(:ACCT::uuid, CURRENT_DATE, CURRENT_DATE,
                                                    ARRAY[:AGENT_UID]::uuid[])) = 40,
          'the agent booked 40');

-- ── 9. New customers are NOT scoped by ownership ─────────────
-- Who may see a CUSTOMER is area assignment (contacts_select), not who
-- created the row. ANDing "own only" onto that is what emptied every new
-- rep's Customers screen on 2026-11-02, so dashboard_contacts_daily
-- deliberately has no user parameter at all.
SELECT qa('scope: dashboard_contacts_daily takes no user filter, by design',
          (SELECT count(*) = 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = 'dashboard_contacts_daily'
              AND NOT (pg_get_function_arguments(p.oid) LIKE '%p_user_ids%')),
          'customers are scoped by area in RLS, never by ownership here');

-- ── 10. The order report can name its salespeople again ──────
-- orders.user_id references auth.users, but the order module's `users` join
-- read `profiles u ON base.user_id = u.id` — an auth id against a profiles.id,
-- two different id spaces — so it never matched. Top Salespeople on both
-- dashboards has been labelling every row 'Unassigned' since 2026-08-11.
SELECT qa('scope: the order report resolves a salesperson''s name',
          public.execute_report(:ACCT::uuid, 'order', ARRAY['user'], ARRAY['net_amount'])::text
            LIKE '%Admin A%',
          'got ' || COALESCE(public.execute_report(:ACCT::uuid, 'order', ARRAY['user'],
                                                   ARRAY['net_amount'])::text, 'NULL'));

SELECT 'dashboard viewer scope scenarios done' AS status;
