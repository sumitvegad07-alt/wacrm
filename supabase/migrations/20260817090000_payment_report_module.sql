-- Payment Report on the generic report engine.
--
-- Payments were the one report that never joined the engine: executeReport()
-- short-circuited to executePaymentReportLocal(), a hand-rolled TypeScript
-- aggregation that pulled every payment row over REST and grouped it in Node.
-- That is exactly what docs/report-engine.md §2 forbids, and it meant the payment
-- report quietly lacked area/territory dimensions, sorting pushdown, real
-- pagination and the totals the other reports get for free.
--
-- This migration registers `payment` properly. The TypeScript fallback is deleted
-- in the same change.
--
-- Column shape (founder decision, 2026-08-17): every tab shows the same columns —
-- one per payment status plus a reconciling Total — so a Customer/User/Area/Period/
-- Status row always reads "of this much collected, X is approved, Y still pending".
--   Total = Pending + Approved + Rejected + Cancelled, exactly.
-- Approved uses verified_amount (what was actually confirmed received) falling back
-- to amount; every other status has no verified figure, so it uses amount.

-- ── Base table ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_report(
  p_account_id uuid,
  p_module text,
  p_dimensions text[],
  p_measures text[],
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort_column text DEFAULT NULL::text,
  p_sort_direction text DEFAULT 'asc'::text,
  p_limit integer DEFAULT NULL::integer,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_base_table TEXT;
  v_registry_modules TEXT[];
  v_sql TEXT;
  v_select_clause TEXT[] := '{}';
  v_group_clause TEXT[] := '{}';
  v_where_clause TEXT[] := '{}';
  v_join_keys TEXT[] := '{}';
  v_joins TEXT[] := '{}';
  v_result JSONB;

  v_dim_rec RECORD;
  v_meas_rec RECORD;
  v_filt_rec RECORD;
  v_join_sql TEXT;
  v_req_join TEXT;
  v_filter_key TEXT;
  v_safe_direction TEXT;
BEGIN
  IF p_module = 'order' THEN
    v_base_table := 'orders';
    v_registry_modules := ARRAY['order'];
  ELSIF p_module = 'sales' THEN
    v_base_table := 'orders';
    v_registry_modules := ARRAY['sales', 'order'];
  ELSIF p_module = 'payment' THEN
    v_base_table := 'payments';
    v_registry_modules := ARRAY['payment'];
  ELSIF p_module = 'expense' THEN
    v_base_table := 'expenses';
    v_registry_modules := ARRAY['expense'];
  ELSE
    RAISE EXCEPTION 'Unsupported module: %', p_module;
  END IF;

  v_where_clause := array_append(v_where_clause, 'base.account_id = $1');

  IF p_module = 'sales' THEN
    v_where_clause := array_append(v_where_clause, 'base.status = ''Closed''');
  END IF;

  FOR i IN 1 .. COALESCE(array_length(p_dimensions, 1), 0) LOOP
    SELECT * INTO v_dim_rec
      FROM report_registry_dimensions
     WHERE module_name = ANY(v_registry_modules) AND key = p_dimensions[i]
     ORDER BY array_position(v_registry_modules, module_name)
     LIMIT 1;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_select_clause := array_append(v_select_clause, v_dim_rec.sql_select || ' AS "' || p_dimensions[i] || '"');
    v_group_clause := array_append(v_group_clause, v_dim_rec.sql_select);

    FOR v_req_join IN SELECT jsonb_array_elements_text(v_dim_rec.required_joins) LOOP
      IF NOT (v_req_join = ANY(v_join_keys)) THEN
        v_join_keys := array_append(v_join_keys, v_req_join);
      END IF;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. COALESCE(array_length(p_measures, 1), 0) LOOP
    SELECT * INTO v_meas_rec
      FROM report_registry_measures
     WHERE module_name = ANY(v_registry_modules) AND key = p_measures[i]
     ORDER BY array_position(v_registry_modules, module_name)
     LIMIT 1;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_select_clause := array_append(v_select_clause, v_meas_rec.sql_select || ' AS "' || p_measures[i] || '"');

    FOR v_req_join IN SELECT jsonb_array_elements_text(v_meas_rec.required_joins) LOOP
      IF NOT (v_req_join = ANY(v_join_keys)) THEN
        v_join_keys := array_append(v_join_keys, v_req_join);
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(v_select_clause, 1) IS NULL THEN
    v_select_clause := array_append(v_select_clause, 'COUNT(DISTINCT base.id) AS "record_count"');
  END IF;

  FOR v_filter_key IN SELECT jsonb_object_keys(p_filters) LOOP
    SELECT * INTO v_filt_rec
      FROM report_registry_filters
     WHERE module_name = ANY(v_registry_modules) AND key = v_filter_key
     ORDER BY array_position(v_registry_modules, module_name)
     LIMIT 1;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_where_clause := array_append(v_where_clause, v_filt_rec.sql_where);

    FOR v_req_join IN SELECT jsonb_array_elements_text(v_filt_rec.required_joins) LOOP
      IF NOT (v_req_join = ANY(v_join_keys)) THEN
        v_join_keys := array_append(v_join_keys, v_req_join);
      END IF;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. COALESCE(array_length(v_join_keys, 1), 0) LOOP
    SELECT sql_join INTO v_join_sql
      FROM report_registry_joins
     WHERE module_name = ANY(v_registry_modules) AND join_key = v_join_keys[i]
     ORDER BY array_position(v_registry_modules, module_name)
     LIMIT 1;
    IF FOUND THEN
      v_joins := array_append(v_joins, v_join_sql);
    END IF;
  END LOOP;

  v_sql := 'SELECT COALESCE(jsonb_agg(row_to_json(res)), ''[]''::jsonb) FROM (';
  v_sql := v_sql || ' SELECT ' || array_to_string(v_select_clause, ', ');
  v_sql := v_sql || ' FROM ' || v_base_table || ' base ';

  IF array_length(v_joins, 1) > 0 THEN
    v_sql := v_sql || array_to_string(v_joins, ' ');
  END IF;

  v_sql := v_sql || ' WHERE ' || array_to_string(v_where_clause, ' AND ');

  IF array_length(v_group_clause, 1) > 0 THEN
    v_sql := v_sql || ' GROUP BY ' || array_to_string(v_group_clause, ', ');
  END IF;

  IF p_sort_column IS NOT NULL AND p_sort_column != '' THEN
    v_safe_direction := CASE WHEN lower(p_sort_direction) = 'desc' THEN 'DESC' ELSE 'ASC' END;
    v_sql := v_sql || ' ORDER BY "' || replace(p_sort_column, '"', '') || '" ' || v_safe_direction;
  END IF;

  IF p_limit IS NOT NULL THEN
    v_sql := v_sql || ' LIMIT ' || p_limit;
  END IF;

  IF p_offset > 0 THEN
    v_sql := v_sql || ' OFFSET ' || p_offset;
  END IF;

  v_sql := v_sql || ') res';

  EXECUTE v_sql INTO v_result USING p_account_id, p_filters;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ── Joins ─────────────────────────────────────────────────────────────────────
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('payment', 'contacts', 'LEFT JOIN contacts c ON base.contact_id = c.id'),
('payment', 'users',    'LEFT JOIN profiles u ON base.user_id = u.user_id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

-- ── Dimensions ────────────────────────────────────────────────────────────────
INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('payment', 'customer',     'Customer',     'COALESCE(c.company, c.name)',                  '["contacts"]'),
('payment', 'user',         'Collected By', 'COALESCE(u.full_name, u.email, ''Unassigned'')', '["users"]'),
('payment', 'country',      'Country',      'COALESCE(c.country, ''India'')',               '["contacts"]'),
('payment', 'state',        'State',        'c.state',                                      '["contacts"]'),
('payment', 'city',         'City',         'c.city',                                       '["contacts"]'),
('payment', 'area',         'Area',         'COALESCE(c.area, ''-'')',                      '["contacts"]'),
('payment', 'date',         'Period',       'TO_CHAR(base.payment_date, ''FMMonth YYYY'')', '[]'),
('payment', 'status',       'Status',       'base.status',                                  '[]'),
('payment', 'payment_type', 'Payment Type', 'base.payment_type',                            '[]'),
('payment', 'source',       'Source',       'base.source',                                  '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

-- ── Measures ──────────────────────────────────────────────────────────────────
-- The status pivot. These five reconcile: Total = Pending + Approved + Rejected
-- + Cancelled, because every payment falls in exactly one status bucket and the
-- Total's CASE mirrors the buckets' amount choice.
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('payment', 'pending_amount',   'Pending',          'SUM(CASE WHEN base.status = ''Pending''   THEN base.amount ELSE 0 END)', 'currency', '[]'),
('payment', 'approved_amount',  'Approved',         'SUM(CASE WHEN base.status = ''Approved''  THEN COALESCE(base.verified_amount, base.amount) ELSE 0 END)', 'currency', '[]'),
('payment', 'rejected_amount',  'Rejected',         'SUM(CASE WHEN base.status = ''Rejected''  THEN base.amount ELSE 0 END)', 'currency', '[]'),
('payment', 'cancelled_amount', 'Cancelled',        'SUM(CASE WHEN base.status = ''Cancelled'' THEN base.amount ELSE 0 END)', 'currency', '[]'),
('payment', 'total_amount',     'Total',            'SUM(CASE WHEN base.status = ''Approved''  THEN COALESCE(base.verified_amount, base.amount) ELSE base.amount END)', 'currency', '[]'),
('payment', 'payment_count',    '# of payments',    'COUNT(DISTINCT base.id)',                       'number',   '[]'),
('payment', 'customer_count',   '# of customers',   'COUNT(DISTINCT base.contact_id)',               'number',   '[]'),
('payment', 'amount',           'Requested Amount', 'SUM(base.amount)',                              'currency', '[]'),
('payment', 'verified_amount',  'Verified Amount',  'SUM(COALESCE(base.verified_amount, 0))',        'currency', '[]'),
('payment', 'avg_payment',      'Avg Payment',      'ROUND(AVG(base.amount)::numeric, 2)',           'currency', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

-- ── Filters ───────────────────────────────────────────────────────────────────
-- Deliberately NO product / category / sub-category filters: payments have no
-- product dimension, and offering them would return empty reports.
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('payment', 'date_range',   'Period',       'base.payment_date >= ($2::jsonb->''date_range''->>''start_date'')::date AND base.payment_date <= ($2::jsonb->''date_range''->>''end_date'')::date', '[]'),
('payment', 'status',       'Status',       'base.status = ($2::jsonb->>''status'')',             '[]'),
('payment', 'payment_type', 'Payment Type', 'base.payment_type = ($2::jsonb->>''payment_type'')', '[]'),
('payment', 'source',       'Source',       'base.source = ($2::jsonb->>''source'')',             '[]'),
('payment', 'customer',     'Customer',     'base.contact_id = ($2::jsonb->''customer''->>''contact_id'')::uuid', '[]'),
('payment', 'user',         'Collected By', 'base.user_id IN (SELECT user_id FROM profiles WHERE user_id = ($2::jsonb->''user''->>''user_id'')::uuid OR id = ($2::jsonb->''user''->>''user_id'')::uuid OR user_id = ($2::jsonb->>''user'')::uuid OR id = ($2::jsonb->>''user'')::uuid)', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

-- Territory filters mirror the order module: recursive descent so picking a parent
-- territory includes every territory beneath it.
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'payment',
       'territory_' || lvl,
       'Territory Level ' || lvl,
       'c.territory_id IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t)',
       '["contacts"]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

COMMENT ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer) IS
  'Generic report executor. Modules: order, sales, payment, expense. `sales` reuses the order registry and adds a non-negotiable status = ''Closed'' predicate plus its own dispatch-completion date basis. Must remain SECURITY INVOKER so RLS applies.';
