-- Hardening (QA F2): pin search_path on the one SECURITY DEFINER function that
-- was missing it. A definer function resolves unqualified names against the
-- caller-influenced search_path; without a pinned path, a role able to create
-- objects on the path could shadow a referenced object and run code as the
-- function owner. Every other definer function in this schema already pins it.
--
-- log_expense_activity() (061_expense_enhancements.sql) is a SECURITY DEFINER
-- BEFORE-INSERT trigger. We only pin the path here — the body is unchanged, so
-- this is behaviour-preserving. ALTER FUNCTION avoids re-stating the body.
--
-- Verification: Supabase `get_advisors(type: security)` should no longer list
-- log_expense_activity under `function_search_path_mutable` after this applies.
-- (Applying to production remains a manual founder step.)

alter function public.log_expense_activity() set search_path = public, pg_temp;
