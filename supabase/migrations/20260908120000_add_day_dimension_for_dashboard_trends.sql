-- Dashboard trend charts (Order Value / Sales Value / Order vs Sales / Customer
-- Visits / Visit Productivity) bucket a trailing window at daily/monthly/
-- quarterly/yearly granularity in JS (see src/lib/dashboard/analytics-period.ts).
-- They were calling the report engine's `date` dimension, which returns a human
-- label ("September 2026") via TO_CHAR(..,'FMMonth YYYY'). The JS bucketer does
-- `new Date("September 2026".slice(0,10))` → Invalid Date, so EVERY row was
-- dropped and the charts rendered empty on every tenant.
--
-- Add a machine-parseable, day-grained `day` dimension (YYYY-MM-DD) that the
-- dashboard groups on instead. The Reports UI keeps using `date` (the friendly
-- month label); only the dashboard analytics actions use `day`.
--
-- `sales.day` dates by dispatch completion (falling back to the order date),
-- exactly like the existing `sales.date` dimension, so the dashboard's
-- "Sales Value" stays consistent with the Sales Report.

INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
  ('order', 'day', 'Day', $$TO_CHAR(base.date, 'YYYY-MM-DD')$$, '[]'::jsonb),
  ('sales', 'day', 'Day', $$TO_CHAR(COALESCE(sd.completed_at, base.date), 'YYYY-MM-DD')$$, '["sales_date"]'::jsonb),
  ('visit', 'day', 'Day', $$TO_CHAR(base.check_in_at, 'YYYY-MM-DD')$$, '[]'::jsonb)
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label,
      sql_select = EXCLUDED.sql_select,
      required_joins = EXCLUDED.required_joins;
