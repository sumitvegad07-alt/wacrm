-- Predefined (system_key) field definitions must be unique per account + module.
--
-- ensureDefaultSectionsAndFields() seeds them with a read-then-insert: it reads the
-- existing system_keys, then inserts the missing ones. Two concurrent callers (two
-- tabs, or a form and the field builder opening together) both read "missing" and
-- both insert, so the account ends up with two identical definitions. That is how
-- account 001001 got a second "Pincode / ZIP" on the lead module, 0.1s after the
-- first. There was no constraint to stop it — only a non-unique lookup index.
--
-- Predefined fields never store anything in the *_custom_values tables (their value
-- lives in the record's own column, e.g. leads.pincode), so dropping the newer
-- duplicate loses no data.

DELETE FROM custom_fields cf
USING custom_fields keep
WHERE cf.system_key IS NOT NULL
  AND keep.system_key = cf.system_key
  AND keep.account_id IS NOT DISTINCT FROM cf.account_id
  AND keep.module_name IS NOT DISTINCT FROM cf.module_name
  AND (keep.created_at, keep.id) < (cf.created_at, cf.id);

CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_system_key_unique
  ON public.custom_fields (account_id, module_name, system_key)
  WHERE system_key IS NOT NULL;
