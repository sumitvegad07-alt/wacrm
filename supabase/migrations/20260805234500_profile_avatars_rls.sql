-- Enable public viewing of avatars
CREATE POLICY "Public avatars are viewable by everyone" ON storage.objects FOR SELECT USING (bucket_id = 'profile_avatars');

-- Allow authenticated users to upload avatars
CREATE POLICY "Users can upload avatars" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'profile_avatars' AND auth.role() = 'authenticated');

-- Allow authenticated users to update/delete avatars
CREATE POLICY "Users can update avatars" ON storage.objects FOR UPDATE USING (bucket_id = 'profile_avatars' AND auth.role() = 'authenticated');
CREATE POLICY "Users can delete avatars" ON storage.objects FOR DELETE USING (bucket_id = 'profile_avatars' AND auth.role() = 'authenticated');
