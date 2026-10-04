-- ============================================================
-- Phase 2 row-level views for the AI connector.
--
-- The report engine aggregates. It answers "how much did we sell" and can
-- never answer "which products, how many units, who skipped which customer".
-- Those are ordinary questions, so each needs one flat row per record with
-- the names already joined.
--
-- All security_invoker: they run as the caller, so the existing RLS on the
-- base tables applies unchanged and they grant nothing the user did not
-- already have.
--
-- Applied to production 2026-10-04.
-- ============================================================

-- Order LINE ITEMS. order_items carries no account_id of its own, so the
-- connector could not read it at all, and per-product value had to be guessed
-- from the order total — which repeats the whole order against every product
-- and overstates it badly on any multi-product order.
CREATE OR REPLACE VIEW mcp_order_item_details
WITH (security_invoker = true) AS
SELECT
  oi.id, o.account_id, o.id AS order_id, o.order_number,
  o.date AS order_date, o.created_at, o.status AS order_status,
  oi.product_id, oi.product_name, oi.hsn_code, oi.unit,
  oi.quantity, oi.base_quantity, oi.price AS unit_price,
  oi.discount_amount, oi.scheme_discount_amount, oi.tax_amount,
  oi.sub_total, oi.total AS line_value, oi.is_scheme_goods,
  o.contact_id,
  c.company   AS customer_company,
  c.name      AS customer_contact_person,
  c.city      AS customer_city,
  p.full_name AS employee_name,
  p.id        AS employee_profile_id
FROM order_items oi
JOIN orders o        ON o.id = oi.order_id
LEFT JOIN contacts c ON c.id = o.contact_id
LEFT JOIN profiles p ON p.user_id = o.user_id;

COMMENT ON VIEW mcp_order_item_details IS
  'One row per ORDER LINE. The only correct source for per-product value and quantity.';

-- Attendance: punch in/out sessions.
CREATE OR REPLACE VIEW mcp_attendance_details
WITH (security_invoker = true) AS
SELECT
  ts.id, ts.account_id, ts.user_id,
  p.id AS employee_profile_id, p.full_name AS employee_name,
  ts.started_at, ts.ended_at,
  CASE WHEN ts.ended_at IS NULL THEN NULL
       ELSE GREATEST(0, (EXTRACT(EPOCH FROM (ts.ended_at - ts.started_at)) / 60)::int)
  END AS duration_minutes,
  ts.end_reason, ts.device_id,
  ts.punch_in_distance_m, ts.punch_out_distance_m,
  ts.punch_in_is_mocked, ts.punch_out_is_mocked,
  ts.odometer_in_reading, ts.odometer_out_reading,
  CASE WHEN ts.odometer_out_reading IS NULL OR ts.odometer_in_reading IS NULL THEN NULL
       ELSE GREATEST(0, ts.odometer_out_reading - ts.odometer_in_reading)
  END AS odometer_distance
FROM tracking_sessions ts
LEFT JOIN profiles p ON p.user_id = ts.user_id;

COMMENT ON VIEW mcp_attendance_details IS
  'One row per punch-in session with duration and odometer distance.';

-- Device health: why a phone may not be reporting location.
CREATE OR REPLACE VIEW mcp_device_health_details
WITH (security_invoker = true) AS
SELECT
  d.id, d.account_id, d.user_id,
  p.id AS employee_profile_id, p.full_name AS employee_name,
  d.recorded_at, d.reason, d.app_version, d.os_version,
  d.manufacturer, d.model, d.battery_pct, d.is_charging,
  d.low_power_mode, d.battery_optimization_on, d.location_services_on,
  d.fg_location_permission, d.bg_location_permission, d.notification_permission
FROM device_health_snapshots d
LEFT JOIN profiles p ON p.user_id = d.user_id;

COMMENT ON VIEW mcp_device_health_details IS
  'One row per device health snapshot, with the employee name.';

-- Route plans.
CREATE OR REPLACE VIEW mcp_route_details
WITH (security_invoker = true) AS
SELECT
  r.id, r.account_id, r.name, r.description, r.status,
  r.created_at, r.archived_at, r.primary_assignee_id,
  p.full_name AS assigned_to,
  (SELECT count(*) FROM route_customers rc
     WHERE rc.route_id = r.id AND rc.archived_at IS NULL) AS customer_count,
  (SELECT count(*) FROM route_customers rc
     WHERE rc.route_id = r.id AND rc.archived_at IS NULL AND rc.must_visit) AS must_visit_count
FROM routes r
LEFT JOIN profiles p ON p.id = r.primary_assignee_id;

COMMENT ON VIEW mcp_route_details IS 'One row per route plan.';

-- Route runs: one per employee per route per day.
CREATE OR REPLACE VIEW mcp_route_run_details
WITH (security_invoker = true) AS
SELECT
  e.id, e.account_id, e.route_id, r.name AS route_name, e.user_id,
  p.id AS employee_profile_id, p.full_name AS employee_name,
  e.execution_date, e.status, e.started_at, e.completed_at, e.created_at,
  (SELECT count(*) FROM route_execution_stops s WHERE s.execution_id = e.id) AS stop_count,
  (SELECT count(*) FROM route_execution_stops s
     WHERE s.execution_id = e.id AND s.status = 'visited') AS visited_count,
  (SELECT count(*) FROM route_execution_stops s
     WHERE s.execution_id = e.id AND s.status = 'skipped') AS skipped_count
FROM route_executions e
LEFT JOIN routes r   ON r.id = e.route_id
LEFT JOIN profiles p ON p.user_id = e.user_id;

COMMENT ON VIEW mcp_route_run_details IS 'One row per employee per route per day.';

-- Route stops: who skipped which customer, answered directly.
CREATE OR REPLACE VIEW mcp_route_stop_details
WITH (security_invoker = true) AS
SELECT
  s.id, s.account_id, s.execution_id, e.execution_date, e.route_id,
  r.name AS route_name,
  p.full_name AS employee_name, p.id AS employee_profile_id,
  s.contact_id,
  c.company AS customer_company,
  c.name    AS customer_contact_person,
  s.planned_sequence, s.actual_sequence, s.status, s.skip_reason,
  s.visited_at, s.site_visit_id, s.created_at
FROM route_execution_stops s
LEFT JOIN route_executions e ON e.id = s.execution_id
LEFT JOIN routes r           ON r.id = e.route_id
LEFT JOIN profiles p         ON p.user_id = e.user_id
LEFT JOIN contacts c         ON c.id = s.contact_id;

COMMENT ON VIEW mcp_route_stop_details IS
  'One row per planned stop, with skip reason. Answers route adherence directly.';

-- Leave.
CREATE OR REPLACE VIEW mcp_leave_details
WITH (security_invoker = true) AS
SELECT
  l.id, l.account_id, l.leave_number, l.employee_id,
  p.full_name AS employee_name,
  lt.name     AS leave_type,
  l.from_date, l.to_date, l.total_days, l.status, l.reason,
  l.is_backdated, l.rejection_reason,
  ap.full_name AS approved_by_name,
  l.created_at
FROM leaves l
LEFT JOIN profiles p     ON p.id = l.employee_id
LEFT JOIN leave_types lt ON lt.id = l.leave_type_id
LEFT JOIN profiles ap    ON ap.id = l.approved_by;

COMMENT ON VIEW mcp_leave_details IS 'One row per leave request.';

-- Stock: closing stock is DERIVED, a running sum over the ledger. A product
-- with no ledger entries does not appear at all, which is not the same as
-- being out of stock.
CREATE OR REPLACE VIEW mcp_stock_levels
WITH (security_invoker = true) AS
SELECT
  l.account_id, l.product_id,
  pr.name AS product_name, pr.sku, pr.hsn_code,
  SUM(l.quantity)   AS closing_stock,
  COUNT(*)          AS ledger_entries,
  MAX(l.created_at) AS last_movement_at
FROM stock_ledger l
LEFT JOIN products pr ON pr.id = l.product_id
GROUP BY l.account_id, l.product_id, pr.name, pr.sku, pr.hsn_code;

COMMENT ON VIEW mcp_stock_levels IS
  'Closing stock per product, derived as the running sum over stock_ledger.';

-- Schemes.
CREATE OR REPLACE VIEW mcp_scheme_details
WITH (security_invoker = true) AS
SELECT
  s.id, s.account_id, s.name, s.scheme_type, s.slab_mode, s.target_type,
  s.priority, s.starts_on, s.ends_on, s.is_active,
  s.max_free_units_per_order, s.created_at,
  (SELECT count(*) FROM scheme_slabs sl WHERE sl.scheme_id = s.id) AS slab_count
FROM schemes s;

COMMENT ON VIEW mcp_scheme_details IS 'One row per discount/offer scheme.';

-- GPS pings with the employee name. Never exposed raw to the AI: the
-- connector clusters these into stops first, because a six-hour day is about
-- 4,000 pings and the honest answer is a dozen places with times.
CREATE OR REPLACE VIEW mcp_location_ping_details
WITH (security_invoker = true) AS
SELECT
  lp.id, lp.account_id, lp.user_id,
  p.id AS employee_profile_id, p.full_name AS employee_name,
  lp.recorded_at, lp.lat, lp.lng, lp.accuracy_m, lp.speed_mps, lp.is_mocked
FROM location_pings lp
LEFT JOIN profiles p ON p.user_id = lp.user_id;

COMMENT ON VIEW mcp_location_ping_details IS
  'Raw GPS pings with employee name. The AI connector clusters these into stop-and-dwell rows rather than returning them.';
