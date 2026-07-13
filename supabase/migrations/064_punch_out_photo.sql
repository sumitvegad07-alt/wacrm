-- ============================================================
-- 064_punch_out_photo.sql
-- Adds missing punch_out_photo_url column
-- ============================================================

ALTER TABLE tracking_sessions
ADD COLUMN IF NOT EXISTS punch_out_photo_url TEXT;
