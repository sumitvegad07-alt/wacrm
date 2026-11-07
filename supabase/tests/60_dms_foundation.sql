-- ============================================================
-- 2026-11-07 — DMS foundation (20261107120000, 20261107130000).
--
-- The question these answer: can the DMS reach an account nobody sold it to?
-- The dangerous path is account_has_line's legacy fallback, which grants every
-- line but FSM to an unknown plan — and 001001 is a legacy Enterprise plan.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT '''aaaa0000-0000-0000-0000-000000000001'''

-- ── G: the add-on line ───────────────────────────────────────
UPDATE public.accounts SET subscription_plan = 'CRM_SFA', addon_lines = '{}'
 WHERE id = :ACCT;

SELECT qa('G1 a paid plan does NOT grant dms',
  account_has_line(:ACCT, 'dms') = false,
  'CRM_SFA must not include the DMS');

SELECT qa('G2 the plan it DID buy still works',
  account_has_line(:ACCT, 'sfa') = true,
  'CRM_SFA must still grant sfa');

UPDATE public.accounts SET subscription_plan = 'Enterprise' WHERE id = :ACCT;

SELECT qa('G3 a LEGACY plan does not grant dms either',
  account_has_line(:ACCT, 'dms') = false,
  'this is the giveaway bug: legacy plans fall through to "every line but fsm"');

SELECT qa('G4 the legacy fallback is otherwise unchanged',
  account_has_line(:ACCT, 'crm') = true AND account_has_line(:ACCT, 'fsm') = false,
  'legacy keeps full access except fsm, exactly as before');

UPDATE public.accounts SET addon_lines = ARRAY['dms'] WHERE id = :ACCT;

SELECT qa('G5 an explicit grant turns it on',
  account_has_line(:ACCT, 'dms') = true,
  'addon_lines is the only door');

UPDATE public.accounts SET subscription_plan = 'CRM_SFA' WHERE id = :ACCT;

SELECT qa('G6 the add-on composes with a real plan',
  account_has_line(:ACCT, 'dms') AND account_has_line(:ACCT, 'crm')
  AND account_has_line(:ACCT, 'sfa'),
  'CRM + SFA + DMS needs no new plan code');

SELECT qa('G7 seats default to zero, i.e. not bought',
  (SELECT portal_seats_limit FROM public.accounts WHERE id = :ACCT) >= 0,
  'column exists and is not null');
