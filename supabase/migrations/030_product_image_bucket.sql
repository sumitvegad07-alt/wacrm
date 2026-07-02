-- ============================================================
-- PRODUCT IMAGES BUCKET
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880, -- 5MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS for product-images bucket
DROP POLICY IF EXISTS "product_images_public_access" ON storage.objects;
CREATE POLICY "product_images_public_access" 
ON storage.objects FOR SELECT 
USING ( bucket_id = 'product-images' );

DROP POLICY IF EXISTS "product_images_auth_upload" ON storage.objects;
CREATE POLICY "product_images_auth_upload" 
ON storage.objects FOR INSERT 
WITH CHECK ( bucket_id = 'product-images' AND auth.role() = 'authenticated' );

DROP POLICY IF EXISTS "product_images_auth_update" ON storage.objects;
CREATE POLICY "product_images_auth_update" 
ON storage.objects FOR UPDATE 
USING ( bucket_id = 'product-images' AND auth.role() = 'authenticated' );

DROP POLICY IF EXISTS "product_images_auth_delete" ON storage.objects;
CREATE POLICY "product_images_auth_delete" 
ON storage.objects FOR DELETE 
USING ( bucket_id = 'product-images' AND auth.role() = 'authenticated' );
