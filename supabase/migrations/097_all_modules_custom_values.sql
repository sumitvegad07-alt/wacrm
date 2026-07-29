-- Migration 097: Ensure Custom Values tables exist for all modules in Sidebar

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS user_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  custom_field_id UUID REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT
);
ALTER TABLE user_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_cv_all ON user_custom_values;
CREATE POLICY user_cv_all ON user_custom_values FOR ALL USING (true);

CREATE TABLE IF NOT EXISTS dispatch_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  dispatch_id UUID NOT NULL,
  custom_field_id UUID REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT
);
ALTER TABLE dispatch_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dispatch_cv_all ON dispatch_custom_values;
CREATE POLICY dispatch_cv_all ON dispatch_custom_values FOR ALL USING (true);

CREATE TABLE IF NOT EXISTS customer_visit_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL,
  custom_field_id UUID REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT
);
ALTER TABLE customer_visit_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_visit_cv_all ON customer_visit_custom_values;
CREATE POLICY customer_visit_cv_all ON customer_visit_custom_values FOR ALL USING (true);

CREATE TABLE IF NOT EXISTS lead_visit_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL,
  custom_field_id UUID REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT
);
ALTER TABLE lead_visit_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_visit_cv_all ON lead_visit_custom_values;
CREATE POLICY lead_visit_cv_all ON lead_visit_custom_values FOR ALL USING (true);
