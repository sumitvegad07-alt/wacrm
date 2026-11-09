-- ============================================================
-- 20261109120000_dashboard_viewer_scope.sql
--
-- The mobile DASHBOARD stops showing a rep the whole company.
--
-- THE RULE (founder, 2026-11-08). On mobile an employee sees their OWN
-- records — orders, payments, visits, deals, expenses, everything — even when
-- Reporting Hierarchy is switched OFF. The reporting tree widens that
-- (downline with view_child_data, upline with view_parent_data) only when
-- hierarchy is ON. Owner / admin / superadmin / any role with {all:true} see
-- everything. Every mobile LIST already obeys this through the app-level
-- `useDataScope` hook: orders, payments, quotations, expenses, deals and
-- visits since 2026-11-08 (8320279), Activities and Route planning since
-- 2026-11-09 (1460d07).
--
-- THE DASHBOARD COULD NOT, AND THAT IS WHY IT NEEDED THIS MIGRATION. Its
-- figures do not come from list queries that a client filter can narrow. They
-- come from `execute_report` and the `dashboard_*` aggregates, which are
-- SECURITY INVOKER and therefore answer to RLS — and RLS still implements the
-- OLDER rule, where a non-admin goes account-wide once hierarchy is off. So a
-- Sales Executive's dashboard showed company totals and a Top Salespeople
-- leaderboard of his colleagues, while every list on the same phone correctly
-- showed only his own work.
--
-- WHAT THIS ADDS. One optional `p_user_ids uuid[]` on the functions the
-- dashboard calls, exactly as `dashboard_sales_metrics` has taken it since
-- 20261031120000. NULL means unrestricted, which is what the hook reports for
-- an owner/admin, so every existing caller — the whole web app, every report
-- screen, every saved view — keeps today's behaviour unchanged.
--
-- ALWAYS AUTH USER IDS, NEVER profiles.id. The two are different id spaces in
-- this schema and crossing them returns nothing at all, silently. Modules
-- whose ownership column holds a profiles.id (expense.employee_id,
-- task_assignees.profile_id) translate INSIDE the predicate, so the caller
-- only ever has one kind of id to get right.
--
-- AN EMPTY ARRAY MATCHES NOTHING, never everything — the same choice the
-- hook's sentinel-uuid filter makes. `= ANY('{}')` is already false for every
-- row, so this falls out of the predicate rather than needing a special case.
--
-- IT FAILS CLOSED, DELIBERATELY, IN TWO PLACES.
--   1. `execute_report` RAISES on a module with no scope rule, rather than
--      returning the account's rows. A module added later and forgotten here
--      is then a loud error on a dashboard, not a quiet leak.
--   2. Unknown keys in `p_filters` are skipped by design (the CONTINUE in the
--      filter loop), so a scope expressed as a FILTER would be silently
--      dropped by a database that had not run this migration — the caller
--      would believe it had scoped the query and show company figures anyway.
--      A PARAMETER cannot be ignored that way: PostgREST cannot find a
--      function for the argument list, the call fails, and the client shows a
--      notice instead of someone else's numbers.
--
-- CONTACTS ARE DELIBERATELY NOT SCOPED HERE. Who may see a CUSTOMER is decided
-- by area assignment in the database (`contacts_select`, migration
-- 20261102120000: own + the role's data scope + every assigned area), not by
-- ownership. ANDing an "own only" test onto that answer is exactly the bug
-- that emptied every new rep's customer list on 2026-11-02. So
-- `dashboard_contacts_daily` keeps no user filter and stays RLS-authoritative,
-- and the "New Customers" figure is already correct for every viewer.
--
-- NOTHING BREAKS BEFORE THIS RUNS. Web passes nothing and is untouched. The
-- phone only passes the parameter for a viewer who must be scoped, and shows
-- "needs the latest database update" rather than numbers if the call is
-- refused.
-- ============================================================


-- ── 1. A bug found while scoping the leaderboard it feeds ────
--
-- `orders.user_id REFERENCES auth.users(id)` (migration 068), so it is an AUTH
-- user id. The order module's `users` join has read
--   LEFT JOIN profiles u ON base.user_id = u.id
-- since the report engine was written — an auth id compared against
-- profiles.id, which are different id spaces, so it has never matched a row.
-- Every other module joins `u.user_id` correctly; `order` alone did not, and
-- `sales` resolves its joins from ['sales','order'] so it inherited the fault.
--
-- The effect, which is why this is worth fixing in the same breath: the "User"
-- dimension on the Order and Sales reports — and the Top Salespeople widget on
-- both dashboards, which is that dimension — has been labelling every row
-- 'Unassigned' for every tenant since 2026-08-11.
UPDATE report_registry_joins
   SET sql_join = 'LEFT JOIN profiles u ON base.user_id = u.user_id'
 WHERE module_name = 'order' AND join_key = 'users';


-- ── 2. Which column each module's ownership lives in ─────────
--
-- A table rather than a CASE so adding a module is a row, and so the fail-
-- closed check in execute_report has something to miss. `sql_where` is a
-- fragment spliced into the generated statement and may reference $3 (the
-- uuid[] of AUTH user ids) — nothing from it is ever built from user input.
CREATE TABLE IF NOT EXISTS report_registry_scopes (
  module_name TEXT PRIMARY KEY,
  sql_where   TEXT NOT NULL,
  -- Kept for symmetry with the other registry tables; no scope needs a join
  -- today because every predicate reaches the owning column from `base`.
  required_joins JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT
);

COMMENT ON TABLE report_registry_scopes IS
  'Per report module: how to narrow it to a set of AUTH user ids. Consulted by execute_report only when p_user_ids is supplied; a module missing from here RAISES rather than returning the whole account.';

-- READABLE BY EVERYONE, WRITABLE BY NOBODY — the same shape as the four
-- registry tables this one joins (20260811163442 lines 80-88).
--
-- Both halves matter, and getting either wrong breaks something:
--
--  * RLS ON WITH NO POLICY WOULD BREAK EVERY SCOPED DASHBOARD. execute_report
--    is SECURITY INVOKER, so it reads this table as the signed-in rep. With no
--    SELECT policy that read returns zero rows, the fail-closed guard fires
--    ("No scope rule for module …"), and the phone shows "Analytics needs a
--    database update" to everyone, for ever. This is what Supabase's SQL
--    editor offers to do for you with "Run and enable RLS": do not take it.
--
--  * RLS OFF WOULD BE WORSE THAN THE OTHER REGISTRY TABLES. Supabase grants
--    the API roles table privileges and relies on RLS to gate them, so a table
--    in `public` with RLS off is writable by any authenticated user — and
--    `sql_where` here is spliced straight into the generated statement. That
--    is an injection path, and it is exactly why the other registry tables
--    were given SELECT-only policies rather than left open.
--
-- SELECT USING (true) and no INSERT/UPDATE/DELETE policy gives both: the
-- engine can read it, nobody holding an anon or authenticated key can change
-- it, and migrations still write to it because service_role bypasses RLS.
ALTER TABLE report_registry_scopes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read scopes" ON report_registry_scopes;
CREATE POLICY "Anyone can read scopes" ON report_registry_scopes FOR SELECT USING (true);

INSERT INTO report_registry_scopes (module_name, sql_where, note) VALUES
  -- orders.user_id, payments.user_id, site_visits.user_id, leads.user_id,
  -- deals.user_id and quotations.user_id all reference auth.users(id).
  ('order',     'base.user_id = ANY($3)', 'orders.user_id is an auth user id'),
  ('sales',     'base.user_id = ANY($3)', 'sales reads orders'),
  ('payment',   'base.user_id = ANY($3)', 'payments.user_id is an auth user id'),
  ('visit',     'base.user_id = ANY($3)', 'site_visits.user_id is an auth user id'),
  ('lead',      'base.user_id = ANY($3)', 'leads.user_id is an auth user id'),
  ('deal',      'base.user_id = ANY($3)', 'deals.user_id is an auth user id'),
  ('quotation', 'base.user_id = ANY($3)', 'quotations.user_id is an auth user id'),
  -- expenses.employee_id is a profiles.id, NOT an auth id. Translated here so
  -- every caller passes the same kind of id.
  ('expense',
   'base.employee_id IN (SELECT p.id FROM profiles p WHERE p.user_id = ANY($3))',
   'expenses.employee_id is profiles.id — translated from the auth ids'),
  -- A task belongs to everyone assigned to it, so ownership is the join table,
  -- and task_assignees.profile_id is a profiles.id. tasks.assigned_user_id is
  -- ALSO a profiles.id despite its name (FK tasks_assigned_user_id_fkey →
  -- profiles), and carries tasks that have no assignee rows.
  ('task',
   '(EXISTS (SELECT 1 FROM task_assignees ta JOIN profiles p ON p.id = ta.profile_id'
   || '        WHERE ta.task_id = base.id AND p.user_id = ANY($3))'
   || ' OR base.assigned_user_id IN (SELECT p2.id FROM profiles p2 WHERE p2.user_id = ANY($3)))',
   'task_assignees.profile_id and tasks.assigned_user_id are both profiles.id'),
  -- DSR is built on profiles itself: one row per person.
  ('dsr', 'base.user_id = ANY($3)', 'dsr base is profiles; user_id is the auth id'),
  -- Customer Outstanding is one row per ORDER, so it owns like orders do.
  ('order_outstanding', 'base.user_id = ANY($3)', 'base is orders')
ON CONFLICT (module_name) DO UPDATE
  SET sql_where = EXCLUDED.sql_where,
      required_joins = EXCLUDED.required_joins,
      note = EXCLUDED.note;

-- The ABSENCE and master modules. These list customers or products that have
-- NO matching record, so "whose row is it" has no answer — and scoping a
-- customer list by ownership is the 2026-11-02 bug. They are registered with a
-- predicate that changes nothing, so they are explicitly unscoped rather than
-- accidentally missing from the table (which now raises).
INSERT INTO report_registry_scopes (module_name, sql_where, note)
SELECT m, 'TRUE', 'master/absence module — visibility is RLS and area assignment, never ownership'
  FROM unnest(ARRAY['ageing', 'ageing_product', 'customer_summary', 'product_summary']) AS m
ON CONFLICT (module_name) DO NOTHING;


-- ── 3. execute_report takes the viewer's scope ───────────────
--
-- PATCHED IN PLACE, from the LIVE definition — not rewritten from this repo.
--
-- That is not stylistic. `execute_report`'s module switch is not fully
-- described by any file here: 20260818160000 (task), 20260818180000 (dsr) and
-- 20261019120000 (product_summary, order_outstanding) each add their ELSIF
-- branch by reading pg_get_functiondef, splicing text in and EXECUTEing the
-- result. The newest full CREATE in this repo is 20260818090000, which knows
-- none of those modules. Re-creating the function from it would silently
-- delete every module added since, and the Task, DSR, Product Summary and
-- Customer Outstanding reports would all start answering "Unsupported
-- module". So this follows the same pattern those migrations established, and
-- refuses to patch at all if the text it expects has moved.
--
-- Adding a PARAMETER is the one thing those migrations never had to do, and
-- CREATE OR REPLACE cannot: a different argument list makes a second
-- OVERLOAD, and with two candidates PostgREST answers PGRST203 ("could not
-- choose the best candidate function") for every report in the product. The
-- old nine-argument function is therefore dropped between reading the
-- definition and installing the patched one — inside this transaction, so a
-- failure anywhere leaves the live function exactly as it was.
DO $do$
DECLARE
  v_def TEXT;
  v_account_anchor CONSTANT TEXT :=
    '  v_where_clause := array_append(v_where_clause, ''base.account_id = $1'');';
  v_execute_anchor CONSTANT TEXT :=
    '  EXECUTE v_sql INTO v_result USING p_account_id, p_filters;';
  v_args_anchor CONSTANT TEXT := 'p_offset integer DEFAULT 0)';
  v_scope_block TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'execute_report'
     -- The nine-argument one, i.e. the version without p_user_ids. Matching on
     -- the argument COUNT rather than on a rendered signature on purpose:
     -- pg_get_function_identity_arguments prints parameter NAMES as well as
     -- types ('p_account_id uuid, p_module text, …'), so comparing it to a
     -- list of types never matches and this migration would refuse to apply.
     AND p.pronargs = 9;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'execute_report(9 args) not found — refusing to guess at its definition';
  END IF;

  IF position('p_user_ids' IN v_def) > 0 THEN
    RAISE NOTICE 'execute_report already takes p_user_ids; nothing to do';
    RETURN;
  END IF;

  -- Every anchor must be present. A half-applied patch is worse than none:
  -- the parameter would exist and be ignored, which reads as "scoped" to the
  -- caller and returns the whole account.
  IF position(v_args_anchor IN v_def) = 0
     OR position(v_account_anchor IN v_def) = 0
     OR position(v_execute_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'execute_report has drifted from its expected shape; refusing to patch blindly';
  END IF;

  v_scope_block := v_account_anchor || E'\n'
    || E'\n'
    || E'  -- THE VIEWER''S SCOPE (20261109120000). Only consulted when the caller\n'
    || E'  -- supplies one: with p_user_ids NULL this does nothing whatever and the\n'
    || E'  -- function behaves exactly as it did before.\n'
    || E'  IF p_user_ids IS NOT NULL THEN\n'
    || E'    DECLARE\n'
    || E'      v_scope_rec RECORD;\n'
    || E'      v_scope_join TEXT;\n'
    || E'    BEGIN\n'
    || E'      SELECT * INTO v_scope_rec FROM report_registry_scopes WHERE module_name = p_module;\n'
    || E'      -- Fail CLOSED. Returning the account''s rows because nobody wrote a\n'
    || E'      -- rule for this module is precisely the leak being fixed.\n'
    || E'      IF NOT FOUND THEN\n'
    || E'        RAISE EXCEPTION ''No scope rule for module %, refusing to run it unscoped'', p_module\n'
    || E'          USING ERRCODE = ''42501'';\n'
    || E'      END IF;\n'
    || E'      v_where_clause := array_append(v_where_clause, ''('' || v_scope_rec.sql_where || '')'');\n'
    || E'      FOR v_scope_join IN SELECT jsonb_array_elements_text(v_scope_rec.required_joins) LOOP\n'
    || E'        IF NOT (v_scope_join = ANY(v_join_keys)) THEN\n'
    || E'          v_join_keys := array_append(v_join_keys, v_scope_join);\n'
    || E'        END IF;\n'
    || E'      END LOOP;\n'
    || E'    END;\n'
    || E'  END IF;';

  v_def := replace(v_def, v_args_anchor, 'p_offset integer DEFAULT 0, p_user_ids uuid[] DEFAULT NULL)');
  v_def := replace(v_def, v_account_anchor, v_scope_block);
  v_def := replace(v_def,
                   v_execute_anchor,
                   '  EXECUTE v_sql INTO v_result USING p_account_id, p_filters, p_user_ids;');

  -- Only now, with the replacement text in hand and every anchor confirmed.
  DROP FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer);
  EXECUTE v_def;
END
$do$;

-- A freshly created function grants EXECUTE to PUBLIC, and 20260816210000
-- deliberately took that away from anon. Re-apply it to the new signature.
REVOKE ALL ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer, uuid[]) IS
  'The report engine. p_user_ids narrows the report to a set of AUTH user ids (the viewer DataScope); NULL = unrestricted, which is every pre-2026-11-09 caller. A module with no row in report_registry_scopes raises rather than running unscoped.';


-- ── 4. The three dashboard aggregates that carry ownership ───
--
-- Same optional parameter, same NULL-means-unrestricted rule, bodies
-- otherwise exactly as 20261031120000 left them.
--
-- dashboard_contacts_daily is NOT in this list, on purpose — see the header.

DROP FUNCTION IF EXISTS public.dashboard_payment_daily(uuid, date, date, text[]);
DROP FUNCTION IF EXISTS public.dashboard_payment_daily(uuid, date, date, text[], uuid[]);
CREATE FUNCTION public.dashboard_payment_daily(
  p_account_id uuid,
  p_start date,
  p_end date,
  p_statuses text[],
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (day date, amount numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
DECLARE
  v_tz text;
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);
  v_tz := public.account_timezone(p_account_id);

  RETURN QUERY
  SELECT (p.created_at AT TIME ZONE v_tz)::date AS day,
         COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) AS amount
    FROM payments p
   WHERE p.account_id = p_account_id
     AND p.status = ANY (p_statuses)
     AND p.created_at >= public.account_date_start(p_account_id, p_start)
     AND p.created_at <  public.account_date_start(p_account_id, (p_end + 1))
     AND (p_user_ids IS NULL OR p.user_id = ANY (p_user_ids))
   GROUP BY 1
   ORDER BY 1;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_payment_daily(uuid, date, date, text[], uuid[]) TO authenticated, service_role;


DROP FUNCTION IF EXISTS public.dashboard_orders_by_status(uuid, date, date);
DROP FUNCTION IF EXISTS public.dashboard_orders_by_status(uuid, date, date, uuid[]);
CREATE FUNCTION public.dashboard_orders_by_status(
  p_account_id uuid,
  p_start date,
  p_end date,
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (status text, order_count bigint, order_value numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  RETURN QUERY
  SELECT o.status::text,
         COUNT(*) AS order_count,
         COALESCE(SUM(COALESCE(o.total_amount, 0)), 0) AS order_value
    FROM orders o
   WHERE o.account_id = p_account_id
     AND o.created_at >= public.account_date_start(p_account_id, p_start)
     AND o.created_at <  public.account_date_start(p_account_id, (p_end + 1))
     AND (p_user_ids IS NULL OR o.user_id = ANY (p_user_ids))
   GROUP BY o.status
   ORDER BY 2 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_orders_by_status(uuid, date, date, uuid[]) TO authenticated, service_role;


DROP FUNCTION IF EXISTS public.dashboard_open_deals_by_stage(uuid);
DROP FUNCTION IF EXISTS public.dashboard_open_deals_by_stage(uuid, uuid[]);
CREATE FUNCTION public.dashboard_open_deals_by_stage(
  p_account_id uuid,
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (stage_id uuid, deal_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  RETURN QUERY
  SELECT d.stage_id, COUNT(*) AS deal_count
    FROM deals d
   WHERE d.account_id = p_account_id
     AND d.status = 'open'
     AND d.stage_id IS NOT NULL
     AND (p_user_ids IS NULL OR d.user_id = ANY (p_user_ids))
   GROUP BY d.stage_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_open_deals_by_stage(uuid, uuid[]) TO authenticated, service_role;


-- ── 5. Make PostgREST notice the new signatures ─────────────
-- Four functions changed their argument list. Until the schema cache is
-- reloaded PostgREST still advertises the old ones and answers PGRST202 to a
-- scoped call, which the phone would correctly report as "needs a database
-- update" even though the update had just been applied. Supabase reloads on
-- DDL by itself, but saying so costs nothing and removes the puzzle.
NOTIFY pgrst, 'reload schema';
