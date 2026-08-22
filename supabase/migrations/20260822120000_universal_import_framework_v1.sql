-- ============================================================================
-- Universal Import Framework v1 — Wave 0 (engine + Product Units pilot)
--
-- One reusable import engine, driven by per-module descriptors (TS side). This
-- migration lays the shared server foundation:
--   • import_templates  — saved header→field mappings (tenant-shared, admin-managed)
--   • import_jobs       — audit + run state for every import (also powers the
--                          completion-notification via Realtime)
--   • import_row_map    — maps each newly-created row to its job, so an import
--                          can be undone (new rows only)
--   • import_commit     — idempotent, SECURITY INVOKER commit RPC (Skip / Update)
--   • import_undo       — deletes exactly the rows a job created, within a window,
--                          blocked once any row has dependents
--   • Permission keys `import_data` / `import_manage` live in
--     employee_roles.permissions (plain JSONB strings — no schema change needed;
--     has_permission() already resolves owner/admin/superadmin as all-true).
--
-- Wave 0 wires the commit/undo dispatch for `product_units` only. Later waves
-- add a branch per target table (see the CASE blocks below). Additive + idempotent
-- (IF NOT EXISTS); touches no existing data. Rollback: ROLLBACK-universal-import-framework.md
-- ============================================================================

-- ── 1. import_templates ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  module       text NOT NULL,
  name         text NOT NULL,
  mapping      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { sourceHeader: fieldKey }
  default_mode text,                                  -- 'skip' | 'update'
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS import_templates_account_module_name_uniq
  ON public.import_templates (account_id, module, lower(name));

ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_templates_select ON public.import_templates;
CREATE POLICY import_templates_select ON public.import_templates
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS import_templates_insert ON public.import_templates;
CREATE POLICY import_templates_insert ON public.import_templates
  FOR INSERT WITH CHECK (public.has_permission(auth.uid(), account_id, 'import_manage'));
DROP POLICY IF EXISTS import_templates_update ON public.import_templates;
CREATE POLICY import_templates_update ON public.import_templates
  FOR UPDATE USING (public.has_permission(auth.uid(), account_id, 'import_manage'));
DROP POLICY IF EXISTS import_templates_delete ON public.import_templates;
CREATE POLICY import_templates_delete ON public.import_templates
  FOR DELETE USING (public.has_permission(auth.uid(), account_id, 'import_manage'));

-- ── 2. import_jobs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  module            text NOT NULL,
  target_table      text NOT NULL,
  file_name         text NOT NULL,
  file_size         bigint,
  source_format     text,                              -- 'csv' | 'xlsx'
  mode              text NOT NULL DEFAULT 'skip',       -- 'skip' | 'update'
  status            text NOT NULL DEFAULT 'validating', -- validating|previewed|importing|completed|failed|undone
  total_rows        int NOT NULL DEFAULT 0,
  valid_rows        int NOT NULL DEFAULT 0,
  invalid_rows      int NOT NULL DEFAULT 0,
  duplicate_rows    int NOT NULL DEFAULT 0,
  imported_rows     int NOT NULL DEFAULT 0,
  updated_rows      int NOT NULL DEFAULT 0,
  skipped_rows      int NOT NULL DEFAULT 0,
  failed_rows       int NOT NULL DEFAULT 0,
  mapping           jsonb,
  template_id       uuid REFERENCES public.import_templates(id) ON DELETE SET NULL,
  source_file_path  text,
  error_report_path text,
  error_sample      jsonb,                              -- [{row, message}] first N, for quick display
  undoable          boolean NOT NULL DEFAULT false,
  undo_deadline     timestamptz,
  undone_at         timestamptz,
  undone_by         uuid,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_account_module_created
  ON public.import_jobs (account_id, module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_account_status
  ON public.import_jobs (account_id, status);

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_jobs_select ON public.import_jobs;
CREATE POLICY import_jobs_select ON public.import_jobs
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS import_jobs_insert ON public.import_jobs;
CREATE POLICY import_jobs_insert ON public.import_jobs
  FOR INSERT WITH CHECK (public.is_account_member(account_id) AND user_id = auth.uid());
DROP POLICY IF EXISTS import_jobs_update ON public.import_jobs;
CREATE POLICY import_jobs_update ON public.import_jobs
  FOR UPDATE USING (public.is_account_member(account_id));

-- ── 3. import_row_map ───────────────────────────────────────────────────────
-- Generic map so undo needs no per-target schema change. Written by import_commit
-- (as the user, INVOKER) only for rows the job actually inserted.
CREATE TABLE IF NOT EXISTS public.import_row_map (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  import_job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  target_table  text NOT NULL,
  record_id     uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_row_map_job ON public.import_row_map (import_job_id);

ALTER TABLE public.import_row_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_row_map_select ON public.import_row_map;
CREATE POLICY import_row_map_select ON public.import_row_map
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS import_row_map_insert ON public.import_row_map;
CREATE POLICY import_row_map_insert ON public.import_row_map
  FOR INSERT WITH CHECK (public.is_account_member(account_id));
DROP POLICY IF EXISTS import_row_map_delete ON public.import_row_map;
CREATE POLICY import_row_map_delete ON public.import_row_map
  FOR DELETE USING (public.is_account_member(account_id));

-- ── 4. updated_at triggers (reuse the shared set_updated_at) ─────────────────
DROP TRIGGER IF EXISTS set_updated_at_import_templates ON public.import_templates;
CREATE TRIGGER set_updated_at_import_templates BEFORE UPDATE ON public.import_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at_import_jobs ON public.import_jobs;
CREATE TRIGGER set_updated_at_import_jobs BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 5. Realtime — powers background-import completion notifications ──────────
-- The web client subscribes to import_jobs (filtered by account_id) and toasts
-- when a job flips to completed/failed. Guarded so re-running is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'import_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.import_jobs;
  END IF;
END $$;

-- ── 6. Dedupe backstop for the Product Units pilot ──────────────────────────
-- No unique constraint existed on unit name; the commit RPC dedupes by
-- lower(name) explicitly, and this index is the race backstop. Verified 0
-- duplicate (account_id, lower(name)) groups before adding.
CREATE UNIQUE INDEX IF NOT EXISTS product_units_account_name_uniq
  ON public.product_units (account_id, lower(name));

-- ── 7. import_commit — idempotent bulk commit (SECURITY INVOKER) ────────────
-- Accumulates counts on the job so it can be called once (small files) or per
-- chunk (large files). p_final marks the job completed and opens the undo window.
-- Dispatches per target_table; Wave 0 implements product_units. Idempotent: an
-- existence check precedes every insert, so a retried chunk never double-imports.
CREATE OR REPLACE FUNCTION public.import_commit(
  p_job_id uuid,
  p_rows   jsonb,
  p_final  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_account uuid; v_target text; v_mode text; v_status text;
  r jsonb; i int := 0;
  v_imported int := 0; v_updated int := 0; v_skipped int := 0; v_failed int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_name text; v_short text; v_existing uuid; v_new uuid;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be a JSON array' USING ERRCODE = 'check_violation';
  END IF;

  SELECT account_id, target_table, mode, status
    INTO v_account, v_target, v_mode, v_status
  FROM public.import_jobs WHERE id = p_job_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Import job not found or not accessible' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status = 'undone' THEN
    RAISE EXCEPTION 'This import has been undone' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.has_permission(auth.uid(), v_account, 'import_data') THEN
    RAISE EXCEPTION 'You do not have permission to import' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.import_jobs SET status = 'importing' WHERE id = p_job_id;

  -- ---- Per-target dispatch. Add a branch per module in later waves. ----
  IF v_target = 'product_units' THEN
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      i := i + 1;
      v_name  := NULLIF(btrim(r->>'name'), '');
      v_short := NULLIF(btrim(r->>'short_name'), '');
      IF v_name IS NULL THEN
        v_failed := v_failed + 1;
        v_errors := v_errors || jsonb_build_object('row', COALESCE((r->>'__row')::int, i), 'message', 'Missing unit name');
        CONTINUE;
      END IF;

      SELECT id INTO v_existing FROM public.product_units
      WHERE account_id = v_account AND lower(name) = lower(v_name) LIMIT 1;

      IF v_existing IS NOT NULL THEN
        IF v_mode = 'update' THEN
          UPDATE public.product_units
            SET short_name = COALESCE(v_short, short_name), active = true
          WHERE id = v_existing;
          v_updated := v_updated + 1;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      ELSE
        BEGIN
          INSERT INTO public.product_units (account_id, name, short_name)
          VALUES (v_account, v_name, v_short)
          RETURNING id INTO v_new;
          INSERT INTO public.import_row_map (account_id, import_job_id, target_table, record_id)
          VALUES (v_account, p_job_id, v_target, v_new);
          v_imported := v_imported + 1;
        EXCEPTION WHEN unique_violation THEN
          -- Lost a race (or a same-file casing dup): treat as skip, never fail.
          v_skipped := v_skipped + 1;
        END;
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Import target "%" is not supported yet', v_target USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Accumulate counts (supports chunked calls).
  UPDATE public.import_jobs SET
    imported_rows = imported_rows + v_imported,
    updated_rows  = updated_rows  + v_updated,
    skipped_rows  = skipped_rows  + v_skipped,
    failed_rows   = failed_rows   + v_failed,
    error_sample  = CASE WHEN jsonb_array_length(v_errors) > 0
                         THEN COALESCE(error_sample, '[]'::jsonb) || v_errors ELSE error_sample END
  WHERE id = p_job_id;

  IF p_final THEN
    UPDATE public.import_jobs SET
      status       = 'completed',
      completed_at = now(),
      undoable     = (imported_rows > 0),
      undo_deadline = now() + interval '30 minutes'
    WHERE id = p_job_id;
  END IF;

  RETURN jsonb_build_object(
    'imported', v_imported, 'updated', v_updated,
    'skipped', v_skipped, 'failed', v_failed, 'errors', v_errors
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.import_commit(uuid, jsonb, boolean) TO authenticated;

-- ── 8. import_undo — remove only the rows this job created ───────────────────
-- SECURITY INVOKER so the target table's own RLS still applies. Refused (all-or-
-- nothing) once the window has closed, a newer import exists, or any created row
-- has a dependent. target_table is whitelisted via the CASE, closing dynamic-SQL risk.
CREATE OR REPLACE FUNCTION public.import_undo(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_account uuid; v_target text; v_module text; v_undoable boolean;
  v_deadline timestamptz; v_status text; v_created timestamptz;
  v_removed int := 0; v_blocked int := 0;
BEGIN
  SELECT account_id, target_table, module, undoable, undo_deadline, status, created_at
    INTO v_account, v_target, v_module, v_undoable, v_deadline, v_status, v_created
  FROM public.import_jobs WHERE id = p_job_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Import job not found or not accessible' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.has_permission(auth.uid(), v_account, 'import_manage') THEN
    RAISE EXCEPTION 'You do not have permission to undo an import' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_status = 'undone' THEN
    RAISE EXCEPTION 'This import has already been undone' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_undoable THEN
    RAISE EXCEPTION 'This import cannot be undone' USING ERRCODE = 'check_violation';
  END IF;
  IF v_deadline IS NULL OR now() > v_deadline THEN
    RAISE EXCEPTION 'The undo window for this import has closed' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.import_jobs j
    WHERE j.account_id = v_account AND j.module = v_module
      AND j.status = 'completed' AND j.created_at > v_created
  ) THEN
    RAISE EXCEPTION 'A newer import exists for this module; undo is no longer available'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---- Per-target delete + dependent check. Add a branch per module later. ----
  IF v_target = 'product_units' THEN
    -- product_units has no inbound FK today, so there are no dependents to block on.
    DELETE FROM public.product_units
    WHERE account_id = v_account
      AND id IN (SELECT record_id FROM public.import_row_map WHERE import_job_id = p_job_id);
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Undo for target "%" is not supported yet', v_target USING ERRCODE = 'feature_not_supported';
  END IF;

  DELETE FROM public.import_row_map WHERE import_job_id = p_job_id;
  UPDATE public.import_jobs
    SET status = 'undone', undone_at = now(), undone_by = auth.uid()
  WHERE id = p_job_id;

  RETURN jsonb_build_object('removed', v_removed, 'blocked', v_blocked);
END;
$$;
GRANT EXECUTE ON FUNCTION public.import_undo(uuid) TO authenticated;
