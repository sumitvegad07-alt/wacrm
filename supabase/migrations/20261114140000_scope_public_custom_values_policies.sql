-- ============================================================
-- FOUR TABLES WERE READABLE BY ANYONE ON THE INTERNET.
--
-- Found on 2026-11-14 by the policy sweep DMS Plan 2 Task 3 Step 4 asks for:
-- list every policy whose expression never mentions a membership or ownership
-- test, then judge each one. Ten came back. Five are report_registry_* (engine
-- metadata, no tenant data, no account_id column at all) and one is
-- ozzo_docs_select (is_published = true, deliberately public). These four were
-- holes:
--
--   customer_visit_custom_values   customer_visit_cv_all   FOR ALL TO public USING (true)
--   lead_visit_custom_values       lead_visit_cv_all       FOR ALL TO public USING (true)
--   dispatch_custom_values         dispatch_cv_all         FOR ALL TO public USING (true)
--   user_custom_values             user_cv_all             FOR ALL TO public USING (true)
--
-- `TO public USING (true)` means every role, so the anon key — which ships in
-- the browser bundle and is therefore public knowledge — could read every
-- tenant's rows, and any signed-in user could write them. MEASURED on the test
-- harness before writing this, rather than reasoned about:
--
--   * a portal customer of tenant A read tenant B's row,
--   * a visitor who was not signed in at all read tenant B's row,
--   * a portal customer of tenant A INSERTED a row into tenant B,
--   * and UPDATEd tenant B's existing row.
--
-- Anon could not write, but only because Supabase grants anon no INSERT — a
-- grant, not a policy, and not something to rely on.
--
-- These are not dead legacy tables. The web app writes all four (the employee
-- form, the dispatch form, the visits screen) and the mobile app writes the two
-- visit ones through its offline queue. They hold whatever a tenant has
-- configured as a custom field on a visit, a dispatch or an employee — so a
-- phone number, a reason, a remark, anything.
--
-- Production held 0 rows in all four when this was written, so nothing has
-- leaked yet. It would have, the first time any tenant used custom fields on
-- those modules.
--
-- THE FIX IS THE CONVENTION EVERY OTHER custom_values TABLE ALREADY USES.
-- contact_custom_values, lead_custom_values and expense_custom_values all scope
-- through is_account_member. These four carry account_id on the row itself, so
-- they can test it directly without a join.
--
-- WHY account_id AND NOT A JOIN TO THE PARENT. Fewer moving parts, and the
-- column is already populated: all four write paths set account_id explicitly
-- (team/employees/new, team/employees/[id], dispatch-form, and the mobile
-- lib/visits/customFields enqueue). A future insert that omits it is refused by
-- the WITH CHECK, which is the right answer rather than a row nobody can see.
--
-- NOT a DMS change. It affects every tenant, with or without the DMS, and it
-- was found while building the DMS rather than caused by it.
-- ============================================================

-- customer_visit_custom_values ───────────────────────────────
DROP POLICY IF EXISTS customer_visit_cv_all ON public.customer_visit_custom_values;
CREATE POLICY customer_visit_cv_all ON public.customer_visit_custom_values
  FOR ALL
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));

-- lead_visit_custom_values ───────────────────────────────────
DROP POLICY IF EXISTS lead_visit_cv_all ON public.lead_visit_custom_values;
CREATE POLICY lead_visit_cv_all ON public.lead_visit_custom_values
  FOR ALL
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));

-- dispatch_custom_values ─────────────────────────────────────
DROP POLICY IF EXISTS dispatch_cv_all ON public.dispatch_custom_values;
CREATE POLICY dispatch_cv_all ON public.dispatch_custom_values
  FOR ALL
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));

-- user_custom_values ─────────────────────────────────────────
DROP POLICY IF EXISTS user_cv_all ON public.user_custom_values;
CREATE POLICY user_cv_all ON public.user_custom_values
  FOR ALL
  USING (public.is_account_member(account_id))
  WITH CHECK (public.is_account_member(account_id));

-- RLS is already enabled on all four; stated again so a future table created
-- from this file as a template cannot ship without it.
ALTER TABLE public.customer_visit_custom_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_visit_custom_values     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_custom_values       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_custom_values           ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.user_custom_values IS
  'Custom field values for employees. Scoped by is_account_member(account_id) since 2026-11-14 — it was FOR ALL TO public USING (true), readable by the anon key.';
COMMENT ON TABLE public.customer_visit_custom_values IS
  'Custom field values for customer visits. Scoped by is_account_member(account_id) since 2026-11-14 — it was FOR ALL TO public USING (true).';
COMMENT ON TABLE public.lead_visit_custom_values IS
  'Custom field values for lead visits. Scoped by is_account_member(account_id) since 2026-11-14 — it was FOR ALL TO public USING (true).';
COMMENT ON TABLE public.dispatch_custom_values IS
  'Custom field values for dispatches. Scoped by is_account_member(account_id) since 2026-11-14 — it was FOR ALL TO public USING (true).';
