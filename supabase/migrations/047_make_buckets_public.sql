-- Make visit_photos and selfies buckets public

UPDATE storage.buckets
SET public = true
WHERE id IN ('visit_photos', 'selfies');
