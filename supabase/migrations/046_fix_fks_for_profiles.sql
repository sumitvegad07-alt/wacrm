ALTER TABLE site_visits DROP CONSTRAINT IF EXISTS fk_site_visits_profile;
ALTER TABLE site_visits ADD CONSTRAINT fk_site_visits_profile FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;

ALTER TABLE tracking_sessions DROP CONSTRAINT IF EXISTS fk_tracking_sessions_profile;
ALTER TABLE tracking_sessions ADD CONSTRAINT fk_tracking_sessions_profile FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;

ALTER TABLE location_pings DROP CONSTRAINT IF EXISTS fk_location_pings_profile;
ALTER TABLE location_pings ADD CONSTRAINT fk_location_pings_profile FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;
