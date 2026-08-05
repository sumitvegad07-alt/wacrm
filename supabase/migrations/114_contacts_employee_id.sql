-- Add employee_id to contacts table for direct assignment mode
ALTER TABLE public.contacts
ADD COLUMN employee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Create an index to quickly find contacts assigned to a specific employee
CREATE INDEX IF NOT EXISTS idx_contacts_employee_id ON public.contacts(employee_id);

-- Expose via PostgREST (since contacts is already tracked in account_sharing)
-- No additional RLS required for general read/write because contacts_select
-- and contacts_modify are already based on account_id membership.
