-- ============================================================
-- Restore the row-level security policies on storage.objects.
--
-- WHY THIS EXISTS
--
-- The move from Singapore to Mumbai on 2026-09-27 carried the `public` schema
-- and the storage BUCKETS across, but not the policies on `storage.objects`.
-- RLS stayed switched on with nothing to allow, so from the moment traffic
-- moved, every upload from every device was denied:
--
--     new row violates row-level security policy for table "objects"
--
-- That one gap is what the field saw as "the app has stopped syncing", because
-- of how the offline queue chains work together:
--
--   1. Punch In queues a tracking_sessions CREATE that carries the selfie. The
--      upload runs FIRST; it was denied, so the session row was never inserted.
--   2. Location pings are queued against that session id. With no parent row
--      they fail on location_pings_session_id_fkey (SQLSTATE 23503), which the
--      retry policy correctly reads as "the data is wrong" and dead-letters on
--      the spot. 5,096 of them in 24 hours. Same for device_health_snapshots.
--   3. A visit check-out carries the visit photo, so it took the same upload
--      path and never landed -- which is why a visit read as "running" for 41
--      hours while the rep had full signal and had closed it several times.
--
-- Restoring these policies fixes all of it at once, for every tenant, with no
-- app release. Definitions are copied verbatim from the Singapore project so
-- behaviour is exactly what it was before the move.
--
-- Idempotent: safe to re-run.
-- ============================================================

begin;

do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'storage.objects'::regclass
  loop
    execute format('drop policy if exists %I on storage.objects', p.polname);
  end loop;
end $$;

-- announcements -------------------------------------------------------------
create policy "Authenticated users can upload announcements" on storage.objects
  for insert to authenticated with check (bucket_id = 'announcements');
create policy "Public can view announcements" on storage.objects
  for select using (bucket_id = 'announcements');
create policy "Users can update their own uploads" on storage.objects
  for update to authenticated using (bucket_id = 'announcements' and owner = auth.uid())
  with check (bucket_id = 'announcements');
create policy "Users can delete their own uploads" on storage.objects
  for delete to authenticated using (bucket_id = 'announcements' and owner = auth.uid());

-- attendance_selfies --------------------------------------------------------
create policy "Users can upload their own selfies" on storage.objects
  for insert with check (bucket_id = 'attendance_selfies' and auth.uid() = owner);
create policy "Users and admins can view selfies" on storage.objects
  for select using (bucket_id = 'attendance_selfies');

-- visit_photos --------------------------------------------------------------
create policy "Users can upload visit photos" on storage.objects
  for insert with check (bucket_id = 'visit_photos' and auth.uid() = owner);
create policy "Users and admins can view visit photos" on storage.objects
  for select using (bucket_id = 'visit_photos');

-- odometer_photos -----------------------------------------------------------
create policy "Users can upload their own odometer photos" on storage.objects
  for insert with check (bucket_id = 'odometer_photos' and auth.uid() = owner);
create policy "Users and admins can view odometer photos" on storage.objects
  for select using (bucket_id = 'odometer_photos');

-- expense_proofs ------------------------------------------------------------
create policy "expense_proofs_auth_users_insert" on storage.objects
  for insert with check (bucket_id = 'expense_proofs' and auth.role() = 'authenticated');
create policy "expense_proofs_auth_users_update" on storage.objects
  for update using (bucket_id = 'expense_proofs' and auth.role() = 'authenticated');
create policy "expense_proofs_public_read_access" on storage.objects
  for select using (bucket_id = 'expense_proofs');

-- avatars -------------------------------------------------------------------
create policy "Users can upload their own avatar" on storage.objects
  for insert with check (bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]);
create policy "Avatars are publicly readable" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "Users can update their own avatar" on storage.objects
  for update using (bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]);
create policy "Users can delete their own avatar" on storage.objects
  for delete using (bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]);

-- profile_avatars -----------------------------------------------------------
create policy "Users can upload avatars" on storage.objects
  for insert with check (bucket_id = 'profile_avatars' and auth.role() = 'authenticated');
create policy "Public avatars are viewable by everyone" on storage.objects
  for select using (bucket_id = 'profile_avatars');
create policy "Users can update avatars" on storage.objects
  for update using (bucket_id = 'profile_avatars' and auth.role() = 'authenticated');
create policy "Users can delete avatars" on storage.objects
  for delete using (bucket_id = 'profile_avatars' and auth.role() = 'authenticated');

-- product-images ------------------------------------------------------------
create policy "Authenticated users can upload" on storage.objects
  for insert with check (bucket_id = 'product-images' and auth.role() = 'authenticated');
create policy "Authenticated users can update" on storage.objects
  for update using (bucket_id = 'product-images' and auth.role() = 'authenticated');
create policy "Authenticated users can delete" on storage.objects
  for delete using (bucket_id = 'product-images' and auth.role() = 'authenticated');
create policy "product_images_auth_upload" on storage.objects
  for insert with check (bucket_id = 'product-images' and auth.role() = 'authenticated');
create policy "product_images_auth_update" on storage.objects
  for update using (bucket_id = 'product-images' and auth.role() = 'authenticated');
create policy "product_images_auth_delete" on storage.objects
  for delete using (bucket_id = 'product-images' and auth.role() = 'authenticated');
create policy "product_images_public_access" on storage.objects
  for select using (bucket_id = 'product-images');

-- document_assets -----------------------------------------------------------
create policy "Document assets are writable by account members" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'document_assets' and is_account_member(((storage.foldername(name))[1])::uuid));
create policy "Document assets are readable" on storage.objects
  for select using (bucket_id = 'document_assets');
create policy "Document assets are replaceable by account members" on storage.objects
  for update to authenticated
  using (bucket_id = 'document_assets' and is_account_member(((storage.foldername(name))[1])::uuid));
create policy "Document assets are removable by account members" on storage.objects
  for delete to authenticated
  using (bucket_id = 'document_assets' and is_account_member(((storage.foldername(name))[1])::uuid));

-- payment_attachments (private bucket) --------------------------------------
create policy "payment_attachments_insert_own_account" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment_attachments' and is_account_member(((storage.foldername(name))[1])::uuid));
create policy "payment_attachments_select_own_account" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment_attachments' and is_account_member(((storage.foldername(name))[1])::uuid));
create policy "payment_attachments_delete_own_account" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment_attachments' and is_account_member(((storage.foldername(name))[1])::uuid));

-- chat-media ----------------------------------------------------------------
create policy "Members can upload chat media" on storage.objects
  for insert with check (
    bucket_id = 'chat-media' and exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and ('account-' || (p.account_id)::text) = (storage.foldername(objects.name))[1]));
create policy "Chat media is publicly readable" on storage.objects
  for select using (bucket_id = 'chat-media');
create policy "Members can update chat media" on storage.objects
  for update using (
    bucket_id = 'chat-media' and exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and ('account-' || (p.account_id)::text) = (storage.foldername(objects.name))[1]));
create policy "Members can delete chat media" on storage.objects
  for delete using (
    bucket_id = 'chat-media' and exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and ('account-' || (p.account_id)::text) = (storage.foldername(objects.name))[1]));

-- flow-media ----------------------------------------------------------------
create policy "Members can upload flow media" on storage.objects
  for insert with check (
    bucket_id = 'flow-media' and (exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and ('account-' || (p.account_id)::text) = (storage.foldername(objects.name))[1])
      or (auth.uid())::text = (storage.foldername(name))[1]));
create policy "Flow media is publicly readable" on storage.objects
  for select using (bucket_id = 'flow-media');
create policy "Members can update flow media" on storage.objects
  for update using (
    bucket_id = 'flow-media' and (exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and ('account-' || (p.account_id)::text) = (storage.foldername(objects.name))[1])
      or (auth.uid())::text = (storage.foldername(name))[1]));
create policy "Members can delete flow media" on storage.objects
  for delete using (
    bucket_id = 'flow-media' and (exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and ('account-' || (p.account_id)::text) = (storage.foldername(objects.name))[1])
      or (auth.uid())::text = (storage.foldername(name))[1]));

-- task-attachments / custom-field-attachments --------------------------------
create policy "Users can manage their task attachments" on storage.objects
  for all using (bucket_id = 'task-attachments' and auth.uid() = owner);
create policy "Users can manage custom field attachments" on storage.objects
  for all using (bucket_id = 'custom-field-attachments' and auth.role() = 'authenticated');

commit;
