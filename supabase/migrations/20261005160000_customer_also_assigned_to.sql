-- ============================================================
-- 20261005160000_customer_also_assigned_to.sql
--
-- Founder decision (2026-10-05): a customer may be worked by SEVERAL employees,
-- not just one — "Areas AND customers" — while keeping ONE main owner so every
-- report, target, DSR and sales-credit query keeps working unchanged.
--
-- Modelled as an array column, matching leads/deals.collaborator_ids, rather
-- than a join table: the mobile app writes offline, and child-table writes are
-- where the offline queue has broken before (a child outrunning its parent).
--
-- ALSO FIXES A LATENT BUG. `contacts_select` never checked `employee_id` at all,
-- so in direct-assignment mode an employee handed a customer could not see it
-- unless they happened to have created it. No tenant hits this today — all 33
-- accounts are area-wise — but the same mistake must not be repeated for the new
-- column, and the fix belongs here.
-- ============================================================

-- ── 1. The extra assignees ───────────────────────────────────
-- Auth user ids, NOT profiles.id. RLS compares against auth.uid(), so a
-- profiles.id stored here would add somebody to the list and silently grant them
-- nothing — exactly the trap leads/deals already carry.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS collaborator_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.contacts.collaborator_ids IS
  'Extra employees assigned to this customer ("Also Assigned To"), as AUTH USER ids. The single main owner stays employee_id/user_id so reporting is unaffected.';

-- Array containment is the RLS predicate, so it wants a GIN index.
CREATE INDEX IF NOT EXISTS idx_contacts_collaborator_ids
  ON public.contacts USING GIN (collaborator_ids);

-- ── 2. Visibility ────────────────────────────────────────────
-- Adds the two missing routes to a customer: being an extra assignee, and the
-- pre-existing employee_id gap. Everything else is carried over verbatim from
-- the live policy, including the (SELECT auth.uid()) initplan wrapping that
-- migration 20260913120000 applied for performance.
DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts FOR SELECT USING (
  (
    is_account_member(account_id)
    AND (
      is_account_member(account_id, 'admin'::account_role_enum)
      OR user_id = (SELECT auth.uid())
      -- NEW: an extra assignee sees the customer.
      OR (SELECT auth.uid()) = ANY (collaborator_ids)
      -- NEW: the main owner under direct-assignment mode. employee_id is in the
      -- profiles.id space, which is why it needs the lookup rather than a
      -- straight comparison with auth.uid().
      OR employee_id IN (SELECT p.id FROM profiles p WHERE p.user_id = (SELECT auth.uid()))
      OR (territory_id IS NOT NULL AND territory_id = ANY (employee_area_territory_ids((SELECT auth.uid()))))
    )
  )
  OR (is_account_member(account_id) AND data_scope_extends(user_id, account_id))
);

-- ── 3. Normalise the ids leads and deals already hold ────────
-- CollaboratorsSelect stores auth user ids, but older mobile and web flows wrote
-- profiles.id. Those rows list somebody who was never actually granted access.
-- Checked on 2026-10-05: all 3 live rows are already auth ids, so this is a
-- no-op today and a guard against older builds still in the field.
UPDATE public.leads l
   SET collaborator_ids = sub.fixed
  FROM (
    SELECT x.id,
           array_agg(DISTINCT COALESCE(p.user_id, x.cid)) AS fixed
      FROM (SELECT id, unnest(collaborator_ids) AS cid FROM public.leads
             WHERE collaborator_ids IS NOT NULL AND cardinality(collaborator_ids) > 0) x
      LEFT JOIN profiles p ON p.id = x.cid
     GROUP BY x.id
  ) sub
 WHERE l.id = sub.id AND l.collaborator_ids IS DISTINCT FROM sub.fixed;

UPDATE public.deals d
   SET collaborator_ids = sub.fixed
  FROM (
    SELECT x.id,
           array_agg(DISTINCT COALESCE(p.user_id, x.cid)) AS fixed
      FROM (SELECT id, unnest(collaborator_ids) AS cid FROM public.deals
             WHERE collaborator_ids IS NOT NULL AND cardinality(collaborator_ids) > 0) x
      LEFT JOIN profiles p ON p.id = x.cid
     GROUP BY x.id
  ) sub
 WHERE d.id = sub.id AND d.collaborator_ids IS DISTINCT FROM sub.fixed;
