-- Migration: Update account default settings
-- Sets all modules to disabled by default and user_count to 20

ALTER TABLE accounts
  ALTER COLUMN module_settings SET DEFAULT '{
    "whatsapp": false,
    "quotation": false,
    "expense": false,
    "dispatch": false,
    "pending_dispatch": false,
    "reporting_hierarchy": false,
    "route": false
  }'::jsonb;

ALTER TABLE accounts
  ALTER COLUMN user_count SET DEFAULT 20;
