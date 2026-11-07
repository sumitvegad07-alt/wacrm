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
  (SELECT portal_seats_limit FROM public.accounts WHERE id = :ACCT) = 0,
  'an account that has not bought seats holds exactly 0');

SELECT qa_refused('G8 an unknown add-on name is refused by the CHECK',
  'UPDATE public.accounts SET addon_lines = ARRAY[''foo''] WHERE id = ' || quote_literal(:ACCT));

-- ── H: portal identity and the seat cap ──────────────────────
\set DIST_C  '''c1000000-0000-0000-0000-00000000000c'''
\set DIST_C2 '''c1000000-0000-0000-0000-00000000000f'''

-- Portal customers are auth.users rows only (no profiles row). The signup
-- trigger is switched off here exactly as the fixture does.
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-0000-0000-0000000000c1', 'c@abc.com'),
 ('00000000-0000-0000-0000-0000000000c2', 'c2@abc.com'),
 ('00000000-0000-0000-0000-0000000000c3', 'shop1@abc.com')
ON CONFLICT (id) DO NOTHING;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

UPDATE public.accounts
   SET addon_lines = ARRAY['dms'], portal_seats_limit = 1
 WHERE id = :ACCT;

UPDATE public.contacts
   SET portal_email = 'c@abc.com',
       portal_user_id = '00000000-0000-0000-0000-0000000000c1',
       portal_access = true
 WHERE id = :DIST_C;

SELECT qa('H1 one login is counted as one seat used',
  public.portal_seats_used(:ACCT) = 1, 'seat accounting');

SELECT qa_refused('H2 the seat cap is enforced by the DATABASE, not the form',
  'UPDATE public.contacts SET portal_email = ''c2@abc.com'', '
  'portal_user_id = ''00000000-0000-0000-0000-0000000000c2'', '
  'portal_access = true WHERE id = ' || quote_literal(:DIST_C2));

UPDATE public.accounts SET portal_seats_limit = 2 WHERE id = :ACCT;

SELECT qa_allowed('H3 raising the limit lets the next login in',
  'UPDATE public.contacts SET portal_email = ''c2@abc.com'', '
  'portal_user_id = ''00000000-0000-0000-0000-0000000000c2'', '
  'portal_access = true WHERE id = ' || quote_literal(:DIST_C2));

-- Revoking frees the seat, and does not delete anything.
UPDATE public.contacts
   SET portal_access = false, portal_access_revoked_at = now()
 WHERE id = :DIST_C2;

SELECT qa('H4 revoking frees the seat but keeps the login on record',
  public.portal_seats_used(:ACCT) = 1
  AND (SELECT portal_user_id FROM public.contacts WHERE id = :DIST_C2) IS NOT NULL,
  'access off, history kept');

SELECT qa_refused('H5 two customers cannot share one login email',
  'UPDATE public.contacts SET portal_email = ''c@abc.com'' WHERE id = ' || quote_literal(:DIST_C2));

-- An account that never bought the DMS cannot have a login at all. Aimed at
-- DIST_C2, whose access was revoked in H4, so OLD.portal_access is false and
-- the trigger's "already held a seat" early-return cannot short-circuit it.
UPDATE public.accounts SET addon_lines = '{}', portal_seats_limit = 0 WHERE id = :ACCT;

SELECT qa_refused('H6 no add-on, no login',
  'UPDATE public.contacts SET portal_access = true WHERE id = ' || quote_literal(:DIST_C2));

UPDATE public.accounts SET addon_lines = ARRAY['dms'], portal_seats_limit = 5
 WHERE id = :ACCT;

-- H7: migration 076 refuses ANY update to a customer with no hierarchy_level
-- while order hierarchy is on. Granting portal access is such an update, and
-- the ruling is that a customer at any level may be given a login. Seats and
-- the add-on are available here, so any refusal is 076's, not ours.
UPDATE public.accounts
   SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb),
                            '{order_settings,hierarchy_enabled}', 'true'::jsonb, true)
 WHERE id = :ACCT;

SELECT qa('H7a precondition: hierarchy on, and the customer has no level',
  COALESCE((SELECT (settings->'order_settings'->>'hierarchy_enabled')::boolean
              FROM public.accounts WHERE id = :ACCT), false)
  AND (SELECT hierarchy_level FROM public.contacts
        WHERE id = 'c0000000-0000-0000-0000-000000000001') IS NULL,
  'Shop One has hierarchy_level NULL');

-- Recorded as a documented LIMITATION: this passes while 076 refuses, and
-- fails the day someone makes it possible (then re-read the founder's ruling).
SELECT qa_refused('H7 KNOWN LIMITATION: level-less customer cannot get a login while hierarchy is on',
  'UPDATE public.contacts SET portal_access = true, '
  'portal_email = ''shop1@abc.com'', '
  'portal_user_id = ''00000000-0000-0000-0000-0000000000c3'' '
  'WHERE id = ''c0000000-0000-0000-0000-000000000001''');
