-- ============================================================
-- 090_module_settings.sql
--
-- Adds a `module_settings` JSONB column to the `accounts` table.
-- This stores which optional/configurable modules are enabled for
-- a given account. Admins can toggle these from the Module Settings
-- page in the app.
--
-- Configurable modules:
--   whatsapp        — WhatsApp integration (inbox, broadcasts, automations)
--   quotation       — Quotation creation and management
--   expense         — Expense tracking and management
--   dispatch        — Dispatch management for orders
--   pending_dispatch — Pending dispatch tracking
--
-- All modules default to `true` so existing accounts are unaffected.
-- Fixed modules (Dashboard, Customer, Product, Lead, Deal, etc.) are
-- NOT stored here — they are always visible.
--
-- Future: plan-based module gates (CRM-only, SFA-only) will be
-- layered on top of this in a later migration. This column handles
-- admin-level toggles only.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS module_settings JSONB NOT NULL DEFAULT '{
    "whatsapp": true,
    "quotation": true,
    "expense": true,
    "dispatch": true,
    "pending_dispatch": true
  }'::jsonb;

-- Back-fill any existing rows that may have NULL (shouldn't happen
-- given the DEFAULT, but defensive for safety).
UPDATE accounts
SET module_settings = '{
  "whatsapp": true,
  "quotation": true,
  "expense": true,
  "dispatch": true,
  "pending_dispatch": true
}'::jsonb
WHERE module_settings IS NULL;
