-- Document template assignments + signature image storage.
--
-- FOUNDER DECISION 2026-08-16: assigning a template to a user means BOTH — the assigned
-- users print with it, and they are the only ones who may edit it.
--
-- Precedence when printing: template assigned to the viewer -> the account default ->
-- the built-in module default. So an unassigned account still behaves exactly as before.
--
-- The edit rule has one deliberate escape hatch: **account admins can always edit**. Without
-- it, assigning a template to a single rep would lock the owner out of a layout their whole
-- business prints with, and the only way back would be a database edit.

-- ===========================================================================
-- 1. Assignments
-- ===========================================================================
CREATE TABLE IF NOT EXISTS document_template_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Copied from the template by trigger, never supplied by the client. Denormalised only so
  -- that "one template per user per module" can be a unique index instead of a trigger that
  -- has to re-derive the module on every write.
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  module_name  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE document_template_assignments IS
  'Which users print with (and may edit) which document template. A user may hold at most one template per module.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_dta_one_per_user_per_module
  ON document_template_assignments (account_id, user_id, module_name);

CREATE INDEX IF NOT EXISTS idx_dta_template ON document_template_assignments (template_id);
CREATE INDEX IF NOT EXISTS idx_dta_user_module ON document_template_assignments (user_id, module_name);

-- account_id and module_name always come from the template, so an assignment cannot claim a
-- module its template does not belong to.
CREATE OR REPLACE FUNCTION set_document_template_assignment_scope()
RETURNS trigger AS $$
BEGIN
  SELECT t.account_id, t.module_name
    INTO NEW.account_id, NEW.module_name
    FROM document_templates t WHERE t.id = NEW.template_id;

  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dta_scope ON document_template_assignments;
CREATE TRIGGER trg_dta_scope
  BEFORE INSERT OR UPDATE ON document_template_assignments
  FOR EACH ROW EXECUTE FUNCTION set_document_template_assignment_scope();

ALTER TABLE document_template_assignments ENABLE ROW LEVEL SECURITY;

-- Everyone in the account can read assignments: the print route has to know whether the
-- current viewer holds one before it can pick a template.
CREATE POLICY "Template assignments are viewable by account members"
  ON document_template_assignments FOR SELECT
  USING (is_account_member(account_id));

-- Deciding who prints with which layout is an administrative act.
CREATE POLICY "Template assignments are managed by admins"
  ON document_template_assignments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY "Template assignments are removable by admins"
  ON document_template_assignments FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- ===========================================================================
-- 2. Who may edit a template
-- ===========================================================================
-- Unassigned template  -> any account member, i.e. unchanged behaviour.
-- Assigned template    -> its assignees, plus admins (the escape hatch above).
CREATE OR REPLACE FUNCTION can_edit_document_template(p_template_id uuid, p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_account_member(p_account_id, 'admin')
    OR NOT EXISTS (
      SELECT 1 FROM document_template_assignments a WHERE a.template_id = p_template_id
    )
    OR EXISTS (
      SELECT 1 FROM document_template_assignments a
       WHERE a.template_id = p_template_id AND a.user_id = auth.uid()
    );
$$;

-- SECURITY DEFINER so the check sees every assignment row regardless of the caller's own
-- read policy. It discloses nothing: it returns a single boolean about one template the
-- caller already has to name.
REVOKE ALL ON FUNCTION can_edit_document_template(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION can_edit_document_template(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Document templates can be updated by account members" ON document_templates;
CREATE POLICY "Document templates can be updated by permitted members"
  ON document_templates FOR UPDATE
  USING (is_account_member(account_id) AND can_edit_document_template(id, account_id))
  WITH CHECK (is_account_member(account_id) AND can_edit_document_template(id, account_id));


-- ===========================================================================
-- 3. Resolving which template a user prints with
-- ===========================================================================
CREATE OR REPLACE FUNCTION resolve_document_template(
  p_account_id uuid,
  p_module     text,
  p_user_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1. assigned to this user
    (SELECT t.config
       FROM document_template_assignments a
       JOIN document_templates t ON t.id = a.template_id
      WHERE a.account_id = p_account_id
        AND a.module_name = p_module
        AND a.user_id = COALESCE(p_user_id, auth.uid())
      LIMIT 1),
    -- 2. the account default
    (SELECT t.config
       FROM document_templates t
      WHERE t.account_id = p_account_id
        AND t.module_name = p_module
        AND t.is_default
      LIMIT 1)
    -- 3. NULL -> the caller falls back to the built-in module default
  );
$$;

REVOKE ALL ON FUNCTION resolve_document_template(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION resolve_document_template(uuid, text, uuid) TO authenticated;


-- ===========================================================================
-- 4. Signature images
-- ===========================================================================
-- Public, matching the company logo which already lives in the public `avatars` bucket and
-- prints on the same documents. A private bucket would need a signed URL, and the mobile app
-- renders these print pages in a webview to make its PDFs — an expiring URL there produces a
-- document with a broken image and no obvious cause. The trade is recorded rather than
-- hidden: a signature image URL is guessable-by-listing if someone learns the account id.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'document_assets', 'document_assets', true, 2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Objects are stored under <account_id>/..., so membership is checked against the first
-- path segment.
DROP POLICY IF EXISTS "Document assets are readable" ON storage.objects;
CREATE POLICY "Document assets are readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'document_assets');

DROP POLICY IF EXISTS "Document assets are writable by account members" ON storage.objects;
CREATE POLICY "Document assets are writable by account members"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document_assets'
    AND is_account_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Document assets are replaceable by account members" ON storage.objects;
CREATE POLICY "Document assets are replaceable by account members"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'document_assets'
    AND is_account_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Document assets are removable by account members" ON storage.objects;
CREATE POLICY "Document assets are removable by account members"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'document_assets'
    AND is_account_member((storage.foldername(name))[1]::uuid)
  );
