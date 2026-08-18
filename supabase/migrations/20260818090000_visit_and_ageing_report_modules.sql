-- Visit and Ageing reports on the generic report engine.
--
-- ── VISIT ────────────────────────────────────────────────────────────────────
-- Base table `site_visits`. A visit is polymorphic: `target_type` says whether
-- `target_id` points at a contact or a lead (migration 066 backfilled the older
-- `contact_id` rows). Like quotations and deals, the Customer and Lead
-- dimensions INNER JOIN their own entity (aliases `cq` / `lq`) so each tab lists
-- only its own visits, while geography LEFT JOINs both sides and COALESCEs.
-- Rows written before 066 can still have a NULL target_type, so the customer
-- side matches on `target_type IS DISTINCT FROM 'Lead'` and falls back to
-- `contact_id` rather than testing for 'Customer' equality.
--
-- Productive visit = a visit that produced an order. `orders.site_visit_id`
-- already records that link (15 of 26 prod orders carry it), so productivity is
-- read from a pre-aggregated subquery on orders rather than inferred. Founder
-- decision, 2026-08-18.
--
-- Feedback is a STATUS PIVOT (§5c), not a grouping: every tab carries one column
-- per feedback type. The mobile app offers a fixed list — Excellent / Good /
-- Average / Poor (app/visit/[id].tsx, FEEDBACK_OPTIONS) — and a visit can be
-- closed without any, so a fifth `No Feedback` column keeps the five columns
-- reconciling exactly against `# visit`. If FEEDBACK_OPTIONS ever becomes
-- account-configurable, these five measures are what has to change with it.
--
-- `# customer visit` + `# lead visit` = `# visit`. They count VISITS by who was
-- visited, not distinct people; `# unique customer` is registered separately for
-- the distinct-people question.
--
-- Visits are dated by check_in_at.
--
-- ── AGEING ───────────────────────────────────────────────────────────────────
-- Ageing is an ABSENCE report and therefore inverts the engine's usual shape:
-- every other module aggregates rows that exist, ageing lists master records for
-- which no order row exists in the window. So its base table is the master being
-- listed — `contacts` for Customer/Area, `products` for Product/Category/
-- Sub-Category — and the period lands inside a NOT EXISTS instead of
-- constraining the base.
--
-- That is why there are two modules for one report. Tabs cannot change the base
-- table, so the Ageing report's product tabs carry `moduleOverride:
-- 'ageing_product'` and the viewer executes against that module instead.
--
-- The `last_order` join is a pre-aggregated LEFT JOIN over ALL orders (no date
-- bound) — deliberately unbounded, because "when did they last order" is a
-- lifetime question even when the dormancy window is one month. It supplies
-- Last Order Date, Days Since Last Order and # lifetime order, which is what
-- makes the list actionable rather than a bare list of names.
--
-- Both subqueries and the NOT EXISTS run under the caller's RLS (the RPC is
-- SECURITY INVOKER), so tenant isolation and area visibility apply inside them.

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
  ELSIF p_module = 'visit' THEN
    v_base_table := 'site_visits';
    v_registry_modules := ARRAY['visit'];
  -- Ageing is an ABSENCE report: its base table is the master it lists, never
  -- orders, because a row exists to be listed precisely when no order exists.
  -- Customers and products need different masters, hence two modules; the one
  -- Ageing report switches between them per tab (TabConfig.moduleOverride).
  ELSIF p_module = 'ageing' THEN
    v_base_table := 'contacts';
    v_registry_modules := ARRAY['ageing'];
  ELSIF p_module = 'ageing_product' THEN
    v_base_table := 'products';
    v_registry_modules := ARRAY['ageing_product'];
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

-- ════════════════════════════ VISIT ════════════════════════════
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('visit', 'contacts',
 'LEFT JOIN contacts c ON base.target_type IS DISTINCT FROM ''Lead'' AND c.id = COALESCE(base.target_id, base.contact_id)'),
('visit', 'leads_all',
 'LEFT JOIN leads l ON base.target_type = ''Lead'' AND l.id = base.target_id'),
-- INNER, so the Customer tab lists only customer visits and the Lead tab only
-- lead visits, instead of collapsing the other side into one blank row.
('visit', 'customer',
 'JOIN contacts cq ON base.target_type IS DISTINCT FROM ''Lead'' AND cq.id = COALESCE(base.target_id, base.contact_id)'),
('visit', 'lead',
 'JOIN leads lq ON base.target_type = ''Lead'' AND lq.id = base.target_id'),
('visit', 'users',     'LEFT JOIN profiles u ON base.user_id = u.user_id'),
('visit', 'territory', 'LEFT JOIN territories t ON COALESCE(c.territory_id, l.territory_id) = t.id'),
-- Productivity. Pre-aggregated so a visit that produced three orders is still
-- one productive visit and cannot fan the visit count out.
('visit', 'visit_orders',
 'LEFT JOIN (SELECT site_visit_id, COUNT(*) AS order_count, SUM(COALESCE(total_amount, 0)) AS order_amount FROM orders WHERE site_visit_id IS NOT NULL GROUP BY site_visit_id) vo ON vo.site_visit_id = base.id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('visit', 'customer',  'Customer', 'COALESCE(cq.company, cq.name)', '["customer"]'),
('visit', 'lead',      'Lead',     'COALESCE(lq.company, lq.name)', '["lead"]'),
('visit', 'user',      'User',     'COALESCE(u.full_name, u.email, ''Unassigned'')', '["users"]'),
-- Contacts carry a free-text area; leads do not, so fall back territory -> city.
('visit', 'area',      'Area',     'COALESCE(NULLIF(c.area, ''''), NULLIF(t.name, ''''), NULLIF(l.city, ''''), ''-'')', '["contacts","leads_all","territory"]'),
('visit', 'city',      'City',     'COALESCE(NULLIF(c.city, ''''), NULLIF(l.city, ''''), ''-'')', '["contacts","leads_all"]'),
('visit', 'state',     'State',    'COALESCE(NULLIF(c.state, ''''), NULLIF(l.state, ''''), ''-'')', '["contacts","leads_all"]'),
('visit', 'country',   'Country',  'COALESCE(NULLIF(c.country, ''''), NULLIF(l.country, ''''), ''India'')', '["contacts","leads_all"]'),
('visit', 'date',      'Period',   'TO_CHAR(base.check_in_at, ''FMMonth YYYY'')', '[]'),
('visit', 'feedback',  'Feedback', 'COALESCE(NULLIF(base.feedback_type, ''''), ''No Feedback'')', '[]'),
('visit', 'visit_for', 'Visited',  'COALESCE(base.target_type, ''Customer'')', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('visit', 'visit_count', '# visit', 'COUNT(DISTINCT base.id)', 'number', '[]'),
('visit', 'productive_visit_count', '# productive visit',
 'COUNT(DISTINCT base.id) FILTER (WHERE COALESCE(vo.order_count, 0) > 0)', 'number', '["visit_orders"]'),
('visit', 'customer_visit_count', '# customer visit',
 'COUNT(DISTINCT base.id) FILTER (WHERE COALESCE(base.target_type, ''Customer'') <> ''Lead'')', 'number', '[]'),
('visit', 'lead_visit_count', '# lead visit',
 'COUNT(DISTINCT base.id) FILTER (WHERE base.target_type = ''Lead'')', 'number', '[]'),
-- Feedback pivot. These five are mutually exclusive and sum to # visit.
('visit', 'feedback_excellent', 'Excellent',   'COUNT(DISTINCT base.id) FILTER (WHERE base.feedback_type = ''Excellent'')', 'number', '[]'),
('visit', 'feedback_good',      'Good',        'COUNT(DISTINCT base.id) FILTER (WHERE base.feedback_type = ''Good'')',      'number', '[]'),
('visit', 'feedback_average',   'Average',     'COUNT(DISTINCT base.id) FILTER (WHERE base.feedback_type = ''Average'')',   'number', '[]'),
('visit', 'feedback_poor',      'Poor',        'COUNT(DISTINCT base.id) FILTER (WHERE base.feedback_type = ''Poor'')',      'number', '[]'),
('visit', 'feedback_none',      'No Feedback', 'COUNT(DISTINCT base.id) FILTER (WHERE NULLIF(base.feedback_type, '''') IS NULL)', 'number', '[]'),
-- Distinct people visited, as opposed to number of visits.
('visit', 'unique_customer_count', '# unique customer',
 'COUNT(DISTINCT CASE WHEN COALESCE(base.target_type, ''Customer'') <> ''Lead'' THEN COALESCE(base.target_id, base.contact_id) END)', 'number', '[]'),
('visit', 'unique_lead_count', '# unique lead',
 'COUNT(DISTINCT CASE WHEN base.target_type = ''Lead'' THEN base.target_id END)', 'number', '[]'),
('visit', 'order_amount', 'Order Amount', 'SUM(COALESCE(vo.order_amount, 0))', 'currency', '["visit_orders"]'),
-- Computed per group, never summed (§5e) — hence type percent.
('visit', 'productivity_ratio', 'Productivity %',
 'ROUND(100.0 * COUNT(DISTINCT base.id) FILTER (WHERE COALESCE(vo.order_count, 0) > 0) / NULLIF(COUNT(DISTINCT base.id), 0), 1)', 'percent', '["visit_orders"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('visit', 'date_range', 'Period',
 'base.check_in_at::date >= ($2::jsonb->''date_range''->>''start_date'')::date AND base.check_in_at::date <= ($2::jsonb->''date_range''->>''end_date'')::date', '[]'),
('visit', 'feedback_type', 'Feedback', 'base.feedback_type = ($2::jsonb->>''feedback_type'')', '[]'),
('visit', 'visit_for',     'Visited',  'COALESCE(base.target_type, ''Customer'') = ($2::jsonb->>''visit_for'')', '[]'),
('visit', 'productive',    'Productive',
 'CASE WHEN ($2::jsonb->>''productive'') = ''yes'' THEN COALESCE(vo.order_count, 0) > 0 ELSE COALESCE(vo.order_count, 0) = 0 END', '["visit_orders"]'),
('visit', 'customer', 'Customer',
 'COALESCE(base.target_id, base.contact_id) = ($2::jsonb->''customer''->>''contact_id'')::uuid', '[]'),
('visit', 'lead', 'Lead',
 'base.target_type = ''Lead'' AND base.target_id = ($2::jsonb->>''lead'')::uuid', '[]'),
('visit', 'user', 'User',
 -- Compared as TEXT, never cast to uuid: ($2->>'user')::uuid raises 22P02 on
 -- the object payload shape rather than simply failing to match.
 'base.user_id IN (SELECT p.user_id FROM profiles p WHERE p.user_id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'') OR p.id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user''))', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'visit', 'territory_' || lvl, 'Territory Level ' || lvl,
       'COALESCE(c.territory_id, l.territory_id) IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t)',
       '["contacts","leads_all"]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;


-- ══════════════════ AGEING — CUSTOMER / AREA (base: contacts) ══════════════════
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
-- Deliberately UNBOUNDED by date: the dormancy window comes from the NOT EXISTS
-- in date_range, while "when did they last order" is a lifetime question.
('ageing', 'last_order',
 'LEFT JOIN (SELECT contact_id, MAX(date) AS last_order_date, COUNT(*) AS order_count FROM orders WHERE contact_id IS NOT NULL GROUP BY contact_id) lo ON lo.contact_id = base.id'),
('ageing', 'territory', 'LEFT JOIN territories t ON base.territory_id = t.id'),
('ageing', 'users',     'LEFT JOIN profiles u ON base.user_id = u.user_id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('ageing', 'customer', 'Customer', 'COALESCE(base.company, base.name)', '[]'),
('ageing', 'area',     'Area',     'COALESCE(NULLIF(base.area, ''''), NULLIF(t.name, ''''), NULLIF(base.city, ''''), ''-'')', '["territory"]'),
('ageing', 'city',     'City',     'COALESCE(NULLIF(base.city, ''''), ''-'')', '[]'),
('ageing', 'state',    'State',    'COALESCE(NULLIF(base.state, ''''), ''-'')', '[]'),
('ageing', 'country',  'Country',  'COALESCE(NULLIF(base.country, ''''), ''India'')', '[]'),
('ageing', 'user',     'User',     'COALESCE(u.full_name, u.email, ''Unassigned'')', '["users"]'),
('ageing', 'customer_type', 'Customer Type', 'COALESCE(base.hierarchy_level::text, ''-'')', '[]'),
-- A row-level attribute of the customer, not an aggregate — carried as an extra
-- dimension on the Customer tab where there is exactly one row per customer.
('ageing', 'last_order_date', 'Last Order Date',
 'COALESCE(TO_CHAR(lo.last_order_date, ''DD Mon YYYY''), ''Never'')', '["last_order"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('ageing', 'customer_count', '# customer', 'COUNT(DISTINCT base.id)', 'number', '[]'),
('ageing', 'never_ordered_count', '# never ordered',
 'COUNT(DISTINCT base.id) FILTER (WHERE lo.last_order_date IS NULL)', 'number', '["last_order"]'),
-- MIN, so an Area row reads "this area last saw an order N days ago". On the
-- Customer tab there is one order history per row, so MIN is that exact figure.
('ageing', 'days_since_last_order', 'Days Since Last Order',
 'MIN(CURRENT_DATE - lo.last_order_date)', 'number', '["last_order"]'),
('ageing', 'lifetime_order_count', '# lifetime order',
 'SUM(COALESCE(lo.order_count, 0))', 'number', '["last_order"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
-- The whole report. "Period" here means "had NO order in this window", so the
-- dates go inside the NOT EXISTS rather than constraining the base table.
('ageing', 'date_range', 'Period',
 'NOT EXISTS (SELECT 1 FROM orders o WHERE o.contact_id = base.id AND o.date >= ($2::jsonb->''date_range''->>''start_date'')::date AND o.date <= ($2::jsonb->''date_range''->>''end_date'')::date)', '[]'),
-- hierarchy_level is an INTEGER; compare as text so the '-' fallback works.
('ageing', 'customer_type', 'Customer Type', 'base.hierarchy_level::text = ($2::jsonb->>''customer_type'')', '[]'),
('ageing', 'customer', 'Customer',
 'base.id = ($2::jsonb->''customer''->>''contact_id'')::uuid', '[]'),
('ageing', 'user', 'User',
 -- Compared as TEXT, never cast to uuid: ($2->>'user')::uuid raises 22P02 on
 -- the object payload shape rather than simply failing to match.
 'base.user_id IN (SELECT p.user_id FROM profiles p WHERE p.user_id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'') OR p.id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user''))', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'ageing', 'territory_' || lvl, 'Territory Level ' || lvl,
       'base.territory_id IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t)',
       '[]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;


-- ═══════════ AGEING — PRODUCT / CATEGORY / SUB-CATEGORY (base: products) ═══════════
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('ageing_product', 'last_order',
 'LEFT JOIN (SELECT oi.product_id, MAX(o.date) AS last_order_date, COUNT(DISTINCT o.id) AS order_count FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id IS NOT NULL GROUP BY oi.product_id) lo ON lo.product_id = base.id'),
-- Proper category hierarchy (pc = the product's own node, pcp = its parent), as
-- used by deals and quotations. The legacy free-text products.category is only a
-- fallback for rows that predate the hierarchy.
('ageing_product', 'categories',
 'LEFT JOIN product_categories pc ON base.category_id = pc.id LEFT JOIN product_categories pcp ON pc.parent_id = pcp.id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('ageing_product', 'product', 'Product', 'COALESCE(base.name, ''Unknown Product'')', '[]'),
('ageing_product', 'product_category', 'Product Category',
 'COALESCE(pcp.name, pc.name, base.category, ''Uncategorized'')', '["categories"]'),
('ageing_product', 'product_subcategory', 'Product Sub-Category',
 'CASE WHEN pc.parent_id IS NOT NULL THEN pc.name ELSE ''-'' END', '["categories"]'),
('ageing_product', 'last_order_date', 'Last Order Date',
 'COALESCE(TO_CHAR(lo.last_order_date, ''DD Mon YYYY''), ''Never'')', '["last_order"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('ageing_product', 'product_count', '# product', 'COUNT(DISTINCT base.id)', 'number', '[]'),
('ageing_product', 'never_ordered_count', '# never ordered',
 'COUNT(DISTINCT base.id) FILTER (WHERE lo.last_order_date IS NULL)', 'number', '["last_order"]'),
('ageing_product', 'days_since_last_order', 'Days Since Last Order',
 'MIN(CURRENT_DATE - lo.last_order_date)', 'number', '["last_order"]'),
('ageing_product', 'lifetime_order_count', '# lifetime order',
 'SUM(COALESCE(lo.order_count, 0))', 'number', '["last_order"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('ageing_product', 'date_range', 'Period',
 'NOT EXISTS (SELECT 1 FROM order_items oi2 JOIN orders o2 ON o2.id = oi2.order_id WHERE oi2.product_id = base.id AND o2.date >= ($2::jsonb->''date_range''->>''start_date'')::date AND o2.date <= ($2::jsonb->''date_range''->>''end_date'')::date)', '[]'),
-- Discontinued products would otherwise pad every dormancy list. Off by default;
-- the founder picks Active when they want the list to be actionable.
('ageing_product', 'product_status', 'Product Status',
 'base.active = (($2::jsonb->>''product_status'') = ''active'')', '[]'),
('ageing_product', 'product', 'Product', 'base.id = ($2::jsonb->>''product'')::uuid', '[]'),
('ageing_product', 'product_category', 'Category',
 'COALESCE(pcp.name, pc.name, base.category) = ($2::jsonb->>''product_category'')', '["categories"]'),
('ageing_product', 'product_subcategory', 'Sub-Category',
 'pc.name = ($2::jsonb->>''product_subcategory'') AND pc.parent_id IS NOT NULL', '["categories"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;
