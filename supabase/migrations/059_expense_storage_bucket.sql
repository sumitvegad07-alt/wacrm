-- Insert the expense_proofs bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense_proofs', 'expense_proofs', true)
ON CONFLICT (id) DO NOTHING;

-- Policy for public read access
CREATE POLICY "expense_proofs_public_read_access" 
ON storage.objects FOR SELECT
USING (bucket_id = 'expense_proofs');

-- Policy for authenticated users to insert
CREATE POLICY "expense_proofs_auth_users_insert" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'expense_proofs' AND auth.role() = 'authenticated');

-- Policy for authenticated users to update
CREATE POLICY "expense_proofs_auth_users_update" 
ON storage.objects FOR UPDATE
USING (bucket_id = 'expense_proofs' AND auth.role() = 'authenticated');
