-- Quotation Report on the generic report engine.
--
-- Three things make quotations different from every module registered so far:
--
-- 1. VERSIONS. A revised quotation keeps the old row with is_latest_version =
--    false (58 rows on prod today, 8 of them superseded). Counting every version
--    would inflate "# of quotation" by the number of revisions, so the module
--    hard-wires `base.is_latest_version = true` in the RPC — the same
--    non-negotiable-predicate approach `sales` uses for status = 'Closed'.
--    A quotation revised twice counts once, at its current values.
--
-- 2. LEAD **OR** CUSTOMER. quotations carry both contact_id and lead_id and use
--    exactly one. The Lead and Customer dimensions therefore INNER JOIN their own
--    entity (aliases lq / cq) so each tab lists only the quotations that actually
--    belong to it — grouping a nullable column would instead collapse every
--    customer quotation into a single blank "lead" row. Area/state/city/territory
--    keep LEFT JOINs (aliases c / l) and COALESCE across both, so a lead quotation
--    still lands in the right geography.
--
-- 3. ITEM-LEVEL vs QUOTATION-LEVEL MEASURES. Grouping by product forces a join to
--    quotation_items, which duplicates any quotation-level SUM once per line item
--    (docs/report-engine.md §5 fan-out). The product/category/sub-category tabs
--    therefore use item_* measures reading straight from the item rows, while the
--    lead/customer/user/area/period tabs use quotation-level rollups via the
--    pre-aggregated qsum subquery. Both sets carry the SAME labels so the columns
--    read identically to the user; only the arithmetic differs.

-- ── Base table + latest-version gate ─────────────────────────────────────────
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

  -- Superseded revisions never count as separate quotations.
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
  'Generic report executor. Modules: order, sales, payment, quotation, expense. Non-negotiable predicates: sales => status = ''Closed''; quotation => latest version only. Must remain SECURITY INVOKER so RLS applies.';

-- ── Joins ────────────────────────────────────────────────────────────────────
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
-- Nullable sides, for geography that must work for both leads and customers.
('quotation', 'contacts',   'LEFT JOIN contacts c ON base.contact_id = c.id'),
('quotation', 'leads_all',  'LEFT JOIN leads l ON base.lead_id = l.id'),
-- Entity sides: INNER, so the Customer tab lists only customer quotations and the
-- Lead tab only lead quotations, instead of one blank catch-all row.
('quotation', 'customer',   'JOIN contacts cq ON base.contact_id = cq.id'),
('quotation', 'lead',       'JOIN leads lq ON base.lead_id = lq.id'),
('quotation', 'users',      'LEFT JOIN profiles u ON base.user_id = u.user_id'),
-- Item rows, for the product/category tabs.
('quotation', 'items',      'LEFT JOIN quotation_items i ON base.id = i.quotation_id'),
('quotation', 'products',   'LEFT JOIN products p ON i.product_id = p.id'),
('quotation', 'categories', 'LEFT JOIN product_categories pc ON p.category_id = pc.id LEFT JOIN product_categories pcp ON pc.parent_id = pcp.id'),
-- Pre-aggregated per quotation, so quotation-level counts never fan out.
('quotation', 'item_summary',
 'LEFT JOIN (SELECT quotation_id, SUM(quantity) AS product_quantity, COUNT(DISTINCT product_id) AS product_count FROM quotation_items GROUP BY quotation_id) qsum ON base.id = qsum.quotation_id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

-- ── Dimensions ───────────────────────────────────────────────────────────────
INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('quotation', 'customer', 'Customer', 'COALESCE(cq.company, cq.name)', '["customer"]'),
('quotation', 'lead',     'Lead',     'COALESCE(lq.company, lq.name)', '["lead"]'),
('quotation', 'user',     'User',     'COALESCE(u.full_name, u.email, ''Unassigned'')', '["users"]'),
-- Geography falls back from customer to lead so lead quotations are placed too.
('quotation', 'country',  'Country',  'COALESCE(c.country, l.country, ''India'')', '["contacts","leads_all"]'),
('quotation', 'state',    'State',    'COALESCE(c.state, l.state)',                '["contacts","leads_all"]'),
('quotation', 'city',     'City',     'COALESCE(c.city, l.city)',                  '["contacts","leads_all"]'),
-- leads have no area column, so lead quotations land in '-'.
('quotation', 'area',     'Area',     'COALESCE(c.area, ''-'')',                   '["contacts"]'),
('quotation', 'date',     'Period',   'TO_CHAR(base.date, ''FMMonth YYYY'')',      '[]'),
('quotation', 'status',   'Status',   'base.status',                               '[]'),
('quotation', 'product',  'Product',  'COALESCE(p.name, i.product_name, ''Unknown Product'')', '["items","products"]'),
-- Real hierarchy: category_id may point at a level-1 or level-2 node. Level 2 rolls
-- up to its parent for Category; Sub-Category is only the level-2 node itself.
-- products.category (legacy free text) is the fallback while category_id is unset.
('quotation', 'product_category', 'Product Category',
 'COALESCE(pcp.name, pc.name, p.category, ''Uncategorized'')', '["items","products","categories"]'),
('quotation', 'product_subcategory', 'Product Sub-Category',
 'CASE WHEN pc.parent_id IS NOT NULL THEN pc.name ELSE ''-'' END', '["items","products","categories"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

-- ── Measures ─────────────────────────────────────────────────────────────────
-- Quotation-level (safe on lead/customer/user/area/period tabs).
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('quotation', 'quotation_count',  '# of quotation', 'COUNT(DISTINCT base.id)',                        'number',   '[]'),
('quotation', 'customer_count',   '# of customer',  'COUNT(DISTINCT base.contact_id)',                'number',   '[]'),
('quotation', 'lead_count',       '# of lead',      'COUNT(DISTINCT base.lead_id)',                   'number',   '[]'),
('quotation', 'product_count',    '# of product',   'SUM(COALESCE(qsum.product_count, 0))',           'number',   '["item_summary"]'),
('quotation', 'product_quantity', 'Quantity',       'SUM(COALESCE(qsum.product_quantity, 0))',        'number',   '["item_summary"]'),
('quotation', 'gross_amount',     'Sub Amount',     'SUM(base.sub_total)',                            'currency', '[]'),
('quotation', 'net_amount',       'Amount',         'SUM(base.total_amount)',                         'currency', '[]'),
('quotation', 'tax_amount',       'Tax Amount',     'SUM(base.tax_total)',                            'currency', '[]'),
-- Item-level twins, for tabs already joined to quotation_items. Same labels, so
-- the columns read identically; the arithmetic is per line item instead.
('quotation', 'item_product_count',    '# of product', 'COUNT(DISTINCT i.product_id)',      'number',   '["items"]'),
('quotation', 'item_product_quantity', 'Quantity',     'SUM(COALESCE(i.quantity, 0))',      'number',   '["items"]'),
('quotation', 'item_gross_amount',     'Sub Amount',   'SUM(COALESCE(i.sub_total, 0))',     'currency', '["items"]'),
('quotation', 'item_net_amount',       'Amount',       'SUM(COALESCE(i.total, 0))',         'currency', '["items"]'),
('quotation', 'avg_price',             'Avg Price',    'ROUND(AVG(i.price)::numeric, 2)',   'currency', '["items"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

-- ── Filters ──────────────────────────────────────────────────────────────────
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('quotation', 'date_range', 'Period', 'base.date >= ($2::jsonb->''date_range''->>''start_date'')::date AND base.date <= ($2::jsonb->''date_range''->>''end_date'')::date', '[]'),
('quotation', 'status',     'Status',   'base.status = ($2::jsonb->>''status'')', '[]'),
('quotation', 'customer',   'Customer', 'base.contact_id = ($2::jsonb->''customer''->>''contact_id'')::uuid', '[]'),
('quotation', 'lead',       'Lead',     'base.lead_id = ($2::jsonb->>''lead'')::uuid', '[]'),
-- Which side of the book: quotations raised against leads vs existing customers.
('quotation', 'party_type', 'Raised For',
 '((($2::jsonb->>''party_type'') = ''lead'' AND base.lead_id IS NOT NULL) OR (($2::jsonb->>''party_type'') = ''customer'' AND base.contact_id IS NOT NULL))', '[]'),
('quotation', 'user',       'User', 'base.user_id IN (SELECT user_id FROM profiles WHERE user_id = ($2::jsonb->''user''->>''user_id'')::uuid OR id = ($2::jsonb->''user''->>''user_id'')::uuid OR user_id = ($2::jsonb->>''user'')::uuid OR id = ($2::jsonb->>''user'')::uuid)', '[]'),
('quotation', 'product',    'Product', 'i.product_id = ($2::jsonb->>''product'')::uuid', '["items"]'),
('quotation', 'product_category', 'Category',
 'COALESCE(pcp.name, pc.name, p.category) = ($2::jsonb->>''product_category'')', '["items","products","categories"]'),
('quotation', 'product_subcategory', 'Sub-Category',
 'pc.name = ($2::jsonb->>''product_subcategory'') AND pc.parent_id IS NOT NULL', '["items","products","categories"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

-- Territory: match on whichever party the quotation belongs to.
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'quotation',
       'territory_' || lvl,
       'Territory Level ' || lvl,
       'COALESCE(c.territory_id, l.territory_id) IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t)',
       '["contacts","leads_all"]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;
