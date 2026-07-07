-- Add foreign key constraints to public.profiles to enable PostgREST joins

-- First, delete dirty test data where the user_id is missing from profiles
DELETE FROM site_visits WHERE user_id NOT IN (SELECT id FROM profiles);
DELETE FROM tracking_sessions WHERE user_id NOT IN (SELECT id FROM profiles);
DELETE FROM location_pings WHERE user_id NOT IN (SELECT id FROM profiles);

ALTER TABLE site_visits
  DROP CONSTRAINT IF EXISTS fk_site_visits_profile;
ALTER TABLE site_visits
  ADD CONSTRAINT fk_site_visits_profile FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE tracking_sessions
  DROP CONSTRAINT IF EXISTS fk_tracking_sessions_profile;
ALTER TABLE tracking_sessions
  ADD CONSTRAINT fk_tracking_sessions_profile FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE location_pings
  DROP CONSTRAINT IF EXISTS fk_location_pings_profile;
ALTER TABLE location_pings
  ADD CONSTRAINT fk_location_pings_profile FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
