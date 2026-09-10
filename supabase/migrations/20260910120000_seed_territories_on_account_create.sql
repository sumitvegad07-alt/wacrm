-- Seed the default India territory hierarchy the moment an account is created,
-- instead of lazily on first web-dashboard load (provision-account route). The
-- lazy path is racy and dashboard-gated: an SFA signup that goes straight to
-- mobile — or a user who opens Territory Master before provisioning finishes —
-- saw an empty "Load default India data" state and had to seed by hand.
--
-- This AFTER INSERT trigger on accounts copies the canonical is_seed_data tree
-- from the reference account (the one holding the most seed rows) into the new
-- account with freshly-minted ids, preserving the Country → State → City parent
-- linkage, and stamps the default territory_settings so the area cascade works
-- immediately. It is:
--   * idempotent  — only seeds an account that has zero territories;
--   * plan-neutral — every plan gets the hierarchy (it drives the customer/lead
--                    address cascade, useful on CRM/WFA/SFA alike);
--   * fail-safe   — any error is swallowed so a seed hiccup never blocks signup.
--
-- The existing provision-account route still calls territory_bulk_seed, which is
-- itself idempotent, so it becomes a no-op once this trigger has run.

CREATE OR REPLACE FUNCTION public.seed_new_account_territories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_acct uuid;
  v_default_settings jsonb := jsonb_build_object(
    'levels', jsonb_build_array(
      jsonb_build_object('position', 1, 'name', 'Country',  'enabled', true),
      jsonb_build_object('position', 2, 'name', 'State',    'enabled', true),
      jsonb_build_object('position', 3, 'name', 'City',     'enabled', true),
      jsonb_build_object('position', 4, 'name', 'Area',     'enabled', false),
      jsonb_build_object('position', 5, 'name', 'Sub Area', 'enabled', false)
    ),
    'assignment_mode', 'area_wise'
  );
BEGIN
  -- Never re-seed an account that already has areas (defensive; AFTER INSERT).
  IF EXISTS (SELECT 1 FROM territories WHERE account_id = NEW.id AND deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  -- Reference = the account holding the canonical India seed (most seed rows).
  SELECT account_id INTO ref_acct
  FROM territories
  WHERE is_seed_data AND deleted_at IS NULL AND account_id <> NEW.id
  GROUP BY account_id
  ORDER BY count(*) DESC
  LIMIT 1;

  IF ref_acct IS NOT NULL THEN
    -- Copy the tree with remapped ids in one statement: `map` mints a new id per
    -- source row, then the insert rewrites each parent_id through that map.
    WITH src AS (
      SELECT id, parent_id, level, name, code, status, notes
      FROM territories
      WHERE account_id = ref_acct AND deleted_at IS NULL AND is_seed_data
    ),
    map AS (
      SELECT id AS old_id, gen_random_uuid() AS new_id FROM src
    )
    INSERT INTO territories (id, account_id, parent_id, level, name, code, status, notes, is_seed_data)
    SELECT m.new_id, NEW.id, pm.new_id, s.level, s.name, s.code, s.status, s.notes, true
    FROM src s
    JOIN map m ON m.old_id = s.id
    LEFT JOIN map pm ON pm.old_id = s.parent_id;
  END IF;

  -- Stamp default territory_settings only if the account has none yet, so a
  -- caller that set them first (provision route) is not clobbered.
  UPDATE accounts
     SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{territory_settings}', v_default_settings, true)
   WHERE id = NEW.id
     AND (settings -> 'territory_settings') IS NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed_new_account_territories failed for account %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_new_account_territories ON public.accounts;
CREATE TRIGGER trg_seed_new_account_territories
AFTER INSERT ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.seed_new_account_territories();
