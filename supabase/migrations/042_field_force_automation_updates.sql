-- ============================================================
-- 042_field_force_automation_updates.sql
-- Adds missing columns for Field Force Automation (Selfies, Photos, Feedback)
-- ============================================================

-- 1. Update tracking_sessions (Punch In/Out) to store mandatory selfie
ALTER TABLE tracking_sessions
ADD COLUMN IF NOT EXISTS punch_in_photo_url TEXT;

-- 2. Update site_visits (Customer Visits) to store feedback and shop photos
ALTER TABLE site_visits
ADD COLUMN IF NOT EXISTS visit_photo_url TEXT,
ADD COLUMN IF NOT EXISTS feedback_type TEXT CHECK (feedback_type IN ('Excellent', 'Good', 'Average', 'Poor')),
ADD COLUMN IF NOT EXISTS feedback_text TEXT;

-- 3. Create Storage Buckets for these photos if they don't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('attendance_selfies', 'attendance_selfies', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('visit_photos', 'visit_photos', false)
ON CONFLICT (id) DO NOTHING;

-- 4. Set up Storage RLS for attendance_selfies
CREATE POLICY "Users can upload their own selfies" ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'attendance_selfies' AND auth.uid() = owner);

CREATE POLICY "Users and admins can view selfies" ON storage.objects
FOR SELECT
USING (bucket_id = 'attendance_selfies');

-- 5. Set up Storage RLS for visit_photos
CREATE POLICY "Users can upload visit photos" ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'visit_photos' AND auth.uid() = owner);

CREATE POLICY "Users and admins can view visit photos" ON storage.objects
FOR SELECT
USING (bucket_id = 'visit_photos');
