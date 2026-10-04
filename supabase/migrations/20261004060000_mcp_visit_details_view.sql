-- ============================================================
-- One row per visit, flattened, for follow-up questions.
--
-- The report engine aggregates: it answers "how many visits" but never
-- "show me each visit with how long it lasted and what the feedback was".
-- That is an ordinary follow-up and needs row-level data with the customer
-- and employee names already joined.
--
-- security_invoker = true means the view runs as the caller, so the RLS on
-- site_visits / contacts / profiles applies unchanged. It grants no access
-- that the user did not already have.
-- ============================================================
CREATE OR REPLACE VIEW mcp_visit_details
WITH (security_invoker = true) AS
SELECT
  v.id,
  v.account_id,
  v.user_id,
  v.contact_id,
  v.target_type,
  v.check_in_at,
  v.check_out_at,
  CASE
    WHEN v.check_out_at IS NULL THEN NULL
    ELSE GREATEST(0, (EXTRACT(EPOCH FROM (v.check_out_at - v.check_in_at)) / 60)::int)
  END AS duration_minutes,
  v.feedback_type,
  v.feedback_text,
  v.notes,
  v.visit_photo_url,
  v.check_in_distance_m,
  v.check_out_distance_m,
  c.company  AS customer_company,
  c.name     AS customer_contact_person,
  c.city     AS customer_city,
  c.area     AS customer_area,
  p.full_name AS employee_name,
  p.id        AS employee_profile_id
FROM site_visits v
LEFT JOIN contacts c
  ON c.id = COALESCE(v.contact_id, CASE WHEN v.target_type = 'Lead' THEN NULL ELSE v.target_id END)
LEFT JOIN profiles p
  ON p.user_id = v.user_id;

COMMENT ON VIEW mcp_visit_details IS
  'One row per visit with duration, feedback and joined customer/employee names, for the AI connector. security_invoker, so RLS on the base tables applies.';
