-- Make attendance_selfies bucket public

UPDATE storage.buckets
SET public = true
WHERE id = 'attendance_selfies';
