-- Saved reports become a single "default view" per user per report module.
--
-- Founder decision, 2026-08-16: the multi-preset + sharing-scope design was never
-- usable — nothing in the UI could list or load a saved report, "Team" sharing had
-- no RLS policy behind it (it silently behaved as Private), and the "set as
-- default" checkbox wrote into the config JSON blob that nothing read.
--
-- Replaced by: the user arranges a report (dimensions, measures, filters, period,
-- chart view), names it, saves it, and that arrangement becomes how the report
-- opens from then on. One per user per module, overwritten on each save.
--
-- Sharing is gone. Every row is the owner's own private default view, so the
-- `auth.uid() = user_id` policies are the only ones that matter; the
-- 'organization' SELECT policy is left in place but can no longer match anything
-- because the app only ever writes sharing_mode = 'private'.

-- Collapse any pre-existing duplicates to the newest row per (user, module).
DELETE FROM saved_reports a
 USING saved_reports b
 WHERE a.user_id = b.user_id
   AND a.module_name = b.module_name
   AND a.created_at < b.created_at;

-- The upsert target: one saved view per user per module.
ALTER TABLE saved_reports
  ADD CONSTRAINT saved_reports_user_module_key UNIQUE (user_id, module_name);

-- Every surviving row is now that user's default view for its module.
UPDATE saved_reports SET is_default = true, sharing_mode = 'private';

COMMENT ON TABLE saved_reports IS
  'One default report view per user per module. Upserted on (user_id, module_name); '
  'the report opens with this configuration. Not a preset library — sharing_mode and '
  'is_favorite are vestigial and always private/false.';
