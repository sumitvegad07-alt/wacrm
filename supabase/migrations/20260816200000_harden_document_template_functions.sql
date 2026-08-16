-- Smoke-test follow-up: two real defects in the same day's work.
--
-- 1. REVOKE ... FROM anon does nothing on its own.
--    Postgres grants EXECUTE on a new function to PUBLIC by default, and `anon` inherits
--    from PUBLIC. Revoking the role's own (non-existent) grant leaves the PUBLIC one
--    intact, so every function added today was still callable anonymously — including
--    can_edit_document_template, which is SECURITY DEFINER. For an anonymous caller
--    is_account_member() is false, but the "template has no assignments" branch returns
--    true, so anyone who guessed a template uuid could learn whether it had assignees.
--    Small, but it is a real leak from a definer function. The fix is to revoke from
--    PUBLIC and grant back only to authenticated.
--
-- 2. Three functions were left with a mutable search_path.
--    A trigger function that resolves table names through a caller-controlled search_path
--    can be pointed at a shadowing schema. The other functions added today already pinned
--    it; these three were missed.

-- ===========================================================================
-- 1. Take EXECUTE away from PUBLIC, hand it back to authenticated only
-- ===========================================================================
REVOKE ALL ON FUNCTION public.can_edit_document_template(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_document_template(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_default_document_template(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_edit_document_template(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_document_template(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_document_template(uuid) TO authenticated;

-- Trigger functions are invoked by the trigger machinery, which does not check the calling
-- role's EXECUTE privilege, so removing the public grant costs nothing and closes a
-- needless direct-call surface.
REVOKE ALL ON FUNCTION public.enforce_payment_required_fields() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_payment_attachment_on_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_document_template_assignment_scope() FROM PUBLIC;


-- ===========================================================================
-- 2. Pin the search_path on the three that were missed
-- ===========================================================================
-- ALTER rather than CREATE OR REPLACE: the bodies are correct and reproducing them here
-- would risk the two drifting apart.
ALTER FUNCTION public.enforce_payment_required_fields()        SET search_path = public;
ALTER FUNCTION public.enforce_payment_attachment_on_approval() SET search_path = public;
ALTER FUNCTION public.set_document_template_assignment_scope() SET search_path = public;
