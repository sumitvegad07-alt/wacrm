-- Create the tenant_announcements table
CREATE TABLE IF NOT EXISTS public.tenant_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  expiry_date TIMESTAMPTZ,
  send_to_sales_app BOOLEAN DEFAULT true,
  employee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_role_id UUID REFERENCES public.employee_roles(id) ON DELETE SET NULL,
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tenant_announcements_account_id ON public.tenant_announcements(account_id);
CREATE INDEX IF NOT EXISTS idx_tenant_announcements_expiry ON public.tenant_announcements(expiry_date);
CREATE INDEX IF NOT EXISTS idx_tenant_announcements_role ON public.tenant_announcements(employee_role_id);
CREATE INDEX IF NOT EXISTS idx_tenant_announcements_employee ON public.tenant_announcements(employee_id);

-- Update timestamp trigger
CREATE TRIGGER set_tenant_announcements_updated_at
  BEFORE UPDATE ON public.tenant_announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.tenant_announcements ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage tenant announcements"
  ON public.tenant_announcements
  FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY "Members can view tenant announcements"
  ON public.tenant_announcements
  FOR SELECT
  USING (is_account_member(account_id));

-- Add storage bucket for attachments if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('announcements', 'announcements', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for the 'announcements' bucket
-- Note: 'authenticated' users can upload to the bucket if they are uploading to their account's folder (e.g. {account_id}/*)
-- But since it's a global public bucket, we should at least let authenticated users upload.
CREATE POLICY "Authenticated users can upload announcements"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'announcements');

CREATE POLICY "Public can view announcements"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'announcements');

CREATE POLICY "Users can update their own uploads"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'announcements' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'announcements');

CREATE POLICY "Users can delete their own uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'announcements' AND owner = auth.uid());
