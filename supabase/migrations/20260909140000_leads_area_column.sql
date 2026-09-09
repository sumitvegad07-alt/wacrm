-- Add an `area` column to leads so the lead Address Details section mirrors the
-- customer one exactly (Street Address, Area/Locality, City, State, Country,
-- Pincode). Nullable text; existing rows keep NULL. The lead form + territory
-- cascade populate it the same way the customer form does.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS area TEXT;
