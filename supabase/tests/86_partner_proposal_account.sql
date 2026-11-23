-- ============================================================
-- 2026-11-23 — Phase 3 Push 1.
--
--   20261125120000_platform_proposals_account.sql
--
-- Three assertions, and one of them is not really about proposals.
--
-- P86a and P86b are the column itself: it must be nullable, because every
-- proposal written before today has no account and must keep working, and it
-- must be `on delete set null` rather than cascade, because a closed account
-- must not erase the deal that won it.
--
-- P86c is the one worth having. It counts the foreign keys from
-- platform_proposals to public.accounts and insists there is exactly ONE. A
-- second key between the same pair of tables makes every PostgREST embed on
-- the table ambiguous, which is how every order screen in the product was
-- dead for three days after a migration that looked completely safe. Nothing
-- in TypeScript can catch it: tsc does not read PostgREST select strings.
-- See orders-second-fk-broke-every-order.
--
-- Note on tooling: every assertion here is a top-level `SELECT qa(` call,
-- because the runner counts those to detect a file that aborted half way.
-- A bare `select … as something` is not counted and not recorded.
-- ============================================================

-- Cleanup first, so the file is re-runnable against a warm database.
DELETE FROM public.platform_proposals WHERE ref LIKE 'QA86-%';
DELETE FROM public.accounts WHERE id = 'aaaa0000-0000-0000-0000-000000086001';
DELETE FROM auth.users WHERE id = '11110000-0000-0000-0000-000000086001';

-- ── The trigger has to come off, and this is why ──
--
-- auth.users carries on_auth_user_created -> handle_new_user(), which
-- PROVISIONS A WHOLE TENANT for every new login: an accounts row, a customer
-- id, a plan, a profiles row. accounts also has a unique index
-- idx_accounts_one_per_owner, so inserting the user and then inserting my own
-- account for that user is a duplicate-key error on the second statement --
-- which is exactly how this file failed the first time it ran.
--
-- Every other scenario here brackets its auth.users inserts the same way.
-- See partner-portal-auth-trigger-trap.
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

INSERT INTO auth.users(id, email) VALUES
 ('11110000-0000-0000-0000-000000086001','qa86-owner@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.accounts(id, name, owner_user_id, customer_id, settings) VALUES
 ('aaaa0000-0000-0000-0000-000000086001','QA86 Account',
  '11110000-0000-0000-0000-000000086001','990086','{}'::jsonb);

ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

-- One linked, one not. Both must be allowed.
INSERT INTO public.platform_proposals(id, ref, client_name, account_id) VALUES
 ('bbbb0000-0000-0000-0000-000000086001','QA86-001','QA86 Linked Client',
  'aaaa0000-0000-0000-0000-000000086001');

INSERT INTO public.platform_proposals(id, ref, client_name) VALUES
 ('bbbb0000-0000-0000-0000-000000086002','QA86-002','QA86 Unlinked Client');

SELECT qa('P86a a proposal may carry an account, and may carry none',
  (SELECT account_id FROM public.platform_proposals
     WHERE id = 'bbbb0000-0000-0000-0000-000000086001') IS NOT NULL
  AND (SELECT account_id FROM public.platform_proposals
     WHERE id = 'bbbb0000-0000-0000-0000-000000086002') IS NULL,
  'nullable, so every proposal written before today keeps working');

DELETE FROM public.accounts WHERE id = 'aaaa0000-0000-0000-0000-000000086001';

SELECT qa('P86b deleting the account keeps the proposal and clears its link',
  (SELECT count(*) FROM public.platform_proposals
     WHERE id = 'bbbb0000-0000-0000-0000-000000086001') = 1
  AND (SELECT account_id FROM public.platform_proposals
     WHERE id = 'bbbb0000-0000-0000-0000-000000086001') IS NULL,
  'on delete set null, not cascade: a closed account must not erase the deal');

SELECT qa('P86c exactly ONE foreign key from platform_proposals to accounts',
  (SELECT count(*) FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_class f ON f.oid = c.confrelid
     JOIN pg_namespace tn ON tn.oid = t.relnamespace
    WHERE c.contype = 'f'
      AND tn.nspname = 'public'
      AND t.relname = 'platform_proposals'
      AND f.relname = 'accounts') = 1,
  'a second one makes every PostgREST embed on this table ambiguous');

-- Leave nothing behind. The account is already gone: P86b deleted it.
DELETE FROM public.platform_proposals WHERE ref LIKE 'QA86-%';
DELETE FROM auth.users WHERE id = '11110000-0000-0000-0000-000000086001';
