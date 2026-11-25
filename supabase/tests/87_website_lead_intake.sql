-- ============================================================
-- 2026-11-25 — Website leads land in the Partner Portal
--              (migration 20261127120000_website_leads_to_partner_portal)
--
-- The one thing these scenarios exist to prove: a stranger filling in a form
-- on ozzo.co.in ends up as a lead somebody owns, with source "Website", and
-- NOTHING about the portal end of that can ever fail their submission.
--
-- The shape built below:
--
--   QAW Admin  (Super Admin,      active)  ─ the fallback owner
--   QAW Exec   (Sales Executive,  active)  ─ the one chosen in Settings
--
-- Establishes its own state. Runs last, and puts back everything it changes
-- on the way through.
--
-- The grant below is not test scaffolding: Supabase grants the anon role
-- INSERT on this table and relies on the policy for the gate, and a bare
-- PostgreSQL grants nothing — so without it every scenario here fails with
-- "permission denied for table website_inquiries" before a policy is ever
-- consulted, which reads as a broken migration.
-- ============================================================
\set ON_ERROR_STOP on

\set ADMIN '''a0000000-0000-0000-0000-0000000000a1'''
\set EXECU '''a0000000-0000-0000-0000-0000000000a2'''

\set INQ_FORM   '''c0000000-0000-0000-0000-0000000000c1'''
\set INQ_AGAIN  '''c0000000-0000-0000-0000-0000000000c2'''
\set INQ_QUOTE  '''c0000000-0000-0000-0000-0000000000c3'''
\set INQ_NOBODY '''c0000000-0000-0000-0000-0000000000c4'''
\set INQ_BOOM   '''c0000000-0000-0000-0000-0000000000c5'''

RESET ROLE;
SELECT set_config('test.uid', '', false);

GRANT INSERT ON public.website_inquiries TO anon;

-- ── A known starting point ───────────────────────────────────
DELETE FROM public.partner_module_activities
 WHERE record_id IN (SELECT id FROM public.partner_leads
                      WHERE name LIKE 'QAW %' OR name = 'Nilesh Shah');
DELETE FROM public.website_inquiries WHERE phone LIKE '%98888%';
DELETE FROM public.partner_leads     WHERE name LIKE 'QAW %' OR name = 'Nilesh Shah';
DELETE FROM public.partner_employees WHERE email LIKE '%@intake.test';
DELETE FROM auth.users               WHERE email LIKE '%@intake.test';
UPDATE public.partner_intake_settings SET website_lead_owner_id = NULL WHERE id;

-- skip_account_provision, exactly as app/api/employees/route.ts passes it:
-- without it the AFTER INSERT trigger on auth.users provisions a whole tenant
-- per person. See 80_partner_rights.sql.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:ADMIN, 'admin@intake.test', '{"skip_account_provision":"true"}'::jsonb),
  (:EXECU, 'exec@intake.test',  '{"skip_account_provision":"true"}'::jsonb);

INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :ADMIN, 'QAW Admin', 'admin@intake.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Super Admin';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :EXECU, 'QAW Exec', 'exec@intake.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';

-- Settings points at the executive, so every scenario below has one right
-- answer for "who owns it" rather than whoever happens to be oldest.
UPDATE public.partner_intake_settings
   SET website_lead_owner_id = (SELECT id FROM public.partner_employees
                                 WHERE email = 'exec@intake.test')
 WHERE id;

SELECT qa('W0 the pipeline is installed',
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_website_inquiries_to_portal' AND NOT tgisinternal) = 1
  AND to_regclass('public.partner_intake_settings') IS NOT NULL,
  'trigger + settings table');

-- ── 1. The demo form ────────────────────────────────────────
-- Inserted as anon, which is what a stranger on the marketing site is.
SET ROLE anon;
INSERT INTO public.website_inquiries
  (id, name, company, email, phone, team_size, message, source, page_path, created_at)
VALUES
  (:INQ_FORM, 'Ramesh Patel', 'QAW Alpha Steels', 'RAMESH@alpha.test',
   '+91 98888 10001', '10-25', 'Need field tracking for 12 reps', 'website',
   '/book-demo', '2026-10-01 09:30:00+05:30');
RESET ROLE;

SELECT qa('W1 a website form becomes exactly one lead, source Website',
  (SELECT count(*) FROM public.partner_leads
    WHERE name = 'QAW Alpha Steels' AND source = 'Website') = 1,
  'one lead, source Website');

SELECT qa('W2 the company is the lead name and the person is the contact',
  (SELECT contact_person FROM public.partner_leads WHERE name = 'QAW Alpha Steels')
    = 'Ramesh Patel',
  'contact_person = the person who filled it in');

SELECT qa('W3 the number is on both phone and WhatsApp, and the email is lower-cased',
  (SELECT phone = '+91 98888 10001' AND whatsapp = '+91 98888 10001'
          AND email = 'ramesh@alpha.test'
     FROM public.partner_leads WHERE name = 'QAW Alpha Steels'),
  'the first thing anybody does with one of these is message it');

-- A rescued lead from six weeks ago must not arrive looking like today's.
SELECT qa('W4 the lead is dated when the visitor pressed send, not when this ran',
  (SELECT created_at FROM public.partner_leads WHERE name = 'QAW Alpha Steels')
    = '2026-10-01 09:30:00+05:30'::timestamptz,
  'created_at comes from the enquiry');

SELECT qa('W5 Settings decides who owns it',
  (SELECT l.owner_id FROM public.partner_leads l WHERE l.name = 'QAW Alpha Steels')
    = (SELECT id FROM public.partner_employees WHERE email = 'exec@intake.test'),
  'the person chosen in Settings');

SELECT qa('W6 what the portal has no column for is in the notes',
  (SELECT notes LIKE '%Team size: 10-25%'
              AND notes LIKE '%Need field tracking for 12 reps%'
              AND notes LIKE '%/book-demo%'
     FROM public.partner_leads WHERE name = 'QAW Alpha Steels'),
  'team size, what they wrote, and the page they were on');

SELECT qa('W7 the raw enquiry says what became of it, in plain English',
  (SELECT partner_lead_id IS NOT NULL AND portal_note = 'In the portal as a new lead.'
     FROM public.website_inquiries WHERE id = :INQ_FORM),
  'partner_lead_id + portal_note');

SELECT qa('W8 the lead opens with a timeline entry nobody signed',
  (SELECT count(*) FROM public.partner_module_activities a
     JOIN public.partner_leads l ON l.id = a.record_id
    WHERE l.name = 'QAW Alpha Steels' AND a.action = 'created'
      AND a.user_id IS NULL
      AND a.details ->> 'website_inquiry_id' = :INQ_FORM) = 1,
  'user_id null: the website did it, not a person');

-- ── 2. The same person again, number typed differently ──────
-- One lead with two enquiries against it, not two people to ring.
SET ROLE anon;
INSERT INTO public.website_inquiries
  (id, name, company, phone, source, page_path, created_at)
VALUES
  (:INQ_AGAIN, 'Ramesh Patel', 'QAW Alpha Steels', '098888 10001', 'website',
   '/plans', '2026-10-03 11:00:00+05:30');
RESET ROLE;

SELECT qa('W9 the same number does not make a second lead',
  (SELECT count(*) FROM public.partner_leads WHERE name = 'QAW Alpha Steels') = 1,
  '+91 98888 10001 and 098888 10001 are one number to a person');

SELECT qa('W10 the second enquiry is folded into the first lead and says so',
  (SELECT i.partner_lead_id = l.id
          AND i.portal_note LIKE 'Added to the lead that already had this number%'
     FROM public.website_inquiries i, public.partner_leads l
    WHERE i.id = :INQ_AGAIN AND l.name = 'QAW Alpha Steels'),
  'pointed at the lead it joined');

SELECT qa('W11 and it is visible on that lead''s timeline',
  (SELECT count(*) FROM public.partner_module_activities a
     JOIN public.partner_leads l ON l.id = a.record_id
    WHERE l.name = 'QAW Alpha Steels' AND a.action = 'note'
      AND a.message LIKE '%Another enquiry from the website%') = 1,
  'otherwise the second enquiry is invisible');

-- ── 3. The price calculator ─────────────────────────────────
-- A different form, a different source label on the site, the same channel to
-- whoever rings them back.
SET ROLE anon;
INSERT INTO public.website_inquiries
  (id, name, phone, product_interest, team_size, message, source, page_path)
VALUES
  (:INQ_QUOTE, 'Nilesh Shah', '98888 20002', 'CRM + SFA · Yearly', '26-50',
   'Yearly, 30 users', 'quote-calculator', '/plans');
RESET ROLE;

SELECT qa('W12 a calculator lead is source Website too, with the quote on it',
  (SELECT source = 'Website'
              AND notes LIKE '%Interested in: CRM + SFA · Yearly%'
              AND notes LIKE '%Form: quote-calculator%'
     FROM public.partner_leads WHERE name = 'Nilesh Shah'),
  'one source in the portal; which form it was is in the notes');

SELECT qa('W13 with no company given, the person''s name is the lead',
  (SELECT contact_person IS NULL
     FROM public.partner_leads WHERE name = 'Nilesh Shah'),
  'contact_person is dropped rather than repeating the name');

-- ── 4. Who owns it when Settings points at nobody ───────────
UPDATE public.partner_intake_settings SET website_lead_owner_id = NULL WHERE id;
UPDATE public.partner_employees SET status = 'inactive' WHERE email = 'exec@intake.test';

SET ROLE anon;
INSERT INTO public.website_inquiries (name, company, phone, source)
VALUES ('Fallback Test', 'QAW Fallback Ltd', '98888 30003', 'website');
RESET ROLE;

SELECT qa('W14 with nobody chosen, an active administrator gets it',
  (SELECT r.permissions -> 'all' = 'true'::jsonb AND e.status = 'active'
     FROM public.partner_leads l
     JOIN public.partner_employees e ON e.id = l.owner_id
     JOIN public.partner_roles r     ON r.id = e.role_id
    WHERE l.name = 'QAW Fallback Ltd'),
  'never unowned, and never owned by somebody deactivated');

-- ── 5. The rule that matters more than all the others ───────
-- A submission must never fail because of the portal end.
--
-- Two different failures, because they take different paths through the
-- code: nobody to own the lead (handled, no exception) and the lead insert
-- itself being refused (the exception handler). An untested exception
-- handler is not a handler.

-- 5a. Nobody at all to own it.
CREATE TEMP TABLE qaw_was_active AS
  SELECT id FROM public.partner_employees WHERE status = 'active';
UPDATE public.partner_employees SET status = 'inactive' WHERE status = 'active';

SET ROLE anon;
SELECT qa_allowed('W15 a visitor can still submit when there is nobody to own it',
  format('INSERT INTO public.website_inquiries (id, name, company, phone, source)
            VALUES (%L::uuid, %L, %L, %L, %L)',
         :INQ_NOBODY, 'Nobody Home', 'QAW Orphan Ltd', '98888 40004', 'website'));
RESET ROLE;

SELECT qa('W16 and it is held in the raw table with the reason on it',
  (SELECT partner_lead_id IS NULL AND portal_note LIKE 'Not in the portal%'
     FROM public.website_inquiries WHERE id = :INQ_NOBODY),
  'recoverable, and it says why');

UPDATE public.partner_employees SET status = 'active'
 WHERE id IN (SELECT id FROM qaw_was_active);

-- The call gets a statement of its OWN, and that is load-bearing.
--
-- Under READ COMMITTED the snapshot is taken once per statement, so a single
-- SELECT that calls this function AND counts the rows it inserts counts them
-- against the snapshot from before the call — zero, every time, no matter how
-- correct the function is. The first version of this scenario was written that
-- way and reported a failure that was entirely its own.
SELECT public.website_inquiry_to_lead(:INQ_NOBODY) AS rescued_lead;

SELECT qa('W17 the backfill picks up what was held back',
  (SELECT count(*) FROM public.partner_leads WHERE name = 'QAW Orphan Ltd') = 1
  AND (SELECT partner_lead_id IS NOT NULL
         FROM public.website_inquiries WHERE id = :INQ_NOBODY),
  'the same function the trigger uses, so there is one copy of the rule');

SELECT qa('W18 running it twice does not make a second lead',
  (SELECT public.website_inquiry_to_lead(:INQ_FORM)) =
    (SELECT id FROM public.partner_leads WHERE name = 'QAW Alpha Steels')
  AND (SELECT count(*) FROM public.partner_leads WHERE name = 'QAW Alpha Steels') = 1,
  'idempotent, which is what makes the backfill safe to re-run');

-- 5b. The lead insert itself refused. The constraint below stands in for
-- anything the portal end might one day reject — a new NOT NULL, a check, a
-- renamed column. The visitor must not be able to tell.
ALTER TABLE public.partner_leads
  ADD CONSTRAINT qaw_break_lead_insert CHECK (name NOT LIKE 'QAW Boom%');

SET ROLE anon;
SELECT qa_allowed('W19 a visitor can still submit when the lead insert is refused',
  format('INSERT INTO public.website_inquiries (id, name, company, phone, source)
            VALUES (%L::uuid, %L, %L, %L, %L)',
         :INQ_BOOM, 'Boom Test', 'QAW Boom Ltd', '98888 50005', 'website'));
RESET ROLE;

SELECT qa('W20 the enquiry is kept and the failure is written on it',
  (SELECT partner_lead_id IS NULL AND portal_note LIKE 'Could not reach the portal%'
     FROM public.website_inquiries WHERE id = :INQ_BOOM),
  'the error, on the row, where somebody will find it');

ALTER TABLE public.partner_leads DROP CONSTRAINT qaw_break_lead_insert;

-- Its own statement, for the snapshot reason given at W17.
SELECT public.website_inquiry_to_lead(:INQ_BOOM) AS rescued_lead;

SELECT qa('W21 and once the fault is gone the backfill rescues it',
  (SELECT count(*) FROM public.partner_leads WHERE name = 'QAW Boom Ltd') = 1
  AND (SELECT partner_lead_id IS NOT NULL
         FROM public.website_inquiries WHERE id = :INQ_BOOM),
  'nothing was lost by the failure');

-- ── 6. The raw table is not readable by the world ───────────
SET ROLE anon;
SELECT qa('W22 anon may add an enquiry and read nothing back',
  (SELECT count(*) FROM public.website_inquiries) = 0,
  'RLS gives anon insert only — no policy lets it select');
RESET ROLE;

SELECT set_config('test.uid', :ADMIN, false);
SET ROLE authenticated;
SELECT qa('W23 portal staff can read the raw enquiries',
  (SELECT count(*) FROM public.website_inquiries) > 0,
  'when a mapping looks wrong this is the only place to check');
RESET ROLE;
SELECT set_config('test.uid', '', false);

-- Put the executive back, so the next file inherits a portal with two
-- active people rather than one.
UPDATE public.partner_employees SET status = 'active' WHERE email = 'exec@intake.test';
