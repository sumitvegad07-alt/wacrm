-- ============================================================
-- 20261012160000_quotation_version_chain.sql
--
-- Founder request (2026-10-12): "when I make a version from one quotation then
-- only the newer version is available but I can't see the older version from
-- that newer version."
--
-- Versioning already stored the link — every new version carries `parent_id`,
-- an incremented `version` and flips the parent's `is_latest_version` to false
-- — but nothing read it back. The list screen filters to is_latest_version, so
-- once v2 existed, v1 was unreachable from anywhere in the UI.
--
-- This returns the WHOLE family of a quotation (the first version, every
-- version after it, and the one asked about) in one round trip. Walking the
-- chain from the client would cost one query per hop in each direction, which
-- is exactly the pattern that makes screens here feel slow
-- (OZZO_DATA_PERF_RESEARCH.md: the time is always in fetching).
--
-- SECURITY INVOKER — deliberately NOT definer. A quotation chain must stay
-- inside the caller's RLS: a definer function would let any authenticated user
-- read another tenant's quotation totals by passing an id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.quotation_version_chain(p_quotation_id uuid)
RETURNS TABLE (
  id uuid,
  quotation_number text,
  version integer,
  status text,
  date date,
  total_amount numeric,
  is_latest_version boolean,
  is_active boolean,
  parent_id uuid,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH RECURSIVE
  -- Up from the quotation asked about to the first version. `depth` is a cycle
  -- guard: parent_id always points at an older row so a loop should be
  -- impossible, but a bad import must not be able to hang the request.
  ancestors AS (
    SELECT q.id, q.parent_id, 0 AS depth
      FROM quotations q
     WHERE q.id = p_quotation_id
    UNION ALL
    SELECT q.id, q.parent_id, a.depth + 1
      FROM quotations q
      JOIN ancestors a ON q.id = a.parent_id
     WHERE a.depth < 50
  ),
  -- The first version. A parent that was hard-deleted, or that this caller
  -- cannot see under RLS, counts as the top of the chain too — otherwise the
  -- walk would find no root and the panel would show nothing at all.
  root AS (
    SELECT a.id
      FROM ancestors a
     WHERE a.parent_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM quotations p WHERE p.id = a.parent_id)
     ORDER BY a.depth DESC
     LIMIT 1
  ),
  -- Down from the first version through every later one. A quotation can only
  -- be versioned from the latest, so in practice this is a straight line.
  family AS (
    SELECT r.id, 0 AS depth FROM root r
    UNION ALL
    SELECT q.id, f.depth + 1
      FROM quotations q
      JOIN family f ON q.parent_id = f.id
     WHERE f.depth < 50
  )
  SELECT q.id,
         q.quotation_number,
         q.version,
         q.status,
         q.date,
         q.total_amount,
         q.is_latest_version,
         q.is_active,
         q.parent_id,
         q.created_at
    FROM quotations q
    JOIN family f ON f.id = q.id
   ORDER BY q.version, q.created_at;
$$;

REVOKE ALL ON FUNCTION public.quotation_version_chain(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.quotation_version_chain(uuid) TO authenticated;

COMMENT ON FUNCTION public.quotation_version_chain(uuid) IS
  'Every version of a quotation (first version, all later ones, and the one passed in), oldest first. SECURITY INVOKER so RLS scopes the chain to the caller tenant.';
