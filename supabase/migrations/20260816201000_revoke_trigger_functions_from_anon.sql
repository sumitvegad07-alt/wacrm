-- Follow-up to 20260816200000.
--
-- Revoking from PUBLIC closed the default grant, but an earlier migration in this project
-- granted EXECUTE on public functions to `anon` explicitly, and an explicit role grant
-- survives REVOKE ... FROM PUBLIC. The three trigger functions were still listed as
-- anon-executable afterwards.
--
-- This is hygiene, not a live hole: calling a plpgsql trigger function directly always
-- fails with "trigger functions can only be called as triggers", whoever calls it. But a
-- grant that serves no purpose invites the next person to assume it was deliberate.
REVOKE ALL ON FUNCTION public.enforce_payment_required_fields()        FROM anon;
REVOKE ALL ON FUNCTION public.enforce_payment_attachment_on_approval() FROM anon;
REVOKE ALL ON FUNCTION public.set_document_template_assignment_scope() FROM anon;
