-- ============================================================
-- Migration: Add Gemini API Key to Bot Settings
-- Description: Allows users to provide their own Gemini API key in the UI
-- ============================================================

ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;
