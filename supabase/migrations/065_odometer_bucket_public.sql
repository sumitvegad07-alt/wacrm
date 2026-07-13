-- ============================================================
-- 065_odometer_bucket_public.sql
-- Makes the odometer_photos bucket public
-- ============================================================

UPDATE storage.buckets SET public = true WHERE id = 'odometer_photos';
