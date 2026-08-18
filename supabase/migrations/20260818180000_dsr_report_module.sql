-- DSR (Daily Sales Report) — the suite's only CROSS-MODULE report.
--
-- One row per EMPLOYEE, with each column pulled from a different module: visits,
-- attendance, leave, orders, payments, expenses, leads, quotations, deals. A
-- manager reads one line and knows what a rep did that day.
--
-- ── Why every measure is a subquery, not a join ──────────────────────────────
-- Joining nine modules onto `profiles` would fan out catastrophically: a rep
-- with 10 orders and 5 visits yields 50 rows, and every total is multiplied by
-- the cardinality of every other module. Twin measures (§5d) cannot fix this —
-- they fix ONE fan-out, and this would be eight simultaneous ones.
--
-- So the DSR joins nothing. Every measure is
--     SUM((SELECT ... FROM <module> WHERE <keyed to base> AND <date window>))
-- a correlated scalar subquery evaluated once per employee row. Nothing can fan
-- out, and grouping by User or Role is equally correct because profiles never
-- duplicates.
--
-- ── The date window lives inside the measures ────────────────────────────────
-- `profiles` has no date, so `date_range` is registered as a deliberate no-op
-- (`TRUE`) on the base and each measure applies the window itself. The window is
-- COALESCEd to +/-infinity so a missing range means "all time" rather than
-- silently returning zeros.
--
-- ── Key discipline (this schema is a minefield) ──────────────────────────────
-- Verified by counting matches BOTH ways before writing any of this:
--   AUTH UID (base.user_id): contacts, tracking_sessions, site_visits, orders,
--                            payments, leads, quotations, deals
--   PROFILES.ID (base.id):   leave_days.employee_id, expenses.employee_id
-- Getting one wrong yields a silently empty column, never an error.
--
-- ── Definitions that are choices, not facts ──────────────────────────────────
-- * Assigned Customers is a CURRENT count (customers owned now), deliberately
--   not date-bound. Missed = Assigned - Visited, floored at zero so visiting a
--   customer who is not yours cannot produce a negative.
-- * Payment Collected = Approved + Pending + Rejected, EXCLUDING Cancelled — a
--   cancelled payment is a voided entry and was never collected. This is
--   deliberately different from the Payment report's Total, which includes
--   Cancelled because it reconciles every row ever written. Cancelled has its
--   own column so the money stays visible.
-- * Distance is ODOMETER-based (tracking_sessions.odometer_out - odometer_in),
--   not GPS. It is the figure travel allowance is paid on, and it counts only
--   sessions where BOTH readings were captured — on prod today that is 6 of 31
--   sessions, so this column under-reports until reps capture both photos.
--   A ping-derived haversine was rejected: the engine anticipates 1M+ pings and
--   a correlated distance computation per employee would not survive that.
-- * Quotation figures use latest-version-only, matching the Quotation report.
--   "Approved" counts status Approved OR Accepted — internal approval and
--   customer acceptance both mean the quotation was agreed.
--
-- ── Attendance source ────────────────────────────────────────────────────────
-- There is no `attendance` table. Punch in/out is `tracking_sessions`
-- (started_at / ended_at), which also carries the odometer readings.
-- Days Present = COUNT(DISTINCT started_at::date).
-- Leave Days sums leave_days.day_value (0.5 for half days) excluding Cancelled.

-- ── Base table ───────────────────────────────────────────────────────────────
-- Patched in place off pg_get_functiondef; refuses to run if the switch has
-- drifted, no-op if already applied.
DO $do$
DECLARE
  v_def    text;
  v_anchor text := E'  ELSE\n    RAISE EXCEPTION ''Unsupported module: %'', p_module;\n  END IF;';
  v_new    text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'execute_report';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'execute_report not found';
  END IF;

  IF position('p_module = ''dsr''' IN v_def) > 0 THEN
    RAISE NOTICE 'execute_report already knows the dsr module; nothing to do';
    RETURN;
  END IF;

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'execute_report module switch has drifted; refusing to patch blindly';
  END IF;

  v_new := $repl$  -- DSR is a CROSS-MODULE ROLL-UP. Its base is the employee list, and every
  -- measure reaches into a different module through its own correlated
  -- subquery, so no join can ever fan out. See §5k.
  ELSIF p_module = 'dsr' THEN
    v_base_table := 'profiles';
    v_registry_modules := ARRAY['dsr'];
$repl$ || v_anchor;

  EXECUTE replace(v_def, v_anchor, v_new);
END
$do$;

-- ── Joins ────────────────────────────────────────────────────────────────────
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('dsr', 'employee_role', 'LEFT JOIN employee_roles er ON base.employee_role_id = er.id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

-- ── Dimensions ───────────────────────────────────────────────────────────────
INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('dsr', 'branch', 'Branch', 'COALESCE(NULLIF(base.branch, ''''), ''Unassigned'')', '[]'),
('dsr', 'department', 'Department', 'COALESCE(NULLIF(base.department, ''''), ''Unassigned'')', '[]'),
-- profiles.role is 'user' for everyone and carries no meaning; the real role is
-- the configurable employee role, falling back to the account role.
('dsr', 'role', 'User Role', 'COALESCE(er.name, base.account_role::text, ''-'')', '["employee_role"]'),
('dsr', 'user', 'User', 'COALESCE(base.full_name, base.email, ''Unknown'')', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

-- ── Measures ─────────────────────────────────────────────────────────────────
-- Every one is SUM((correlated scalar subquery)) carrying its own date window.
-- The window is COALESCEd to +/-infinity so "no range" means all time.
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES

-- Coverage. Assigned is a CURRENT figure, deliberately not date-bound.
('dsr', 'assigned_customers', 'Assigned Customers',
 'SUM((SELECT COUNT(*) FROM contacts c WHERE c.account_id = base.account_id AND c.user_id = base.user_id))', 'number', '[]'),
('dsr', 'visited_customers', 'Visited Customers',
 'SUM((SELECT COUNT(DISTINCT COALESCE(v.target_id, v.contact_id)) FROM site_visits v WHERE v.account_id = base.account_id AND v.user_id = base.user_id AND COALESCE(v.target_type, ''Customer'') <> ''Lead'' AND v.check_in_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND v.check_in_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),
-- Floored at zero: visiting a customer who is not assigned to you must not
-- produce a negative "missed".
('dsr', 'missed_customers', 'Missed Customers',
 'SUM(GREATEST((SELECT COUNT(*) FROM contacts c WHERE c.account_id = base.account_id AND c.user_id = base.user_id) - (SELECT COUNT(DISTINCT COALESCE(v.target_id, v.contact_id)) FROM site_visits v WHERE v.account_id = base.account_id AND v.user_id = base.user_id AND COALESCE(v.target_type, ''Customer'') <> ''Lead'' AND v.check_in_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND v.check_in_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)), 0))', 'number', '[]'),

-- Attendance. There is no `attendance` table — tracking_sessions is punch in/out.
('dsr', 'days_present', 'Days Present',
 'SUM((SELECT COUNT(DISTINCT ts.started_at::date) FROM tracking_sessions ts WHERE ts.account_id = base.account_id AND ts.user_id = base.user_id AND ts.started_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND ts.started_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),
-- leave_days.employee_id is PROFILES.ID, not the auth uid. day_value carries the
-- half-day weighting, so a half day sums to 0.5.
('dsr', 'leave_days', 'Leave Days',
 'SUM((SELECT COALESCE(SUM(ld.day_value), 0) FROM leave_days ld WHERE ld.account_id = base.account_id AND ld.employee_id = base.id AND COALESCE(ld.status, '''') <> ''Cancelled'' AND ld.leave_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND ld.leave_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),
-- Odometer, not GPS — the figure travel allowance is paid on. Counts only
-- sessions where BOTH readings were captured.
('dsr', 'distance_km', 'Distance (km)',
 'SUM((SELECT COALESCE(SUM(GREATEST(ts.odometer_out_reading - ts.odometer_in_reading, 0)), 0) FROM tracking_sessions ts WHERE ts.account_id = base.account_id AND ts.user_id = base.user_id AND ts.odometer_in_reading IS NOT NULL AND ts.odometer_out_reading IS NOT NULL AND ts.started_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND ts.started_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),

-- Visits. Productive = produced an order, same definition as the Visit report.
('dsr', 'total_visits', 'Total Visits',
 'SUM((SELECT COUNT(*) FROM site_visits v WHERE v.account_id = base.account_id AND v.user_id = base.user_id AND v.check_in_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND v.check_in_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),
('dsr', 'productive_visits', 'Productive Visits',
 'SUM((SELECT COUNT(*) FROM site_visits v WHERE v.account_id = base.account_id AND v.user_id = base.user_id AND EXISTS (SELECT 1 FROM orders o WHERE o.site_visit_id = v.id) AND v.check_in_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND v.check_in_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),
('dsr', 'lead_visits', 'Lead Visits',
 'SUM((SELECT COUNT(*) FROM site_visits v WHERE v.account_id = base.account_id AND v.user_id = base.user_id AND v.target_type = ''Lead'' AND v.check_in_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND v.check_in_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),

-- Acquisition
('dsr', 'new_customers', 'New Customers',
 'SUM((SELECT COUNT(*) FROM contacts c WHERE c.account_id = base.account_id AND c.user_id = base.user_id AND c.created_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND c.created_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),
('dsr', 'new_leads', 'New Leads',
 'SUM((SELECT COUNT(*) FROM leads l WHERE l.account_id = base.account_id AND l.user_id = base.user_id AND l.created_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND l.created_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),

-- Orders
('dsr', 'order_count', 'Orders',
 'SUM((SELECT COUNT(*) FROM orders o WHERE o.account_id = base.account_id AND o.user_id = base.user_id AND o.date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND o.date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),
('dsr', 'order_amount', 'Order Amount',
 'SUM((SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.account_id = base.account_id AND o.user_id = base.user_id AND o.date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND o.date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
('dsr', 'order_quantity', 'Order Quantity',
 'SUM((SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.account_id = base.account_id AND o.user_id = base.user_id AND o.date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND o.date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),

-- Payments. Collected = Approved + Pending + Rejected, EXCLUDING Cancelled: a
-- cancelled payment is a voided entry and was never collected. Deliberately
-- different from the Payment report's Total, which includes Cancelled because it
-- reconciles every row ever written.
('dsr', 'payment_collected', 'Payment Collected',
 'SUM((SELECT COALESCE(SUM(CASE WHEN p.status::text = ''Approved'' THEN COALESCE(p.verified_amount, p.amount) WHEN p.status::text IN (''Pending'', ''Rejected'') THEN p.amount ELSE 0 END), 0) FROM payments p WHERE p.account_id = base.account_id AND p.user_id = base.user_id AND p.payment_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND p.payment_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
('dsr', 'payment_approved', 'Payment Approved',
 'SUM((SELECT COALESCE(SUM(CASE WHEN p.status::text = ''Approved'' THEN COALESCE(p.verified_amount, p.amount) ELSE 0 END), 0) FROM payments p WHERE p.account_id = base.account_id AND p.user_id = base.user_id AND p.payment_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND p.payment_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
('dsr', 'payment_pending', 'Payment Pending',
 'SUM((SELECT COALESCE(SUM(CASE WHEN p.status::text = ''Pending'' THEN p.amount ELSE 0 END), 0) FROM payments p WHERE p.account_id = base.account_id AND p.user_id = base.user_id AND p.payment_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND p.payment_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
('dsr', 'payment_rejected', 'Payment Rejected',
 'SUM((SELECT COALESCE(SUM(CASE WHEN p.status::text = ''Rejected'' THEN p.amount ELSE 0 END), 0) FROM payments p WHERE p.account_id = base.account_id AND p.user_id = base.user_id AND p.payment_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND p.payment_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
('dsr', 'payment_cancelled', 'Payment Cancelled',
 'SUM((SELECT COALESCE(SUM(CASE WHEN p.status::text = ''Cancelled'' THEN p.amount ELSE 0 END), 0) FROM payments p WHERE p.account_id = base.account_id AND p.user_id = base.user_id AND p.payment_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND p.payment_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),

-- Expenses. employee_id is PROFILES.ID, not the auth uid.
-- Claimed = Approved + Pending + Rejected (expenses have no cancelled state).
('dsr', 'expense_claimed', 'Expense Claimed',
 'SUM((SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.account_id = base.account_id AND e.employee_id = base.id AND e.expense_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND e.expense_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
('dsr', 'expense_approved', 'Expense Approved',
 'SUM((SELECT COALESCE(SUM(CASE WHEN e.status::text = ''Approved'' THEN COALESCE(e.approved_amount, e.amount) ELSE 0 END), 0) FROM expenses e WHERE e.account_id = base.account_id AND e.employee_id = base.id AND e.expense_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND e.expense_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
('dsr', 'expense_pending', 'Expense Pending',
 'SUM((SELECT COALESCE(SUM(CASE WHEN e.status::text = ''Pending'' THEN e.amount ELSE 0 END), 0) FROM expenses e WHERE e.account_id = base.account_id AND e.employee_id = base.id AND e.expense_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND e.expense_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
('dsr', 'expense_rejected', 'Expense Rejected',
 'SUM((SELECT COALESCE(SUM(CASE WHEN e.status::text = ''Rejected'' THEN e.amount ELSE 0 END), 0) FROM expenses e WHERE e.account_id = base.account_id AND e.employee_id = base.id AND e.expense_date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND e.expense_date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),

-- Quotations. Latest version only, matching the Quotation report — superseded
-- revisions would otherwise be counted beside the version that replaced them.
('dsr', 'quotation_amount', 'Quotation Amount',
 'SUM((SELECT COALESCE(SUM(q.total_amount), 0) FROM quotations q WHERE q.account_id = base.account_id AND q.user_id = base.user_id AND COALESCE(q.is_latest_version, true) AND q.date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND q.date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),
-- Approved OR Accepted: internal approval and customer acceptance both mean the
-- quotation was agreed.
('dsr', 'approved_quotation_amount', 'Approved Quotation Amount',
 'SUM((SELECT COALESCE(SUM(q.total_amount), 0) FROM quotations q WHERE q.account_id = base.account_id AND q.user_id = base.user_id AND COALESCE(q.is_latest_version, true) AND q.status::text IN (''Approved'', ''Accepted'') AND q.date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND q.date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]'),

-- Deals
('dsr', 'new_deals', 'New Deals',
 'SUM((SELECT COUNT(*) FROM deals d WHERE d.account_id = base.account_id AND d.user_id = base.user_id AND d.created_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND d.created_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'number', '[]'),
('dsr', 'deal_amount', 'Deal Amount',
 'SUM((SELECT COALESCE(SUM(d.value), 0) FROM deals d WHERE d.account_id = base.account_id AND d.user_id = base.user_id AND d.created_at::date >= COALESCE(($2::jsonb->''date_range''->>''start_date'')::date, ''-infinity''::date) AND d.created_at::date <= COALESCE(($2::jsonb->''date_range''->>''end_date'')::date, ''infinity''::date)))', 'currency', '[]')

ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

-- ── Filters ──────────────────────────────────────────────────────────────────
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
-- DELIBERATE NO-OP on the base. profiles has no date, so the window is applied
-- inside every measure instead. Registered rather than omitted so that its
-- absence from the WHERE clause is documented rather than mysterious.
('dsr', 'date_range', 'Period', 'TRUE', '[]'),
('dsr', 'employee_status', 'Employee Status', 'base.status = ($2::jsonb->>''employee_status'')', '[]'),
('dsr', 'role', 'User Role', 'COALESCE(er.name, base.account_role::text) = ($2::jsonb->>''role'')', '["employee_role"]'),
-- Compared as TEXT, never cast to uuid (§5i).
('dsr', 'user', 'User',
 'base.user_id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'') OR base.id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'')', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

-- Area as set membership (§5h): an employee covers many areas, so it can filter
-- but must never group.
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'dsr', 'territory_' || lvl, 'Territory Level ' || lvl,
       'EXISTS (SELECT 1 FROM employee_area_assignments eaa WHERE eaa.employee_id = base.id AND eaa.territory_id IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t))',
       '[]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;
