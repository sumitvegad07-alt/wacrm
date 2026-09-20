-- Remove the discovery/industry step from WFA v1 (not useful for implementation).
-- The engine still supports step_type='discovery' for future SFA/CRM templates;
-- this only drops it from the WFA v1 template. Child questions + any runtime
-- step_progress/answers cascade via ON DELETE CASCADE.
DELETE FROM impl_steps s
USING impl_templates t
WHERE s.template_id = t.id
  AND t.template_key = 'wfa_v1'
  AND s.step_key = 'discovery';
