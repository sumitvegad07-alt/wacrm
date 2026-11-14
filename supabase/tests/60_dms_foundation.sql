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
-- Seats are deliberately SPARE (limit 5, one used): with the allowance at 0 the
-- cap check would also refuse, and deleting the add-on check from the trigger
-- would go unnoticed. Here ONLY the add-on check can refuse this write.
UPDATE public.accounts SET addon_lines = '{}', portal_seats_limit = 5 WHERE id = :ACCT;

SELECT qa_refused('H6 no add-on, no login',
  'UPDATE public.contacts SET portal_access = true WHERE id = ' || quote_literal(:DIST_C2));

SELECT qa('H6-msg the H6 refusal is the add-on guard (its own sentence), not the seat cap',
  (SELECT count(*) FROM qa_results
    WHERE scenario = 'H6 no add-on, no login' AND pass
      AND detail LIKE '%does not have the DMS%') = 1,
  coalesce((SELECT detail FROM qa_results WHERE scenario = 'H6 no add-on, no login'), 'none recorded'));

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
-- H8: seat limit 5 and the DMS add-on, restored just before H7 (H6 leaves the add-on off).
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

-- H14-H16: portal_seats_used is SECURITY DEFINER and granted to authenticated,
-- so it must not hand one company's count to another. State here: DIST_C holds
-- exactly one seat (see H13). Staff of A and staff of B are both signed in as
-- ordinary users; the service role is the superadmin route.
RESET ROLE;
SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
SELECT qa('H14 a member of the account gets the real login count',
  public.portal_seats_used(:ACCT) = 1,
  'member saw ' || public.portal_seats_used(:ACCT)::text || ', expected 1');

RESET ROLE;
SELECT set_config('test.uid', '22220000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
SELECT qa('H15 a user from ANOTHER account gets 0, not the count',
  public.portal_seats_used(:ACCT) = 0,
  'outsider saw ' || public.portal_seats_used(:ACCT)::text || ', expected 0');

RESET ROLE;
GRANT SELECT, INSERT ON qa_results TO service_role;
GRANT USAGE, SELECT ON SEQUENCE qa_results_id_seq TO service_role;
SET ROLE service_role;
SELECT qa('H16 the service role gets the real count for any account',
  public.portal_seats_used(:ACCT) = 1,
  'service role saw ' || public.portal_seats_used(:ACCT)::text || ', expected 1');
RESET ROLE;

-- H17: the seat cap as the role it exists to stop. Everything above ran as the
-- file owner. portal_seats_used returns 0 to non-members, which the trigger
-- reads as "none used", so the cap is only right if every writer is a member
-- (or the service role). Uid 1111...0001 is the account-A admin (the same uid
-- H14 uses as a member). The cap is made FULL first (limit 1, DIST_C holds it).
-- If RLS filtered the row the UPDATE would raise nothing and this scenario
-- FAILS: fix the uid, never the guard.
RESET ROLE;
UPDATE public.accounts SET portal_seats_limit = 1 WHERE id = :ACCT;
SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
SELECT qa_refused('H17 the seat cap refuses a grant when run as an authenticated account admin',
  'UPDATE public.contacts SET portal_email = ''c2@abc.com'', '
  'portal_user_id = ''00000000-0000-0000-0000-0000000000c2'', '
  'portal_access = true WHERE id = ' || quote_literal(:DIST_C2));
RESET ROLE;
SELECT qa('H17-msg that refusal is the cap''s own sentence, and nothing was granted',
  (SELECT count(*) FROM qa_results
    WHERE scenario LIKE 'H17 %' AND pass
      -- H17 sets the limit to 1, so the cap answers in the SINGULAR since
      -- 20261108100000. Both wordings are listed because either is the cap
      -- speaking, and neither is the add-on guard's sentence.
      AND (detail LIKE '%portal logins are in use%'
        OR detail LIKE '%only portal login is in use%')) = 1
  AND NOT (SELECT portal_access FROM public.contacts WHERE id = :DIST_C2),
  coalesce((SELECT detail FROM qa_results WHERE scenario LIKE 'H17 %'), 'none recorded'));
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

-- ── J: a tenant admin cannot sell themselves a plan ──────────
-- accounts_update is row-level only, so before 20261107150000 any tenant admin
-- could PATCH their own plan, add-ons, seats and expiry. J1-J4 are that hole.
-- J7 is the safety case: the founder's superadmin panel writes with the service
-- role, and triggers still fire for it. If J7 fails, the guard has locked the
-- founder out of his own billing screen: do not weaken the guard to pass it.
--
-- qa_refused passes on ANY error, so J-msg also asserts that every refusal
-- carries the guard's own sentence, not a syntax error or some other failure.
\set ADMIN '''11110000-0000-0000-0000-000000000001'''
RESET ROLE;
SELECT set_config('test.uid', :ADMIN, false);
UPDATE public.accounts SET subscription_plan = 'CRM', subscription_status = 'active',
       subscription_expires_at = '2027-01-01', addon_lines = '{}', portal_seats_limit = 5,
       user_count = 3, addons = '{}'
 WHERE id = :ACCT;

SET ROLE authenticated;

SELECT qa_refused('J1 a tenant admin cannot grant themselves the dms add-on',
  'UPDATE public.accounts SET addon_lines = ARRAY[''dms''] WHERE id = ' || quote_literal(:ACCT));
SELECT qa_refused('J2 a tenant admin cannot raise their own seat allowance',
  'UPDATE public.accounts SET portal_seats_limit = 9999 WHERE id = ' || quote_literal(:ACCT));
SELECT qa_refused('J3 a tenant admin cannot change their own plan',
  'UPDATE public.accounts SET subscription_plan = ''CRM_SFA'' WHERE id = ' || quote_literal(:ACCT));
SELECT qa_refused('J4 a tenant admin cannot extend their own expiry',
  'UPDATE public.accounts SET subscription_expires_at = ''2099-01-01'' WHERE id = ' || quote_literal(:ACCT));
SELECT qa_refused('J4b a tenant admin cannot reactivate their own subscription status',
  'UPDATE public.accounts SET subscription_status = ''trialing'' WHERE id = ' || quote_literal(:ACCT));
SELECT qa_refused('J4d a tenant admin cannot raise their own paid user limit (user_count)',
  'UPDATE public.accounts SET user_count = 9999 WHERE id = ' || quote_literal(:ACCT));
SELECT qa_refused('J4e a tenant admin cannot grant themselves addons',
  'UPDATE public.accounts SET addons = ARRAY[''x''] WHERE id = ' || quote_literal(:ACCT));
SELECT qa_refused('J4c a guarded column hidden inside an otherwise innocent update is still refused',
  'UPDATE public.accounts SET name = ''Sneaky'', portal_seats_limit = 9999 WHERE id = ' || quote_literal(:ACCT));

SELECT qa('J-msg every J1-J4e refusal is the guard (its own sentence), not some other error',
  (SELECT count(*) FROM qa_results
    WHERE id > (SELECT max(id) FROM qa_results WHERE scenario LIKE 'J1 %') - 1
      AND scenario ~ '^J(1|2|3|4|4b|4c|4d|4e) ' AND pass
      AND detail LIKE '%are set by OZZO%') = 8,
  coalesce((SELECT string_agg(scenario || ' => ' || detail, ' | ') FROM qa_results
             WHERE scenario ~ '^J(1|2|3|4|4b|4c|4d|4e) '), 'none recorded'));

SELECT qa_allowed('J5 a tenant admin can still rename their own account',
  'UPDATE public.accounts SET name = ''Renamed by its admin'' WHERE id = ' || quote_literal(:ACCT));
SELECT qa('J5b the rename really landed (a 0-row RLS-filtered update would also read as allowed)',
  (SELECT name FROM public.accounts WHERE id = :ACCT) = 'Renamed by its admin', 'name unchanged');

SELECT qa_allowed('J6 a tenant admin can still change module_settings',
  'UPDATE public.accounts SET module_settings = ''{"j6":true}''::jsonb WHERE id = ' || quote_literal(:ACCT));
SELECT qa('J6b the module_settings change really landed',
  (SELECT module_settings->>'j6' FROM public.accounts WHERE id = :ACCT) = 'true', 'not written');

SELECT qa_allowed('J6c a full-row write that re-sends the SAME plan values is not blocked',
  'UPDATE public.accounts SET subscription_plan = subscription_plan, '
  'subscription_status = subscription_status, addon_lines = addon_lines, '
  'portal_seats_limit = portal_seats_limit, subscription_expires_at = subscription_expires_at '
  'WHERE id = ' || quote_literal(:ACCT));

SELECT qa('J-hold the refused attempts changed nothing',
  (SELECT subscription_plan = 'CRM' AND subscription_status = 'active'
      AND addon_lines = '{}' AND portal_seats_limit = 5
      AND user_count = 3 AND addons = '{}'
      AND subscription_expires_at = '2027-01-01'
     FROM public.accounts WHERE id = :ACCT),
  'a commercial column moved');

-- J7: the service role, exactly as the superadmin panel connects.
RESET ROLE;
-- service_role needs the same qa_results grants the fixture gives authenticated, or the
-- scenario is recorded as 'permission denied' and the file aborts.
GRANT SELECT, INSERT ON qa_results TO service_role;
GRANT USAGE, SELECT ON SEQUENCE qa_results_id_seq TO service_role;
SET ROLE service_role;
SELECT qa_allowed('J7 the service role can still set plan, add-on, seats, status and expiry together',
  'UPDATE public.accounts SET subscription_plan = ''CRM_SFA'', addon_lines = ARRAY[''dms''], '
  'portal_seats_limit = 100, subscription_status = ''active'', '
  'subscription_expires_at = ''2030-01-01'', user_count = 50, addons = ARRAY[''x''] WHERE id = ' || quote_literal(:ACCT));
SELECT qa('J7c the service role really set user_count and addons',
  (SELECT user_count = 50 AND addons = ARRAY['x'] FROM public.accounts WHERE id = :ACCT),
  'service-role write of user_count/addons did not land');
RESET ROLE;
SELECT qa('J7b the service-role write really landed',
  (SELECT subscription_plan = 'CRM_SFA' AND addon_lines = ARRAY['dms'] AND portal_seats_limit = 100
      AND subscription_expires_at = '2030-01-01'
     FROM public.accounts WHERE id = :ACCT),
  'service-role write did not land');

-- J8: the table owner (SQL editor, migrations, a cron job running as postgres).
SELECT qa_allowed('J8 the owner role (SQL editor, migrations, cron) can still change them',
  'UPDATE public.accounts SET subscription_plan = ''CRM'', addon_lines = ''{}'', portal_seats_limit = 5 WHERE id = '
  || quote_literal(:ACCT));

-- J9: a platform superadmin with an ordinary user session.
UPDATE public.profiles SET is_superadmin = true WHERE user_id = :ADMIN;
SET ROLE authenticated;
SELECT qa_allowed('J9 a platform superadmin signed in as a user can change the plan',
  'UPDATE public.accounts SET subscription_plan = ''CRM_SFA'' WHERE id = ' || quote_literal(:ACCT));
RESET ROLE;
UPDATE public.profiles SET is_superadmin = false WHERE user_id = :ADMIN;
SELECT qa('J9b the superadmin write really landed',
  (SELECT subscription_plan FROM public.accounts WHERE id = :ACCT) = 'CRM_SFA', 'not written');
-- Leave the account as section G left it.
UPDATE public.accounts SET subscription_plan = 'CRM_SFA', addon_lines = ARRAY['dms'], portal_seats_limit = 5, user_count = 3, addons = '{}'
 WHERE id = :ACCT;


-- -- L: one login per customer, and who may change a login ----
--
-- Deleting trg_guard_contact_portal_columns must make L3, L4, L5 and L7 fail.
-- Deleting contacts_portal_user_unique_idx must make L1b fail.
-- L2, L6 and L8 are non-regression: contacts is the busiest table in the
-- product and 2026-11-04's incident was a guard on it refusing an unrelated
-- write and taking the order save down.
--
-- THREE DEVIATIONS FROM THE PLAN'S DRAFT, each because the draft's scenario
-- would have passed for the wrong reason -- which is the fault this file
-- exists to prevent:
--   a) the draft worked on Shop One (c0000000-...-0001). Section H7 switches
--      order hierarchy ON and leaves it on, and Shop One has hierarchy_level
--      NULL, so migration 076 refuses EVERY write to it. L1 would have failed
--      and L5 would have passed without the guard. Section L uses 'Plain
--      Customer' (c1000000-...-00f1, level 3, inserted by H10a) instead.
--   b) the draft's "free" auth id in L1 was ...0000c1, which DIST_C already
--      holds, so L1 and L1b were the same write. L1 uses ...0000c3, minted by
--      section H and never attached (H7 was refused).
--   c) the draft's L4 pointed at ...0000ff, which is in no auth.users row, so
--      the FK would have refused it with the guard deleted. L4 uses a fresh
--      auth user that no customer holds, so only the guard can refuse.

\set PLAIN   '''c1000000-0000-0000-0000-0000000000f1'''
\set FREE_U  '''00000000-0000-0000-0000-0000000000c3'''
\set SPARE_U '''00000000-0000-0000-0000-0000000000c4'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN, false);
UPDATE public.accounts SET addon_lines = ARRAY['dms'], portal_seats_limit = 5 WHERE id = :ACCT;

-- A login id for L4 that no customer holds, so the unique index cannot be what
-- refuses that write.
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
INSERT INTO auth.users(id, email) VALUES (:SPARE_U, 'c4@abc.com') ON CONFLICT (id) DO NOTHING;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

SELECT qa('L0 precondition: the target has a level, spare seats, and no login',
  (SELECT hierarchy_level IS NOT NULL AND portal_user_id IS NULL
     FROM public.contacts WHERE id = :PLAIN)
  AND public.portal_seats_used(:ACCT) < 5
  AND public.account_has_line(:ACCT, 'dms'),
  'L1 and L5 must be able to succeed on their own merits, or they test nothing');

-- L1: a FREE auth user id is accepted by the index, as the service role. This
-- is the control that proves L1b's refusal is about the duplicate and not about
-- the column guard or some unrelated failure.
SELECT qa_allowed('L1 the service role may link a customer to a free login id',
  'SET LOCAL ROLE service_role;'
  || ' UPDATE public.contacts SET portal_user_id = ' || quote_literal(:FREE_U)
  || ' WHERE id = ' || quote_literal(:PLAIN));
RESET ROLE;

SELECT qa('L1c and that link really landed',
  (SELECT portal_user_id FROM public.contacts WHERE id = :PLAIN) = :FREE_U,
  'if L1 reported PASS without writing, L1b would be refused by nothing at all');

-- L1b: now point PLAIN at the SAME auth user DIST_C already uses. Still the
-- service role, so only the unique index can refuse it.
SELECT qa_refused('L1b two customers cannot share one portal login',
  'SET LOCAL ROLE service_role;'
  || ' UPDATE public.contacts SET portal_user_id = (SELECT portal_user_id FROM public.contacts WHERE id = '
  || quote_literal(:DIST_C) || ') WHERE id = ' || quote_literal(:PLAIN));
RESET ROLE;

-- L2: the service role still writes the login columns. This is the
-- portal-access route's own path; if it broke, no login could be created again.
SELECT qa_allowed('L2 the service role still sets a login email',
  'SET LOCAL ROLE service_role;'
  || ' UPDATE public.contacts SET portal_email = ''l2@abc.com'''
  || ' WHERE id = ' || quote_literal(:DIST_C));
RESET ROLE;

-- L3: the attack. A tenant ADMIN rewrites the displayed login address through
-- the API. Sign-in would still use the real auth.users email, so the customer
-- page would show an address nobody can sign in with.
SELECT set_config('test.uid', :ADMIN, false);
SET ROLE authenticated;
SELECT qa_refused('L3 a tenant admin cannot rewrite the displayed login email',
  'UPDATE public.contacts SET portal_email = ''hijack@abc.com'''
  || ' WHERE id = ' || quote_literal(:DIST_C));

SELECT qa('L3-msg the L3 refusal is the portal-column guard, in its own words',
  (SELECT count(*) FROM qa_results
    WHERE scenario = 'L3 a tenant admin cannot rewrite the displayed login email'
      -- qa_refused records left(SQLERRM, 70), and "Use Provide DMS Access"
      -- falls past character 70. Match a phrase inside the window that still
      -- belongs to no other refusal on this table.
      AND pass AND detail LIKE '%changed on the customer page%') = 1,
  coalesce((SELECT detail FROM qa_results
             WHERE scenario = 'L3 a tenant admin cannot rewrite the displayed login email'),
           'none recorded'));

-- L4: the worse version of L3 -- repointing the login at another auth user.
SELECT qa_refused('L4 a tenant admin cannot repoint a login at another user',
  'UPDATE public.contacts SET portal_user_id = ' || quote_literal(:SPARE_U)
  || ' WHERE id = ' || quote_literal(:DIST_C));

-- L5: and cannot grant access by hand, bypassing the route entirely.
SELECT qa_refused('L5 a tenant admin cannot switch portal access on directly',
  'UPDATE public.contacts SET portal_access = true, portal_email = ''byhand@abc.com'''
  || ' WHERE id = ' || quote_literal(:PLAIN));

-- L6: THE NON-REGRESSION THAT MATTERS. An ordinary admin edit to a customer
-- that HOLDS a login must still work. If the comparison-first ordering were
-- removed, this would fail and every customer edit on a DMS tenant would break.
SELECT qa_allowed('L6 an ordinary name edit on a customer WITH a login still works',
  'UPDATE public.contacts SET name = ''Dist C renamed'' WHERE id = ' || quote_literal(:DIST_C));

-- L7: an INSERT carrying a login is refused for an end-user role too, otherwise
-- the admin simply creates the customer with the login already attached.
-- hierarchy_level is supplied because H7 left order hierarchy ON, and migration
-- 076 would otherwise refuse this insert whether the guard existed or not.
SELECT qa_refused('L7 a tenant admin cannot create a customer with a login attached',
  'INSERT INTO public.contacts (account_id, user_id, name, phone, hierarchy_level, portal_email, portal_access)'
  || ' VALUES (' || quote_literal(:ACCT) || ', ' || quote_literal(:ADMIN)
  || ', ''Smuggled'', ''1999999999'', 3, ''smuggle@abc.com'', true)');

-- L8: an ordinary new customer, with no portal columns at all, still inserts --
-- as the same role, in the same breath, so L7 cannot be passing merely because
-- an admin may not insert a customer at all.
SELECT qa_allowed('L8 an ordinary new customer still inserts',
  'INSERT INTO public.contacts (account_id, user_id, name, phone, hierarchy_level)'
  || ' VALUES (' || quote_literal(:ACCT) || ', ' || quote_literal(:ADMIN)
  || ', ''Ordinary L8'', ''1999999998'', 3)');

RESET ROLE;
DELETE FROM public.contacts WHERE account_id = :ACCT AND name = 'Ordinary L8';
-- Leave the fixture exactly as section H left it: H11a renamed DIST_C to
-- 'Mr DI renamed', and its login email was 'c@abc.com' until L2.
UPDATE public.contacts SET name = 'Mr DI renamed' WHERE id = :DIST_C;
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_email = 'c@abc.com' WHERE id = :DIST_C;
-- And leave PLAIN without a login, so later files see the fixture they expect.
UPDATE public.contacts SET portal_user_id = NULL WHERE id = :PLAIN;
RESET ROLE;
