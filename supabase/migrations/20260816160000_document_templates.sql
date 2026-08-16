-- Document Templates — the storage layer behind the existing editor UI.
--
-- WHAT WAS THERE BEFORE
-- A convincing front-end mockup and nothing else. `document-templates-panel.tsx` listed a
-- hardcoded `DUMMY_TEMPLATES` array; `document-template-editor.tsx` ran a one-second
-- setTimeout behind a `// Simulate save` comment and navigated away. No table existed. The
-- editor's design work is good and is being kept as-is; this migration gives it somewhere
-- to save to.
--
-- SCOPE — FOUR DOCUMENT TYPES, DECIDED 2026-08-16
-- order, quotation, dispatch, payment. Each already has a print route.
--   * "Estimate" in the mockup is not a real module. The product's equivalent is
--     Quotation, which has both a module and /print/quotation/[id]. Renamed, not built.
--   * "Outstanding" is dropped. It would be a customer statement of account — a document
--     type that has to be built before it can be styled, not a template awaiting a
--     backend. Logged separately.
--
-- WHY `config` IS JSONB AND NOT COLUMNS
-- The editor's shape is deeply nested and per-field: every item-table column and document-
-- info row carries its own `enabled` flag AND a user-editable `label`. Normalising that
-- would mean dozens of rows per template and a migration every time a section gains a
-- field, to buy validation the editor already enforces by construction. The rest of the app
-- stores configuration the same way (accounts.settings, module_settings). The trade is
-- accepted deliberately: Postgres will not catch a malformed config, so
-- `src/lib/document-templates/schema.ts` owns the shape and the defaults.

-- ===========================================================================
-- 1. Templates
-- ===========================================================================
CREATE TABLE IF NOT EXISTS document_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  module_name  text NOT NULL CHECK (module_name IN ('order', 'quotation', 'dispatch', 'payment')),
  name         text NOT NULL CHECK (btrim(name) <> ''),
  is_default   boolean NOT NULL DEFAULT false,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE document_templates IS
  'Per-account PDF layout configuration for order, quotation, dispatch and payment documents. Shape defined by src/lib/document-templates/schema.ts.';

COMMENT ON COLUMN document_templates.config IS
  'Nested section config matching DocumentTemplateConfig. Unknown keys are ignored on read and missing keys fall back to the module default, so an older template stays renderable after a section is added.';

CREATE INDEX IF NOT EXISTS idx_document_templates_account_module
  ON document_templates (account_id, module_name);

-- Exactly one default per module per account. A partial unique index rather than a trigger:
-- the database refuses a second default outright instead of racing to unset the first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_templates_one_default
  ON document_templates (account_id, module_name)
  WHERE is_default;

-- Two templates in the same module may not share a name, or the picker becomes ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_templates_unique_name
  ON document_templates (account_id, module_name, lower(btrim(name)));

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Document templates are viewable by account members"
  ON document_templates FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY "Document templates can be created by account members"
  ON document_templates FOR INSERT
  WITH CHECK (is_account_member(account_id));

CREATE POLICY "Document templates can be updated by account members"
  ON document_templates FOR UPDATE
  USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- Deleting a template changes what every future document looks like, so it is an admin act.
CREATE POLICY "Document templates can be deleted by admins"
  ON document_templates FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE TRIGGER update_document_templates_updated_at
  BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ===========================================================================
-- 2. Promoting a template to default
-- ===========================================================================
-- The unique index makes "set this one as default" a two-statement job that must not be
-- half-applied — unset the old, set the new. Done in one function so a failure between the
-- two cannot leave a module with no default at all.
CREATE OR REPLACE FUNCTION set_default_document_template(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_module     text;
BEGIN
  SELECT account_id, module_name INTO v_account_id, v_module
    FROM document_templates WHERE id = p_template_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  -- RLS still applies (SECURITY INVOKER): a caller outside the account updates nothing and
  -- the final statement raises below.
  UPDATE document_templates
     SET is_default = false
   WHERE account_id = v_account_id AND module_name = v_module AND is_default;

  UPDATE document_templates
     SET is_default = true
   WHERE id = p_template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not permitted to change the default template';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION set_default_document_template(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION set_default_document_template(uuid) TO authenticated;


-- ===========================================================================
-- 3. HSN code on products
-- ===========================================================================
-- The editor offers an HSN Code column in the item table and `settings.hsn_enabled` is
-- already true, but no HSN column existed anywhere in the schema — so the column could only
-- ever have printed blank. Added rather than removed, per founder decision 2026-08-16.
--
-- Nullable and unvalidated on purpose. Indian HSN codes are 4, 6 or 8 digits depending on
-- turnover, and a CHECK constraint here would reject legitimate codes and block product
-- edits for a field that is cosmetic on the document.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS hsn_code text;

COMMENT ON COLUMN products.hsn_code IS
  'HSN/SAC code printed on documents when the template enables the HSN column and settings.hsn_enabled is on. Free text: 4, 6 and 8 digit codes are all valid.';
