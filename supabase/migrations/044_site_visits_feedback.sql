-- Add missing feedback columns to site_visits
ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS feedback_type TEXT,
  ADD COLUMN IF NOT EXISTS feedback_text TEXT,
  ADD COLUMN IF NOT EXISTS visit_photo_url TEXT;
