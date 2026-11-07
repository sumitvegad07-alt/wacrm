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

-- H8: re-granting a revoked seat must be COUNTED. Before the trigger cleared
-- portal_access_revoked_at, this UPDATE was allowed and the seat went uncounted.
-- DIST_C2 was revoked in H4; DIST_C still holds its seat. Depends on: seat
-- limit 5 and addon_lines = ['dms'], both set just before H7 (H6 empties them).
UPDATE public.contacts SET portal_access = true
 WHERE id = :DIST_C2;

SELECT qa('H8 a re-granted seat is counted and the revoked stamp is cleared',
  public.portal_seats_used(:ACCT) = 2
  AND (SELECT portal_access_revoked_at FROM public.contacts WHERE id = :DIST_C2) IS NULL,
  'seats_used=' || public.portal_seats_used(:ACCT)::text);

-- H9: stamping revoked_at straight onto a held seat revokes it, so the row
-- never reads "access on" while being uncounted. Depends on the same state as
-- H8: seat limit 5 and the DMS add-on, restored just before H7.
UPDATE public.contacts SET portal_access_revoked_at = now()
 WHERE id = :DIST_C2;

SELECT qa('H9 a revoked_at stamp on a held seat frees it and switches access off',
  public.portal_seats_used(:ACCT) = 1
  AND NOT (SELECT portal_access FROM public.contacts WHERE id = :DIST_C2),
  'seats_used=' || public.portal_seats_used(:ACCT)::text);

-- ── Safe paths: ordinary writes to contacts must never reach the guard ──
-- State here: DIST_C holds one seat, DIST_C2 is revoked, limit 5, DMS on,
-- order hierarchy on (so a new customer needs a level, per migration 076).
CREATE TEMP TABLE h_snap(k text PRIMARY KEY, n integer);
INSERT INTO h_snap VALUES ('before10', public.portal_seats_used(:ACCT));

SELECT qa_allowed('H10a an ordinary customer INSERT with no portal columns succeeds',
  'INSERT INTO public.contacts(id, account_id, user_id, name, company, phone, hierarchy_level) '
  'VALUES (''c1000000-0000-0000-0000-0000000000f1'', '
  || quote_literal(:ACCT) || ', ''11110000-0000-0000-0000-000000000001'', '
  '''Plain Customer'', ''Plain Co'', ''1100000091'', 3)');

SELECT qa('H10 that INSERT left the seat count unchanged',
  public.portal_seats_used(:ACCT) = (SELECT n FROM h_snap WHERE k = 'before10')
  AND EXISTS (SELECT 1 FROM public.contacts WHERE id = 'c1000000-0000-0000-0000-0000000000f1'),
  'before=' || (SELECT n FROM h_snap WHERE k = 'before10')::text
  || ' after=' || public.portal_seats_used(:ACCT)::text);

INSERT INTO h_snap VALUES ('before11', public.portal_seats_used(:ACCT));

SELECT qa_allowed('H11a renaming a customer that HOLDS a seat succeeds',
  'UPDATE public.contacts SET name = ''Mr DI renamed'' WHERE id = ' || quote_literal(:DIST_C));

SELECT qa('H11 and the seat is still held, count unchanged',
  public.portal_seats_used(:ACCT) = (SELECT n FROM h_snap WHERE k = 'before11')
  AND (SELECT name FROM public.contacts WHERE id = :DIST_C) = 'Mr DI renamed'
  AND (SELECT portal_access FROM public.contacts WHERE id = :DIST_C),
  'count=' || public.portal_seats_used(:ACCT)::text);

-- H12 only means something with the cap FULL (limit 1, used 1): then the
-- v_was_held early-return is the ONLY thing letting this write through. With
-- spare seats the cap check would pass and the test could not tell working
-- from broken. Do not "tidy" the limit away from 1 before H12.
UPDATE public.accounts SET portal_seats_limit = 1 WHERE id = :ACCT;

INSERT INTO h_snap VALUES ('before12', public.portal_seats_used(:ACCT));

SELECT qa_allowed('H12a a full-row style write of portal_access = true on a held seat succeeds',
  'UPDATE public.contacts SET name = ''Mr DI full row'', portal_access = true, '
  'portal_email = ''c@abc.com'', portal_user_id = ''00000000-0000-0000-0000-0000000000c1'', '
  'portal_access_revoked_at = NULL WHERE id = ' || quote_literal(:DIST_C));

SELECT qa('H12 it did not consume a second seat',
  public.portal_seats_used(:ACCT) = (SELECT n FROM h_snap WHERE k = 'before12')
  AND public.portal_seats_used(:ACCT) = 1,
  'count=' || public.portal_seats_used(:ACCT)::text);

-- H13: the cap is still full (limit 1, set before H12); a refused re-grant
-- must change NOTHING.

SELECT qa_refused('H13a re-granting a revoked customer is refused when the cap is full',
  'UPDATE public.contacts SET portal_access = true WHERE id = ' || quote_literal(:DIST_C2));

SELECT qa('H13 the refused re-grant left the revoked row exactly as it was',
  (SELECT portal_access_revoked_at FROM public.contacts WHERE id = :DIST_C2) IS NOT NULL
  AND NOT (SELECT portal_access FROM public.contacts WHERE id = :DIST_C2)
  AND public.portal_seats_used(:ACCT) = 1,
  'revoked stamp kept, access still off, count=' || public.portal_seats_used(:ACCT)::text);

UPDATE public.accounts SET portal_seats_limit = 5 WHERE id = :ACCT;

-- ── K: deleting a customer who placed a portal order ─────────
-- An order must outlive the customer who placed it. ON DELETE SET NULL: the
-- delete succeeds, the order stays, and its marker goes back to NULL. If the
-- FK ever reverts to NO ACTION, K1 fails (the delete is refused) and K2/K3
-- fail with it. Makes its own customer and order, so no earlier section depends on it.
\set K_CUST '''c1000000-0000-0000-0000-0000000000e1'''

INSERT INTO public.contacts(id, account_id, user_id, name, company, phone, hierarchy_level)
VALUES (:K_CUST, :ACCT, '11110000-0000-0000-0000-000000000001',
        'Portal Customer K', 'K Co', '1100000092', 3);

INSERT INTO public.orders(account_id, user_id, order_number, status, date, placed_by_portal_contact_id)
VALUES (:ACCT, '11110000-0000-0000-0000-000000000001', 'ORD-K1', 'Pending', '2026-03-02', :K_CUST);

SELECT qa_allowed('K1 deleting a customer who placed a portal order succeeds',
  'DELETE FROM public.contacts WHERE id = ' || quote_literal(:K_CUST));

SELECT qa('K2 the order survives the customer deletion',
  EXISTS (SELECT 1 FROM public.orders WHERE account_id = :ACCT AND order_number = 'ORD-K1'),
  'ORD-K1 is missing');

SELECT qa('K3 its placed_by_portal_contact_id is now NULL',
  (SELECT placed_by_portal_contact_id IS NULL FROM public.orders
    WHERE account_id = :ACCT AND order_number = 'ORD-K1'),
  'marker not cleared');
