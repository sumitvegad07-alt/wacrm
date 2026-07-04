-- Migration 039: Add user limits and add-ons to accounts

-- Add user_count and addons to the accounts table for per-user billing
ALTER TABLE accounts 
  ADD COLUMN IF NOT EXISTS user_count INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS addons TEXT[] NOT NULL DEFAULT '{}';

-- The available addons are currently:
-- 'field_tracking' : Grants access to the field sales location tracking module.

-- When user_count is exceeded by active users, we could enforce logic later,
-- but for now this just stores the billed amount.
