-- 1. Sharing Enum
CREATE TYPE report_sharing_mode AS ENUM ('private', 'team', 'organization');

-- 2. Saved Reports Table
CREATE TABLE saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  sharing_mode report_sharing_mode DEFAULT 'private',
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_saved_reports_account_user ON saved_reports(account_id, user_id);

ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own private reports" 
ON saved_reports FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view org reports" 
ON saved_reports FOR SELECT 
USING (
  account_id IN (
    SELECT account_id FROM profiles WHERE user_id = auth.uid()
  ) 
  AND sharing_mode = 'organization'
);

CREATE POLICY "Users can manage own reports" 
ON saved_reports FOR ALL
USING (auth.uid() = user_id);


-- 3. Report Engine Registries
CREATE TABLE report_registry_dimensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  sql_select TEXT NOT NULL,
  required_joins JSONB DEFAULT '[]'::jsonb,
  UNIQUE (module_name, key)
);

CREATE TABLE report_registry_measures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  sql_select TEXT NOT NULL,
  type TEXT DEFAULT 'currency', 
  required_joins JSONB DEFAULT '[]'::jsonb,
  UNIQUE (module_name, key)
);

CREATE TABLE report_registry_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  sql_where TEXT NOT NULL, -- e.g. "base.date >= ($1::jsonb->>'start_date')::date"
  required_joins JSONB DEFAULT '[]'::jsonb,
  UNIQUE (module_name, key)
);

CREATE TABLE report_registry_joins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL,
  join_key TEXT NOT NULL,
  sql_join TEXT NOT NULL,
  UNIQUE (module_name, join_key)
);

ALTER TABLE report_registry_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_registry_measures ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_registry_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_registry_joins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read dimensions" ON report_registry_dimensions FOR SELECT USING (true);
CREATE POLICY "Anyone can read measures" ON report_registry_measures FOR SELECT USING (true);
CREATE POLICY "Anyone can read filters" ON report_registry_filters FOR SELECT USING (true);
CREATE POLICY "Anyone can read joins" ON report_registry_joins FOR SELECT USING (true);

-- 4. Seed Order Module Registry
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('order', 'contacts', 'LEFT JOIN contacts c ON base.contact_id = c.id'),
('order', 'users', 'LEFT JOIN profiles u ON base.user_id = u.id'),
('order', 'order_items', 'LEFT JOIN order_items i ON base.id = i.order_id'),
('order', 'products', 'LEFT JOIN products p ON i.product_id = p.id');

INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('order', 'date', 'Date', 'base.date', '[]'),
('order', 'customer', 'Customer', 'c.company_name', '["contacts"]'),
('order', 'customer_type', 'Customer Type', 'c.customer_type', '["contacts"]'),
('order', 'city', 'City', 'c.city', '["contacts"]'),
('order', 'state', 'State', 'c.state', '["contacts"]'),
('order', 'user', 'User', 'u.full_name', '["users"]'),
('order', 'product', 'Product', 'p.name', '["order_items", "products"]'),
('order', 'product_category', 'Product Category', 'p.category_id', '["order_items", "products"]');

INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('order', 'gross_amount', 'Gross Amount', 'SUM(base.sub_total)', 'currency', '[]'),
('order', 'net_amount', 'Net Amount', 'SUM(base.total_amount)', 'currency', '[]'),
('order', 'discount_amount', 'Discount Amount', 'SUM(base.discount_total)', 'currency', '[]'),
('order', 'tax_amount', 'Tax Amount', 'SUM(base.tax_total)', 'currency', '[]'),
('order', 'order_count', 'Total Orders', 'COUNT(DISTINCT base.id)', 'number', '[]'),
('order', 'product_quantity', 'Total Quantity', 'SUM(i.quantity)', 'number', '["order_items"]');

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('order', 'status', 'Status', 'base.status = ($1::jsonb->>''status'')', '[]'),
('order', 'date_range', 'Date Range', 'base.date >= ($1::jsonb->>''start_date'')::date AND base.date <= ($1::jsonb->>''end_date'')::date', '[]'),
('order', 'customer', 'Customer', 'base.contact_id = ($1::jsonb->>''contact_id'')::uuid', '[]');

-- 5. The Execute Report RPC
CREATE OR REPLACE FUNCTION execute_dynamic_report(
  p_account_id UUID,
  p_module TEXT,
  p_dimensions TEXT[],
  p_measures TEXT[],
  p_filters JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER -- MUST BE INVOKER to respect RLS!
AS $$
DECLARE
  v_base_table TEXT;
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
  v_join_rec RECORD;
  v_req_join TEXT;
  v_filter_key TEXT;
BEGIN
  -- 1. Determine base table
  IF p_module = 'order' THEN
    v_base_table := 'orders';
  ELSIF p_module = 'expense' THEN
    v_base_table := 'expenses';
  ELSE
    RAISE EXCEPTION 'Unsupported module: %', p_module;
  END IF;

  -- 2. Base account isolation
  v_where_clause := array_append(v_where_clause, 'base.account_id = $1');

  -- 3. Process Dimensions
  FOR i IN 1 .. COALESCE(array_length(p_dimensions, 1), 0) LOOP
    SELECT * INTO v_dim_rec FROM report_registry_dimensions WHERE module_name = p_module AND key = p_dimensions[i];
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid dimension: %', p_dimensions[i];
    END IF;
    
    v_select_clause := array_append(v_select_clause, v_dim_rec.sql_select || ' AS "' || p_dimensions[i] || '"');
    v_group_clause := array_append(v_group_clause, v_dim_rec.sql_select);
    
    FOR v_req_join IN SELECT jsonb_array_elements_text(v_dim_rec.required_joins) LOOP
      IF NOT (v_req_join = ANY(v_join_keys)) THEN
        v_join_keys := array_append(v_join_keys, v_req_join);
      END IF;
    END LOOP;
  END LOOP;

  -- 4. Process Measures
  FOR i IN 1 .. COALESCE(array_length(p_measures, 1), 0) LOOP
    SELECT * INTO v_meas_rec FROM report_registry_measures WHERE module_name = p_module AND key = p_measures[i];
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid measure: %', p_measures[i];
    END IF;
    
    v_select_clause := array_append(v_select_clause, v_meas_rec.sql_select || ' AS "' || p_measures[i] || '"');
    
    FOR v_req_join IN SELECT jsonb_array_elements_text(v_meas_rec.required_joins) LOOP
      IF NOT (v_req_join = ANY(v_join_keys)) THEN
        v_join_keys := array_append(v_join_keys, v_req_join);
      END IF;
    END LOOP;
  END LOOP;

  -- 5. Process Filters
  FOR v_filter_key IN SELECT jsonb_object_keys(p_filters) LOOP
    SELECT * INTO v_filt_rec FROM report_registry_filters WHERE module_name = p_module AND key = v_filter_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid filter: %', v_filter_key;
    END IF;

    -- The sql_where uses $2 to inject the JSON filter payload safely
    v_where_clause := array_append(v_where_clause, v_filt_rec.sql_where);

    FOR v_req_join IN SELECT jsonb_array_elements_text(v_filt_rec.required_joins) LOOP
      IF NOT (v_req_join = ANY(v_join_keys)) THEN
        v_join_keys := array_append(v_join_keys, v_req_join);
      END IF;
    END LOOP;
  END LOOP;

  -- 6. Build Joins
  FOR i IN 1 .. COALESCE(array_length(v_join_keys, 1), 0) LOOP
    SELECT sql_join INTO v_join_rec FROM report_registry_joins WHERE module_name = p_module AND join_key = v_join_keys[i];
    IF FOUND THEN
      v_joins := array_append(v_joins, v_join_rec.sql_join);
    END IF;
  END LOOP;

  -- 7. Construct Final SQL
  v_sql := 'SELECT jsonb_agg(row_to_json(res)) FROM (';
  v_sql := v_sql || ' SELECT ' || array_to_string(v_select_clause, ', ');
  v_sql := v_sql || ' FROM ' || v_base_table || ' base ';
  
  IF array_length(v_joins, 1) > 0 THEN
    v_sql := v_sql || array_to_string(v_joins, ' ');
  END IF;
  
  v_sql := v_sql || ' WHERE ' || array_to_string(v_where_clause, ' AND ');
  
  IF array_length(v_group_clause, 1) > 0 THEN
    v_sql := v_sql || ' GROUP BY ' || array_to_string(v_group_clause, ', ');
  END IF;
  
  v_sql := v_sql || ') res';

  -- 8. Execute within Security Invoker Context (RLS is active!)
  -- We pass p_account_id as $1, and p_filters as $2 for the dynamic WHERE clause fragments
  EXECUTE v_sql INTO v_result USING p_account_id, p_filters;
  
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
