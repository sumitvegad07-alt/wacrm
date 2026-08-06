-- Add external_link column to tenant_announcements
ALTER TABLE public.tenant_announcements
ADD COLUMN IF NOT EXISTS external_link TEXT;
