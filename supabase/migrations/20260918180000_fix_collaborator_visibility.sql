-- Fix collaborator visibility (leads & deals).
--
-- The RLS visibility rule checks `auth.uid() = ANY(collaborator_ids)`, so
-- collaborator_ids must hold AUTH user ids (profiles.user_id). The web picker was
-- storing profiles.id, so collaborators were added but never granted access — the
-- lead/deal stayed hidden for them. The picker is fixed to store user_id going
-- forward; this backfills existing rows and extends the deals policy, which did
-- not check collaborators (or the assignee) at all.

-- 1. Backfill leads.collaborator_ids: profiles.id -> user_id (preserve order).
UPDATE leads l SET collaborator_ids = sub.ids
FROM (
  SELECT ll.id, array_agg(COALESCE(p.user_id, u.cid) ORDER BY u.ord) AS ids
  FROM leads ll
  CROSS JOIN LATERAL unnest(ll.collaborator_ids) WITH ORDINALITY AS u(cid, ord)
  LEFT JOIN profiles p ON p.id = u.cid AND p.account_id = ll.account_id
  WHERE array_length(ll.collaborator_ids, 1) > 0
  GROUP BY ll.id
) sub
WHERE l.id = sub.id;

-- 2. Same for deals.collaborator_ids.
UPDATE deals d SET collaborator_ids = sub.ids
FROM (
  SELECT dd.id, array_agg(COALESCE(p.user_id, u.cid) ORDER BY u.ord) AS ids
  FROM deals dd
  CROSS JOIN LATERAL unnest(dd.collaborator_ids) WITH ORDINALITY AS u(cid, ord)
  LEFT JOIN profiles p ON p.id = u.cid AND p.account_id = dd.account_id
  WHERE array_length(dd.collaborator_ids, 1) > 0
  GROUP BY dd.id
) sub
WHERE d.id = sub.id;

-- 3. Extend deals_select so collaborators and the assignee can see the deal.
--    Purely ADDITIVE (adds OR-branches); existing data_scope access is unchanged.
--    deals.assigned_to is a profiles.id, so it resolves via profiles, while
--    collaborator_ids (after backfill) is matched against auth.uid() directly.
DROP POLICY IF EXISTS deals_select ON deals;
CREATE POLICY deals_select ON deals FOR SELECT USING (
  is_account_member(account_id) AND (
    data_scope_allows(user_id, account_id)
    OR (SELECT auth.uid()) = ANY(COALESCE(collaborator_ids, '{}'::uuid[]))
    OR EXISTS (
      SELECT 1 FROM profiles pr
      WHERE pr.id = deals.assigned_to AND pr.user_id = (SELECT auth.uid())
    )
  )
);
