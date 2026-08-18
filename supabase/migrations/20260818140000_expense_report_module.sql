-- Expense report on the generic report engine.
--
-- `execute_report` already resolved p_module = 'expense' to the `expenses` table
-- (it has since the original engine migration), but nothing was ever registered
-- against it — the module was a base-table branch with an empty registry, so the
-- report could not be built. This migration fills it in.
--
-- ── Status pivot (§5c) ───────────────────────────────────────────────────────
-- Expenses have the same shape as payments: a lifecycle state that is a property
-- of the measure rather than something to group by. Every tab therefore carries
-- one column per status (Pending / Approved / Rejected / Total).
--
-- Note the same deliberate asymmetry payments have: Approved reads
-- `approved_amount` — what the approver actually sanctioned, which can be less
-- than what was claimed — falling back to `amount`. Pending and Rejected have no
-- sanctioned figure, so they use `amount`. Total mirrors that CASE exactly, so
-- Total = Pending + Approved + Rejected always reconciles. `claimed_amount` is
-- registered separately for "what was asked for before trimming"; the gap
-- between Claimed and Total is what approvers cut.
--
-- ── Two FK traps in this table ───────────────────────────────────────────────
-- `expenses.employee_id` -> profiles(**id**), while every other module joins
-- profiles on **user_id**. Getting this wrong yields a silently empty Employee
-- column, not an error.
-- `expenses.approved_by` has no FK at all and stores the **auth uid**, so the
-- approver joins profiles on user_id. The two columns on one table point at
-- different keys — hence two separate joins (`employee` and `approver`).
--
-- ── Why there is no Area tab ─────────────────────────────────────────────────
-- An expense has no geography of its own: no customer, no site, no territory
-- column. The only route to one is `employee_area_assignments`, which is
-- many-to-many — one employee on prod already covers SIX areas, so joining it
-- would multiply that employee's every amount by six.
--
-- There is also no honest way to split one hotel bill across six areas. So Area
-- is registered as a FILTER only, via EXISTS (set membership, no fan-out),
-- meaning "expenses claimed by employees who cover this area". It is deliberately
-- NOT a dimension: grouping by it would be a fabricated number.
--
-- Department / Branch / Designation ARE 1:1 with the employee and are registered
-- as dimensions, but they are not default tabs because all three columns are
-- empty for every profile on prod today. They start working the moment the HR
-- fields are filled in.

-- ── Joins ────────────────────────────────────────────────────────────────────
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
-- profiles(id) — NOT user_id. See the header.
('expense', 'employee',     'LEFT JOIN profiles u ON base.employee_id = u.id'),
-- auth uid — NOT profiles.id. See the header.
('expense', 'approver',     'LEFT JOIN profiles ap ON base.approved_by = ap.user_id'),
('expense', 'expense_type', 'LEFT JOIN expense_types et ON base.expense_type_id = et.id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

-- ── Dimensions ───────────────────────────────────────────────────────────────
INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('expense', 'user',           'User',           'COALESCE(u.full_name, u.email, ''Unassigned'')', '["employee"]'),
('expense', 'expense_type',   'Expense Type',   'COALESCE(et.expense_name, ''Unknown'')', '["expense_type"]'),
('expense', 'allowance_type', 'Allowance Type', 'COALESCE(NULLIF(et.allowance_type::text, ''''), ''-'')', '["expense_type"]'),
('expense', 'date',           'Period',         'TO_CHAR(base.expense_date, ''FMMonth YYYY'')', '[]'),
('expense', 'status',         'Status',         'base.status::text', '[]'),
('expense', 'approver',       'Approved By',    'COALESCE(ap.full_name, ap.email, ''Not approved'')', '["approver"]'),
-- Empty for every profile on prod today; harmless, and live the day HR fills them.
('expense', 'department',     'Department',     'COALESCE(NULLIF(u.department, ''''), ''Unassigned'')', '["employee"]'),
('expense', 'branch',         'Branch',         'COALESCE(NULLIF(u.branch, ''''), ''Unassigned'')', '["employee"]'),
('expense', 'designation',    'Designation',    'COALESCE(NULLIF(u.designation, ''''), ''Unassigned'')', '["employee"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

-- ── Measures ─────────────────────────────────────────────────────────────────
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
-- The status pivot. Mutually exclusive, and they sum to Total by construction.
('expense', 'pending_amount',  'Pending',
 'SUM(CASE WHEN base.status = ''Pending''  THEN COALESCE(base.amount, 0) ELSE 0 END)', 'currency', '[]'),
('expense', 'approved_amount', 'Approved',
 'SUM(CASE WHEN base.status = ''Approved'' THEN COALESCE(base.approved_amount, base.amount, 0) ELSE 0 END)', 'currency', '[]'),
('expense', 'rejected_amount', 'Rejected',
 'SUM(CASE WHEN base.status = ''Rejected'' THEN COALESCE(base.amount, 0) ELSE 0 END)', 'currency', '[]'),
-- Mirrors the buckets' choice of column exactly, so it always reconciles.
('expense', 'total_amount',    'Total',
 'SUM(CASE WHEN base.status = ''Approved'' THEN COALESCE(base.approved_amount, base.amount, 0) ELSE COALESCE(base.amount, 0) END)', 'currency', '[]'),
-- What was asked for, before approvers trimmed it. Claimed - Total = the cut.
('expense', 'claimed_amount',  'Claimed',  'SUM(COALESCE(base.amount, 0))', 'currency', '[]'),
('expense', 'expense_count',   '# of expenses', 'COUNT(DISTINCT base.id)', 'number', '[]'),
('expense', 'pending_count',   '# pending',  'COUNT(DISTINCT base.id) FILTER (WHERE base.status = ''Pending'')',  'number', '[]'),
('expense', 'approved_count',  '# approved', 'COUNT(DISTINCT base.id) FILTER (WHERE base.status = ''Approved'')', 'number', '[]'),
('expense', 'rejected_count',  '# rejected', 'COUNT(DISTINCT base.id) FILTER (WHERE base.status = ''Rejected'')', 'number', '[]'),
('expense', 'travel_km',       'Travel (km)', 'SUM(COALESCE(base.travel_km, 0))', 'number', '[]'),
-- Computed per group, never summed (§5e).
('expense', 'approval_ratio',  'Approved %',
 'ROUND(100.0 * SUM(CASE WHEN base.status = ''Approved'' THEN COALESCE(base.approved_amount, base.amount, 0) ELSE 0 END) / NULLIF(SUM(CASE WHEN base.status = ''Approved'' THEN COALESCE(base.approved_amount, base.amount, 0) ELSE COALESCE(base.amount, 0) END), 0), 1)', 'percent', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

-- ── Filters ──────────────────────────────────────────────────────────────────
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('expense', 'date_range', 'Period',
 'base.expense_date >= ($2::jsonb->''date_range''->>''start_date'')::date AND base.expense_date <= ($2::jsonb->''date_range''->>''end_date'')::date', '[]'),
-- Cast the enum to text rather than the literal to the enum: an unknown value
-- then returns nothing instead of raising invalid_text_representation.
('expense', 'status', 'Status', 'base.status::text = ($2::jsonb->>''status'')', '[]'),
('expense', 'expense_type', 'Expense Type', 'base.expense_type_id = ($2::jsonb->>''expense_type'')::uuid', '[]'),
('expense', 'allowance_type', 'Allowance Type', 'et.allowance_type::text = ($2::jsonb->>''allowance_type'')', '["expense_type"]'),
-- employee_id points at profiles.id, but the picker may hand back either key.
-- Compared as TEXT, not cast to uuid: the payload is a bare string today but an
-- object in other modules' conventions, and ($2->>'user')::uuid raises 22P02 on
-- the object form rather than simply not matching.
('expense', 'user', 'User',
 'base.employee_id IN (SELECT p.id FROM profiles p WHERE p.user_id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'') OR p.id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user''))', '[]'),
('expense', 'approver', 'Approved By',
 'base.approved_by IN (SELECT p.user_id FROM profiles p WHERE p.user_id::text = COALESCE($2::jsonb->''approver''->>''user_id'', $2::jsonb->>''approver'') OR p.id::text = COALESCE($2::jsonb->''approver''->>''user_id'', $2::jsonb->>''approver''))', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

-- Area as set membership, never as a join — see the header for why.
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'expense', 'territory_' || lvl, 'Territory Level ' || lvl,
       'EXISTS (SELECT 1 FROM employee_area_assignments eaa WHERE eaa.employee_id = base.employee_id AND eaa.territory_id IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t))',
       '[]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;
