-- Baseline snapshot: the resolver values captured when the account first enrolls.
-- A step completes only when its value grows beyond this baseline (net-new work),
-- so pre-existing defaults (seeded territories, the admin user, default roles) do
-- not pre-complete steps.
ALTER TABLE impl_progress ADD COLUMN IF NOT EXISTS baseline jsonb;
