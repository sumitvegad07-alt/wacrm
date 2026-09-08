-- Multi Unit: a "Base Quantity" report measure (converted base-unit quantity)
-- alongside the existing entered "Quantity". COALESCE(base_quantity, quantity) so
-- legacy/single-unit lines (base_quantity NULL) equal their entered quantity.
-- Registry-driven: no execute_report() change. The single 'order' rows are
-- inherited by the 'sales' report (v_registry_modules = ['sales','order']).

UPDATE public.report_registry_joins
SET sql_join = 'LEFT JOIN (SELECT order_id, SUM(quantity) AS product_quantity, SUM(COALESCE(base_quantity, quantity)) AS base_quantity, COUNT(DISTINCT product_id) AS product_count FROM order_items GROUP BY order_id) isum ON base.id = isum.order_id'
WHERE join_key = 'order_items_summary' AND module_name = 'order';

INSERT INTO public.report_registry_measures (module_name, key, label, sql_select, type, required_joins)
SELECT 'order', 'base_quantity', 'Base Quantity', 'SUM(COALESCE(isum.base_quantity, 0))', 'number', '["order_items_summary"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.report_registry_measures WHERE module_name = 'order' AND key = 'base_quantity'
);
