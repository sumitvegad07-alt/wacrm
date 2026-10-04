-- ============================================================
-- Row-level views for the AI connector.
--
-- The report engine aggregates, so it answers "how much did we sell" but
-- never "show me each order with its customer, value and status". Those are
-- ordinary follow-up questions, so each needs one flat row per record with
-- the names already joined.
--
-- All security_invoker: they run as the caller, so existing RLS applies and
-- they grant nothing the user did not already have.
-- ============================================================

CREATE OR REPLACE VIEW mcp_order_details
WITH (security_invoker = true) AS
SELECT
  o.id, o.account_id, o.order_number,
  o.date AS order_date, o.created_at, o.status, o.classification,
  o.sub_total, o.discount_total, o.tax_total, o.total_amount, o.notes,
  o.contact_id,
  c.company   AS customer_company,
  c.name      AS customer_contact_person,
  c.city      AS customer_city,
  c.area      AS customer_area,
  p.full_name AS employee_name,
  p.id        AS employee_profile_id,
  (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
LEFT JOIN contacts c ON c.id = o.contact_id
LEFT JOIN profiles p ON p.user_id = o.user_id;

COMMENT ON VIEW mcp_order_details IS
  'One row per order with customer and employee names, for the AI connector. security_invoker.';

CREATE OR REPLACE VIEW mcp_payment_details
WITH (security_invoker = true) AS
SELECT
  pay.id, pay.account_id, pay.payment_number, pay.payment_date, pay.created_at,
  pay.amount, pay.verified_amount, pay.payment_type, pay.status,
  pay.reference_number, pay.notes, pay.contact_id,
  c.company    AS customer_company,
  c.name       AS customer_contact_person,
  c.city       AS customer_city,
  pr.full_name AS employee_name,
  pr.id        AS employee_profile_id
FROM payments pay
LEFT JOIN contacts c  ON c.id = pay.contact_id
LEFT JOIN profiles pr ON pr.user_id = pay.user_id;

COMMENT ON VIEW mcp_payment_details IS
  'One row per payment with customer and employee names, for the AI connector. security_invoker.';

CREATE OR REPLACE VIEW mcp_expense_details
WITH (security_invoker = true) AS
SELECT
  e.id, e.account_id, e.expense_number, e.expense_date, e.created_at,
  e.amount, e.approved_amount, e.status, e.travel_km, e.rate_per_km,
  e.odometer_start, e.odometer_end, e.remarks, e.rejection_reason, e.employee_id,
  et.expense_name AS expense_type,
  p.full_name     AS employee_name,
  ap.full_name    AS approved_by_name
FROM expenses e
LEFT JOIN expense_types et ON et.id = e.expense_type_id
LEFT JOIN profiles p       ON p.id = e.employee_id
LEFT JOIN profiles ap      ON ap.id = e.approved_by;

COMMENT ON VIEW mcp_expense_details IS
  'One row per expense claim with type, employee and approver names, for the AI connector. security_invoker.';
