-- Sales Report module
--
-- A Sales Report that mirrors the Order Report, counting only orders that have
-- been fully dispatched. The dispatch trigger (`sync_order_dispatch_status`,
-- migration 20260814151500_autoclose_fully_dispatched.sql) auto-closes an order
-- the moment its last outstanding item ships, so "fully dispatched" is read off
-- `status = 'Closed'`.
--
-- Design: the `sales` module does NOT get its own copy of the registry rows.
-- Duplicating 11 dimensions + 10 measures + 19 filters would guarantee the two
-- reports drift apart the first time someone edits one of them. Instead
-- `execute_report` resolves registry keys against an ordered list of modules:
-- for 'sales' that is ['sales', 'order'] — a sales-specific row wins, otherwise
-- the order row is used verbatim. Two rows are overridden (see step 3, the date
-- basis); everything else is inherited. The `status = 'Closed'` predicate is
-- hard-wired in the RPC, not registered as a filter, so no caller can remove it.
--
-- Founder decisions, 2026-08-16:
--   * Sales = orders with status 'Closed'. Closed is trusted as-is. A manually
--     closed order (Approved → Closed is a legal transition) counts as a sale
--     even though nothing shipped — this was chosen knowingly over recomputing
--     dispatch coverage, because Closed is what the Orders screen shows.
--   * A sale is dated by when it FINISHED dispatching, not when it was ordered.
--     An order placed 9 Aug and fully dispatched 14 Aug is August-14 revenue.
--     Consequence: the Sales Report's Period filter and Time tab will NOT line
--     up row-for-row against the Order Report. That is intended.

-- 1. Fix the Sales Type filter (pre-existing bug).
--    `orders` has no `sales_type` column — the value lives in `orders.classification`
--    ('direct' | 'primary' | 'secondary'). Applying this filter raised
--    "column base.sales_type does not exist" and blanked the report. It went
--    unnoticed because the filter is only rendered when customer hierarchy is
--    enabled (see report-filter-drawer.tsx isFilterVisible).
UPDATE report_registry_filters
   SET sql_where = 'base.classification = ($2::jsonb->>''sales_type'')'
 WHERE module_name = 'order' AND key = 'sales_type';

-- 2. Module-aware registry resolution + the sales status gate.
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
SECURITY INVOKER -- MUST stay INVOKER so RLS (tenant + area visibility) applies
AS $function$
DECLARE
  v_base_table TEXT;
  -- Registry modules to search, most specific first. Lets 'sales' inherit every
  -- dimension/measure/filter/join registered for 'order' without duplicating rows.
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
    -- Sales = orders that are fully dispatched. Same base table, same registry.
    v_base_table := 'orders';
    v_registry_modules := ARRAY['sales', 'order'];
  ELSIF p_module = 'expense' THEN
    v_base_table := 'expenses';
    v_registry_modules := ARRAY['expense'];
  ELSE
    RAISE EXCEPTION 'Unsupported module: %', p_module;
  END IF;

  v_where_clause := array_append(v_where_clause, 'base.account_id = $1');

  -- Sales gate: not a registered filter, so no caller can drop or widen it.
  IF p_module = 'sales' THEN
    v_where_clause := array_append(v_where_clause, 'base.status = ''Closed''');
  END IF;

  -- Dimensions
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

  -- Measures
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
    v_select_clause := array_append(v_select_clause, 'COUNT(DISTINCT base.id) AS "order_count"');
  END IF;

  -- Filters
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

  -- Joins
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

COMMENT ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer) IS
  'Generic report executor. Modules: order, sales, expense. The sales module reuses '
  'the order registry (dimensions/measures/filters/joins) and adds a non-negotiable '
  'status = ''Closed'' predicate — Closed is set automatically when an order is fully '
  'dispatched. Must remain SECURITY INVOKER so RLS applies.';

REVOKE ALL ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer) TO authenticated;

-- 3. Sales-specific date basis: a sale is dated by dispatch COMPLETION.
--
-- The completion date of a fully dispatched order is its latest dispatch date —
-- by definition the shipment that emptied the last outstanding line and tripped
-- the auto-close. Orders that reached 'Closed' with no dispatch rows at all fall
-- back to the order date, so a manual close still appears somewhere sane instead
-- of vanishing on a NULL comparison.
--
-- These three rows are the ONLY registry entries for 'sales'. Every other
-- dimension, measure, filter and join resolves to the 'order' row.
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('sales', 'sales_date',
 'LEFT JOIN (SELECT order_id, MAX(dispatched_at) AS completed_at FROM order_dispatches GROUP BY order_id) sd ON base.id = sd.order_id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('sales', 'date', 'Sale Date',
 'TO_CHAR(COALESCE(sd.completed_at, base.date), ''FMMonth YYYY'')',
 '["sales_date"]')
ON CONFLICT (module_name, key) DO UPDATE SET sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('sales', 'date_range', 'Sale Date Range',
 'COALESCE(sd.completed_at, base.date) >= ($2::jsonb->''date_range''->>''start_date'')::date AND COALESCE(sd.completed_at, base.date) <= ($2::jsonb->''date_range''->>''end_date'')::date',
 '["sales_date"]')
ON CONFLICT (module_name, key) DO UPDATE SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;
