-- ============================================================
-- 20261005140000_territory_customer_counts.sql
--
-- Founder request (2026-10-05): show how many customers are in each territory,
-- as a badge beside its name in the area pickers, at every level — country,
-- state, city, area, sub-area.
--
-- Returns the count pinned DIRECTLY to each territory. The client rolls the
-- subtree up (src/lib/territories/customer-counts.ts), because it already holds
-- the tree and the roll-up is the same arithmetic either way.
--
-- An RPC rather than a plain select because PostgREST cannot GROUP BY: the
-- alternative is shipping one row per customer to the browser just to tally
-- them, which is fine at 306 customers and wasteful at fifty thousand.
--
-- SECURITY INVOKER — deliberately NOT definer. The caller's RLS must apply, so a
-- non-admin sees counts only for customers they can already see. A definer
-- function here would quietly leak how many customers exist in areas the user
-- has no access to.
-- ============================================================

CREATE OR REPLACE FUNCTION public.territory_customer_counts(p_account_id uuid)
RETURNS TABLE (territory_id uuid, customer_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT c.territory_id, count(*)::bigint
    FROM contacts c
   WHERE c.account_id = p_account_id
     AND c.territory_id IS NOT NULL
     -- Soft-deleted customers are history, not people in a territory today.
     AND COALESCE(c.is_active, true) IS TRUE
   GROUP BY c.territory_id;
$$;

REVOKE ALL ON FUNCTION public.territory_customer_counts(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.territory_customer_counts(uuid) TO authenticated;

COMMENT ON FUNCTION public.territory_customer_counts(uuid) IS
  'Active customers pinned directly to each territory. SECURITY INVOKER so RLS scopes the counts to what the caller may see; callers roll the subtree up themselves.';
