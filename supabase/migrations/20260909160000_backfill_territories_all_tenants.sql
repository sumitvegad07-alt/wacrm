-- Backfill the default India territory hierarchy into every account that has
-- none, so the Country → State → City cascade shows on customer/lead forms for
-- ALL tenants (16 of 20 accounts had no territories, so they fell back to plain
-- single-line country/state/city text boxes). Also seed territory_settings
-- (levels + assignment) where missing, matching the provision-account route.
--
-- Hierarchy-preserving copy: for each target account we mint a fresh uuid for
-- every reference row and remap parent_id through that map, so the tree is
-- reproduced exactly with new ids. Only is_seed_data rows are copied (never one
-- tenant's custom areas). Idempotent: only accounts with zero territories are
-- touched.

DO $$
DECLARE
  ref_acct uuid;
  tgt uuid;
BEGIN
  -- Reference = the account holding the canonical India seed (most seed rows).
  SELECT account_id INTO ref_acct
  FROM public.territories
  WHERE is_seed_data AND deleted_at IS NULL
  GROUP BY account_id
  ORDER BY count(*) DESC
  LIMIT 1;

  IF ref_acct IS NULL THEN
    RAISE NOTICE 'No reference territory tree found; nothing to backfill.';
    RETURN;
  END IF;

  FOR tgt IN
    SELECT a.id FROM public.accounts a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.territories t
      WHERE t.account_id = a.id AND t.deleted_at IS NULL
    )
  LOOP
    -- Map every reference row to a fresh id for this target account.
    CREATE TEMP TABLE _tmap ON COMMIT DROP AS
      SELECT id AS old_id, gen_random_uuid() AS new_id
      FROM public.territories
      WHERE account_id = ref_acct AND deleted_at IS NULL AND is_seed_data;

    INSERT INTO public.territories
      (id, account_id, parent_id, level, name, code, status, notes, is_seed_data)
    SELECT
      m.new_id,
      tgt,
      pm.new_id,                     -- NULL for roots (no parent match)
      r.level, r.name, r.code, r.status, r.notes, r.is_seed_data
    FROM public.territories r
    JOIN _tmap m  ON m.old_id = r.id
    LEFT JOIN _tmap pm ON pm.old_id = r.parent_id
    WHERE r.account_id = ref_acct AND r.deleted_at IS NULL AND r.is_seed_data;

    DROP TABLE _tmap;
  END LOOP;
END $$;

-- Seed territory_settings (Country/State/City enabled) for accounts missing it,
-- merged so existing settings survive. Matches the provision-account route.
UPDATE public.accounts
SET settings =
  COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('territory_settings', jsonb_build_object(
       'levels', jsonb_build_array(
         jsonb_build_object('position', 1, 'name', 'Country', 'enabled', true),
         jsonb_build_object('position', 2, 'name', 'State',   'enabled', true),
         jsonb_build_object('position', 3, 'name', 'City',    'enabled', true),
         jsonb_build_object('position', 4, 'name', 'Area',    'enabled', false),
         jsonb_build_object('position', 5, 'name', 'Sub Area','enabled', false)
       ),
       'assignment_mode', 'area_wise'
     ))
WHERE settings -> 'territory_settings' IS NULL;
