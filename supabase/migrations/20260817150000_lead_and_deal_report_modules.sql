-- Lead and Deal reports on the generic report engine.
--
-- Notes on the data these two sit on:
--
-- * Neither `leads` nor `deals` has a `date` column — both are dated by
--   created_at, cast to date for range filters.
-- * Leads have no `area` column (contacts do). The Area dimension falls back
--   territory name -> city -> '-', so the tab is useful before territories are
--   assigned. Deals fall back the customer's area -> the lead's city -> '-'.
-- * A deal belongs to a LEAD or a CUSTOMER (deal_for says which). Same treatment
--   as quotations: the Lead/Customer dimensions INNER JOIN their own entity so
--   each tab lists only its own deals, while geography LEFT JOINs both.
-- * `deals.value` is the authoritative deal amount and equals the sum of its item
--   totals whenever items exist (verified on prod), so Amount reads `value` at
--   record level and `SUM(i.total)` at item level. Sub Amount has no header
--   column, so it always comes from the items.
-- * Pipeline stage names repeat across pipelines (109 stages over 23 pipelines),
--   so the Stage dimension is qualified as "Pipeline / Stage". Grouping on the
--   bare stage name would silently merge unrelated stages.

-- ── Base tables ──────────────────────────────────────────────────────────────
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
  ELSIF p_module = 'quotation' THEN
    v_base_table := 'quotations';
    v_registry_modules := ARRAY['quotation'];
  ELSIF p_module = 'lead' THEN
    v_base_table := 'leads';
    v_registry_modules := ARRAY['lead'];
  ELSIF p_module = 'deal' THEN
    v_base_table := 'deals';
    v_registry_modules := ARRAY['deal'];
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

  IF p_module = 'quotation' THEN
    v_where_clause := array_append(v_where_clause, 'COALESCE(base.is_latest_version, true) = true');
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

COMMENT ON FUNCTION public.execute_report(uuid, text, text[], text[], jsonb, text, text, integer, integer) IS
  'Generic report executor. Modules: order, sales, payment, quotation, lead, deal, expense. Non-negotiable predicates: sales => status = Closed; quotation => latest version only. Must remain SECURITY INVOKER so RLS applies.';

-- ════════════════════════════ LEAD ════════════════════════════
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('lead', 'users',     'LEFT JOIN profiles u ON base.user_id = u.user_id'),
('lead', 'territory', 'LEFT JOIN territories t ON base.territory_id = t.id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('lead', 'source',   'Lead Source', 'COALESCE(base.source, ''Unknown'')',   '[]'),
('lead', 'status',   'Lead Status', 'COALESCE(base.status, ''Unknown'')',   '[]'),
('lead', 'industry', 'Industry',    'COALESCE(base.industry, ''Unknown'')', '[]'),
('lead', 'user',     'User',        'COALESCE(u.full_name, u.email, ''Unassigned'')', '["users"]'),
-- leads have no area column; territory is the nearest equivalent, city the fallback.
('lead', 'area',     'Area',        'COALESCE(t.name, base.city, ''-'')',   '["territory"]'),
('lead', 'date',     'Period',      'TO_CHAR(base.created_at, ''FMMonth YYYY'')', '[]'),
('lead', 'city',     'City',        'COALESCE(base.city, ''-'')',           '[]'),
('lead', 'state',    'State',       'COALESCE(base.state, ''-'')',          '[]'),
('lead', 'country',  'Country',     'COALESCE(base.country, ''India'')',    '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('lead', 'lead_count',       '# lead',           'COUNT(DISTINCT base.id)', 'number', '[]'),
('lead', 'converted_count',  '# converted lead', 'COUNT(DISTINCT base.id) FILTER (WHERE base.is_converted)', 'number', '[]'),
-- Ratio is computed in SQL per group, so it is correct on every row. It is NOT
-- summable: the table footer shows a dash for percent columns and the true
-- overall ratio comes from the KPI card, which is its own grand-total query.
('lead', 'conversion_ratio', '# ratio',
 'ROUND(100.0 * COUNT(DISTINCT base.id) FILTER (WHERE base.is_converted) / NULLIF(COUNT(DISTINCT base.id), 0), 2)',
 'percent', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('lead', 'date_range', 'Period',   'base.created_at::date >= ($2::jsonb->''date_range''->>''start_date'')::date AND base.created_at::date <= ($2::jsonb->''date_range''->>''end_date'')::date', '[]'),
('lead', 'status',     'Status',   'base.status = ($2::jsonb->>''status'')',     '[]'),
('lead', 'source',     'Source',   'base.source = ($2::jsonb->>''source'')',     '[]'),
('lead', 'industry',   'Industry', 'base.industry = ($2::jsonb->>''industry'')', '[]'),
('lead', 'user',       'User',     'base.user_id IN (SELECT user_id FROM profiles WHERE user_id = ($2::jsonb->''user''->>''user_id'')::uuid OR id = ($2::jsonb->''user''->>''user_id'')::uuid OR user_id = ($2::jsonb->>''user'')::uuid OR id = ($2::jsonb->>''user'')::uuid)', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'lead', 'territory_' || lvl, 'Territory Level ' || lvl,
       'base.territory_id IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t)',
       '[]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

-- ════════════════════════════ DEAL ════════════════════════════
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('deal', 'contacts',   'LEFT JOIN contacts c ON base.contact_id = c.id'),
('deal', 'leads_all',  'LEFT JOIN leads l ON base.lead_id = l.id'),
('deal', 'customer',   'JOIN contacts cq ON base.contact_id = cq.id'),
('deal', 'lead',       'JOIN leads lq ON base.lead_id = lq.id'),
('deal', 'users',      'LEFT JOIN profiles u ON base.user_id = u.user_id'),
('deal', 'pipelines',  'LEFT JOIN pipelines pl ON base.pipeline_id = pl.id'),
('deal', 'stages',     'LEFT JOIN pipeline_stages ps ON base.stage_id = ps.id'),
('deal', 'items',      'LEFT JOIN deal_items i ON base.id = i.deal_id'),
('deal', 'products',   'LEFT JOIN products p ON i.product_id = p.id'),
('deal', 'categories', 'LEFT JOIN product_categories pc ON p.category_id = pc.id LEFT JOIN product_categories pcp ON pc.parent_id = pcp.id'),
('deal', 'item_summary',
 'LEFT JOIN (SELECT deal_id, SUM(quantity) AS product_quantity, COUNT(DISTINCT product_id) AS product_count, SUM(sub_total) AS sub_total FROM deal_items GROUP BY deal_id) dsum ON base.id = dsum.deal_id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('deal', 'lead',     'Lead',     'COALESCE(lq.company, lq.name)', '["lead"]'),
('deal', 'customer', 'Customer', 'COALESCE(cq.company, cq.name)', '["customer"]'),
('deal', 'user',     'User',     'COALESCE(u.full_name, u.email, ''Unassigned'')', '["users"]'),
('deal', 'area',     'Area',     'COALESCE(c.area, l.city, ''-'')', '["contacts","leads_all"]'),
('deal', 'date',     'Period',   'TO_CHAR(base.created_at, ''FMMonth YYYY'')', '[]'),
('deal', 'status',   'Status',   'COALESCE(base.status, ''Unknown'')', '[]'),
('deal', 'pipeline', 'Deal Pipeline', 'COALESCE(pl.name, ''Unassigned'')', '["pipelines"]'),
-- Stage names repeat across pipelines, so qualify them.
('deal', 'stage',    'Deal Pipeline Stage',
 'COALESCE(pl.name || '' / '' || ps.name, ps.name, ''Unassigned'')', '["pipelines","stages"]'),
('deal', 'product',  'Product', 'COALESCE(p.name, i.product_name, ''Unknown Product'')', '["items","products"]'),
('deal', 'product_category', 'Product Category',
 'COALESCE(pcp.name, pc.name, p.category, ''Uncategorized'')', '["items","products","categories"]'),
('deal', 'product_subcategory', 'Product Sub-Category',
 'CASE WHEN pc.parent_id IS NOT NULL THEN pc.name ELSE ''-'' END', '["items","products","categories"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('deal', 'deal_count',       '# deal',      'COUNT(DISTINCT base.id)',                 'number',   '[]'),
('deal', 'customer_count',   '# customer',  'COUNT(DISTINCT base.contact_id)',         'number',   '[]'),
('deal', 'lead_count',       '# lead',      'COUNT(DISTINCT base.lead_id)',            'number',   '[]'),
('deal', 'product_count',    '# product',   'SUM(COALESCE(dsum.product_count, 0))',    'number',   '["item_summary"]'),
('deal', 'product_quantity', 'Quantity',    'SUM(COALESCE(dsum.product_quantity, 0))', 'number',   '["item_summary"]'),
('deal', 'gross_amount',     'Sub Amount',  'SUM(COALESCE(dsum.sub_total, 0))',        'currency', '["item_summary"]'),
-- deals.value is the header amount and matches the item total when items exist.
('deal', 'net_amount',       'Amount',      'SUM(COALESCE(base.value, 0))',            'currency', '[]'),
('deal', 'item_product_count',    '# product',  'COUNT(DISTINCT i.product_id)',    'number',   '["items"]'),
('deal', 'item_product_quantity', 'Quantity',   'SUM(COALESCE(i.quantity, 0))',    'number',   '["items"]'),
('deal', 'item_gross_amount',     'Sub Amount', 'SUM(COALESCE(i.sub_total, 0))',   'currency', '["items"]'),
('deal', 'item_net_amount',       'Amount',     'SUM(COALESCE(i.total, 0))',       'currency', '["items"]'),
('deal', 'avg_price',             'Avg Price',  'ROUND(AVG(i.price)::numeric, 2)', 'currency', '["items"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('deal', 'date_range', 'Period', 'base.created_at::date >= ($2::jsonb->''date_range''->>''start_date'')::date AND base.created_at::date <= ($2::jsonb->''date_range''->>''end_date'')::date', '[]'),
('deal', 'status',     'Status',   'base.status = ($2::jsonb->>''status'')', '[]'),
('deal', 'party_type', 'Raised For', 'base.deal_for = ($2::jsonb->>''party_type'')', '[]'),
('deal', 'pipeline',   'Pipeline', 'base.pipeline_id = ($2::jsonb->>''pipeline'')::uuid', '[]'),
('deal', 'stage',      'Stage',    'base.stage_id = ($2::jsonb->>''stage'')::uuid', '[]'),
('deal', 'customer',   'Customer', 'base.contact_id = ($2::jsonb->''customer''->>''contact_id'')::uuid', '[]'),
('deal', 'lead',       'Lead',     'base.lead_id = ($2::jsonb->>''lead'')::uuid', '[]'),
('deal', 'user',       'User',     'base.user_id IN (SELECT user_id FROM profiles WHERE user_id = ($2::jsonb->''user''->>''user_id'')::uuid OR id = ($2::jsonb->''user''->>''user_id'')::uuid OR user_id = ($2::jsonb->>''user'')::uuid OR id = ($2::jsonb->>''user'')::uuid)', '[]'),
('deal', 'product',    'Product',  'i.product_id = ($2::jsonb->>''product'')::uuid', '["items"]'),
('deal', 'product_category', 'Category',
 'COALESCE(pcp.name, pc.name, p.category) = ($2::jsonb->>''product_category'')', '["items","products","categories"]'),
('deal', 'product_subcategory', 'Sub-Category',
 'pc.name = ($2::jsonb->>''product_subcategory'') AND pc.parent_id IS NOT NULL', '["items","products","categories"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'deal', 'territory_' || lvl, 'Territory Level ' || lvl,
       'COALESCE(c.territory_id, l.territory_id) IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t)',
       '["contacts","leads_all"]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;
