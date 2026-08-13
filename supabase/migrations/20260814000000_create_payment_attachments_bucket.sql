-- Create a storage bucket for payment attachments
insert into storage.buckets (id, name, public)
values ('payment_attachments', 'payment_attachments', true)
on conflict (id) do nothing;

-- Set up RLS policies for the bucket
-- Allow authenticated users to upload files to this bucket
create policy "Allow authenticated uploads"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'payment_attachments' );

-- Allow public to view files
create policy "Allow public view"
on storage.objects for select
to public
using ( bucket_id = 'payment_attachments' );
