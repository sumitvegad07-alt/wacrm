-- ============================================================================
-- 20260817170000_leave_management.sql — Leave Management v1
--
-- Spec: docs/engineering/specifications/leave-management-v1.md
-- Rollback: supabase/migrations/ROLLBACK-leave-management.md
--
-- Four tables (leave_types, leaves, leave_days, holidays), a leave_seq on the
-- existing account_sequences, three RPCs, and one working-days setting.
-- Additive only — nothing is dropped and no existing row is rewritten.
--
-- Design notes that are easy to get wrong later:
--   * profiles.id IS NOT auth.uid(). auth.uid() matches profiles.user_id. Every
--     ownership check therefore reads
--       employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
--     exactly as the expenses policies (058) do.
--   * leave_days carries account_id + employee_id + status denormalised from its
--     parent. That is deliberate: the attendance page asks "who is on leave on
--     this date" for a whole month, and this lets it answer with one index hit
--     and no join, and lets RLS be checked without a subquery into leaves.
--   * The updated-at trigger function in this repo is update_updated_at_column(),
--     NOT set_updated_at().
--   * pg_safeupdate is active on the authenticated connection: every UPDATE and
--     DELETE below is WHERE-qualified.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────
-- 1. leave_types — admin-configured, same shape as expense_types
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_types (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT,
  status     TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_types_name_present CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_leave_types_account ON leave_types (account_id);

-- Case-insensitive so an account cannot end up with both "Casual Leave" and
-- "casual leave" (the mess products.unit has with kg/Kg/KG).
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_types_account_name
  ON leave_types (account_id, lower(name));

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_types_select ON leave_types;
CREATE POLICY leave_types_select ON leave_types
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS leave_types_insert ON leave_types;
CREATE POLICY leave_types_insert ON leave_types
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS leave_types_update ON leave_types;
CREATE POLICY leave_types_update ON leave_types
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS leave_types_delete ON leave_types;
CREATE POLICY leave_types_delete ON leave_types
  FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE TRIGGER set_leave_types_updated_at
  BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─────────────────────────────────────────────────────────────
-- 2. holidays — company-wide, one explicit date each
--    No recurring flag on purpose: Diwali/Holi/Eid move every year, and a
--    recurring rule would quietly generate wrong dates.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holidays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holidays_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT holidays_unique_date UNIQUE (account_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_holidays_account_date ON holidays (account_id, holiday_date);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS holidays_select ON holidays;
CREATE POLICY holidays_select ON holidays
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS holidays_insert ON holidays;
CREATE POLICY holidays_insert ON holidays
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS holidays_update ON holidays;
CREATE POLICY holidays_update ON holidays
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS holidays_delete ON holidays;
CREATE POLICY holidays_delete ON holidays
  FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE TRIGGER set_holidays_updated_at
  BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─────────────────────────────────────────────────────────────
-- 3. leaves — the request header
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaves (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_number        TEXT NOT NULL,
  leave_type_id       UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  from_date           DATE NOT NULL,
  to_date             DATE NOT NULL,
  total_days          NUMERIC(5, 2) NOT NULL,
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  applied_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_backdated        BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_url      TEXT,
  attachment_name     TEXT,
  approved_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  rejected_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  cancelled_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leaves_date_order CHECK (to_date >= from_date),
  -- The mandatory-reason rule lives here, not in three separate forms. Mobile
  -- writes to these tables directly; a validation that exists only in React on
  -- one platform is not a rule (see the payment require_* incident).
  CONSTRAINT leaves_reason_present CHECK (length(btrim(reason)) > 0),
  CONSTRAINT leaves_number_unique UNIQUE (account_id, leave_number)
);

CREATE INDEX IF NOT EXISTS idx_leaves_account_status ON leaves (account_id, status);
CREATE INDEX IF NOT EXISTS idx_leaves_employee_from ON leaves (employee_id, from_date);
CREATE INDEX IF NOT EXISTS idx_leaves_account_range ON leaves (account_id, from_date, to_date);

ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;

-- Own leave is always visible. Beyond that: admin, the employee's reporting
-- manager at any depth, or an explicit view_leaves right.
DROP POLICY IF EXISTS leaves_select ON leaves;
CREATE POLICY leaves_select ON leaves
  FOR SELECT USING (
    is_account_member(account_id)
    AND (
      is_account_member(account_id, 'admin')
      OR employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      OR has_permission(auth.uid(), account_id, 'view_leaves')
      OR is_in_downline(
           (SELECT id FROM profiles WHERE user_id = auth.uid() AND account_id = leaves.account_id),
           employee_id)
    )
  );

-- Apply for yourself, or for someone else with manage_leaves.
DROP POLICY IF EXISTS leaves_insert ON leaves;
CREATE POLICY leaves_insert ON leaves
  FOR INSERT WITH CHECK (
    is_account_member(account_id)
    AND (
      employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      OR is_account_member(account_id, 'admin')
      OR has_permission(auth.uid(), account_id, 'manage_leaves')
    )
  );

-- Employees may only touch their own request while it is still Pending. The
-- WITH CHECK repeats status='Pending' on that branch so a raw REST call cannot
-- self-approve by writing the column directly.
DROP POLICY IF EXISTS leaves_update ON leaves;
CREATE POLICY leaves_update ON leaves
  FOR UPDATE USING (
    is_account_member(account_id)
    AND (
      is_account_member(account_id, 'admin')
      OR has_permission(auth.uid(), account_id, 'manage_leaves')
      OR has_permission(auth.uid(), account_id, 'approve_leaves')
      OR is_in_downline(
           (SELECT id FROM profiles WHERE user_id = auth.uid() AND account_id = leaves.account_id),
           employee_id)
      OR (employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) AND status = 'Pending')
    )
  )
  WITH CHECK (
    is_account_member(account_id)
    AND (
      is_account_member(account_id, 'admin')
      OR has_permission(auth.uid(), account_id, 'manage_leaves')
      OR has_permission(auth.uid(), account_id, 'approve_leaves')
      OR is_in_downline(
           (SELECT id FROM profiles WHERE user_id = auth.uid() AND account_id = leaves.account_id),
           employee_id)
      OR (employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
          AND status IN ('Pending', 'Cancelled'))
    )
  );

-- No DELETE policy: a leave record is never physically removed. Withdrawal is
-- the Cancelled status, so the history and the audit trail survive.

CREATE OR REPLACE TRIGGER set_leaves_updated_at
  BEFORE UPDATE ON leaves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─────────────────────────────────────────────────────────────
-- 4. leave_days — one row per calendar day of a request
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_days (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_id    UUID NOT NULL REFERENCES leaves(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_date  DATE NOT NULL,
  weightage   TEXT NOT NULL
                CHECK (weightage IN ('full', 'first_half', 'second_half', 'quarter')),
  day_value   NUMERIC(3, 2) NOT NULL CHECK (day_value IN (1.00, 0.50, 0.25)),
  status      TEXT NOT NULL
                CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_days_lookup
  ON leave_days (account_id, leave_date, status);
CREATE INDEX IF NOT EXISTS idx_leave_days_employee
  ON leave_days (employee_id, leave_date);
CREATE INDEX IF NOT EXISTS idx_leave_days_leave ON leave_days (leave_id);

-- The overlap guard. Partial, so Rejected and Cancelled rows are kept for the
-- record but stop reserving the date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_days_no_overlap
  ON leave_days (employee_id, leave_date)
  WHERE status IN ('Pending', 'Approved');

ALTER TABLE leave_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_days_select ON leave_days;
CREATE POLICY leave_days_select ON leave_days
  FOR SELECT USING (
    is_account_member(account_id)
    AND (
      is_account_member(account_id, 'admin')
      OR employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      OR has_permission(auth.uid(), account_id, 'view_leaves')
      OR is_in_downline(
           (SELECT id FROM profiles WHERE user_id = auth.uid() AND account_id = leave_days.account_id),
           employee_id)
    )
  );

DROP POLICY IF EXISTS leave_days_insert ON leave_days;
CREATE POLICY leave_days_insert ON leave_days
  FOR INSERT WITH CHECK (
    is_account_member(account_id)
    AND (
      employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      OR is_account_member(account_id, 'admin')
      OR has_permission(auth.uid(), account_id, 'manage_leaves')
    )
  );

-- Day rows are deleted and re-inserted when a request is edited, so the overlap
-- index re-checks the new shape naturally.
DROP POLICY IF EXISTS leave_days_delete ON leave_days;
CREATE POLICY leave_days_delete ON leave_days
  FOR DELETE USING (
    is_account_member(account_id)
    AND (
      employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      OR is_account_member(account_id, 'admin')
      OR has_permission(auth.uid(), account_id, 'manage_leaves')
    )
  );

-- No UPDATE policy: status is mirrored from the parent by a SECURITY DEFINER
-- trigger (below), and nothing else may edit a day row in place.


-- ─────────────────────────────────────────────────────────────
-- 5. Status cascade — keep leave_days.status in step with its parent
--    SECURITY DEFINER because the parent update was already authorised by the
--    leaves policies; re-deriving that permission per child row would mean an
--    approving manager also needed write rights on leave_days.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_leave_days_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE leave_days SET status = NEW.status WHERE leave_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sync_leave_days_status
  AFTER UPDATE OF status ON leaves
  FOR EACH ROW EXECUTE FUNCTION sync_leave_days_status();


-- ─────────────────────────────────────────────────────────────
-- 6. Numbering — LV-YYYY-NNNNNN, copied from get_next_payment_number
-- ─────────────────────────────────────────────────────────────
ALTER TABLE account_sequences ADD COLUMN IF NOT EXISTS leave_seq BIGINT DEFAULT 0;

CREATE OR REPLACE FUNCTION get_next_leave_number(p_account_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE v_seq BIGINT; v_year TEXT;
BEGIN
  v_year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  INSERT INTO account_sequences (account_id, leave_seq)
  VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
  SET leave_seq = COALESCE(account_sequences.leave_seq, 0) + 1
  RETURNING leave_seq INTO v_seq;
  RETURN 'LV-' || v_year || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION trg_set_leave_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.leave_number IS NULL OR NEW.leave_number = '' THEN
    NEW.leave_number := get_next_leave_number(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER set_leave_number_trigger
  BEFORE INSERT ON leaves
  FOR EACH ROW EXECUTE FUNCTION trg_set_leave_number();


-- ─────────────────────────────────────────────────────────────
-- 7. Working days + holiday awareness
--
--    accounts.settings.tracking_settings.working_days is an int array,
--    0 = Sunday … 6 = Saturday. Default Mon–Sat, which is the norm for the
--    field-sales SMBs this product sells to. The attendance page previously
--    hardcoded Mon–Fri, so this changes the Total Days figure already on
--    screen — deliberately, because that figure was wrong for a six-day week.
-- ─────────────────────────────────────────────────────────────
-- Merged with || rather than jsonb_set: jsonb_set's create_missing only creates
-- the FINAL key, so accounts whose settings had no tracking_settings object at
-- all were silently skipped (this was caught in verification — 15 of 17 accounts
-- were missed). The nested merge builds the intermediate level while preserving
-- any existing start_time / end_time / interval_minutes / grace_minutes.
UPDATE accounts
   SET settings = COALESCE(settings, '{}'::jsonb)
                  || jsonb_build_object(
                       'tracking_settings',
                       COALESCE(settings->'tracking_settings', '{}'::jsonb)
                       || jsonb_build_object('working_days', '[1,2,3,4,5,6]'::jsonb))
 WHERE NOT (COALESCE(settings->'tracking_settings', '{}'::jsonb) ? 'working_days');

CREATE OR REPLACE FUNCTION account_working_days(p_account_id UUID)
RETURNS INT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT array_agg(value::int)
       FROM accounts a,
            jsonb_array_elements_text(a.settings->'tracking_settings'->'working_days') AS value
      WHERE a.id = p_account_id),
    ARRAY[1, 2, 3, 4, 5, 6]
  );
$$;

-- The dates in [from, to] an employee can actually take as leave: working days
-- of the account, minus configured holidays. One definition, used by every RPC
-- below so the client can never book a Sunday or a holiday by sending its own
-- list.
CREATE OR REPLACE FUNCTION leave_eligible_dates(p_account_id UUID, p_from DATE, p_to DATE)
RETURNS SETOF DATE
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT d::date
    FROM generate_series(p_from, p_to, interval '1 day') AS d
   WHERE EXTRACT(DOW FROM d)::int = ANY (account_working_days(p_account_id))
     AND NOT EXISTS (
           SELECT 1 FROM holidays h
            WHERE h.account_id = p_account_id AND h.holiday_date = d::date);
$$;

CREATE OR REPLACE FUNCTION leave_day_value(p_weightage TEXT)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_weightage
           WHEN 'full'        THEN 1.00
           WHEN 'first_half'  THEN 0.50
           WHEN 'second_half' THEN 0.50
           WHEN 'quarter'     THEN 0.25
         END::numeric;
$$;


-- ─────────────────────────────────────────────────────────────
-- 8. Status transitions
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION leave_status_transition_allowed(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (p_from, p_to) IN (
    ('Pending', 'Approved'),
    ('Pending', 'Rejected'),
    ('Pending', 'Cancelled'),
    ('Approved', 'Cancelled')
  );
$$;


-- ─────────────────────────────────────────────────────────────
-- 9. Shared validation + day writing, used by create and update
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION write_leave_days(
  p_leave_id    UUID,
  p_account_id  UUID,
  p_employee_id UUID,
  p_from_date   DATE,
  p_to_date     DATE,
  p_days        JSONB,
  p_status      TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_eligible   DATE[];
  v_supplied   DATE[];
  v_total      NUMERIC := 0;
  v_missing    DATE;
BEGIN
  SELECT array_agg(d ORDER BY d) INTO v_eligible
    FROM leave_eligible_dates(p_account_id, p_from_date, p_to_date) AS d;

  IF v_eligible IS NULL OR array_length(v_eligible, 1) IS NULL THEN
    RAISE EXCEPTION 'This date range contains no working days'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT array_agg(DISTINCT (elem->>'date')::date ORDER BY (elem->>'date')::date)
    INTO v_supplied
    FROM jsonb_array_elements(p_days) AS elem;

  -- The client sends what it believes the days are; the server recomputes them
  -- and refuses a mismatch, so a stale app holding an old holiday list cannot
  -- book a holiday as leave.
  IF v_supplied IS DISTINCT FROM v_eligible THEN
    RAISE EXCEPTION 'The selected days do not match the leave dates'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_days) AS elem
     WHERE leave_day_value(elem->>'weightage') IS NULL
  ) THEN
    RAISE EXCEPTION 'Unknown leave weightage' USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO leave_days (leave_id, account_id, employee_id, leave_date, weightage, day_value, status)
    SELECT p_leave_id,
           p_account_id,
           p_employee_id,
           (elem->>'date')::date,
           elem->>'weightage',
           leave_day_value(elem->>'weightage'),
           p_status
      FROM jsonb_array_elements(p_days) AS elem;
  EXCEPTION WHEN unique_violation THEN
    -- Turn the partial-unique-index rejection into something a human can act on.
    SELECT (elem->>'date')::date INTO v_missing
      FROM jsonb_array_elements(p_days) AS elem
     WHERE EXISTS (
             SELECT 1 FROM leave_days ld
              WHERE ld.employee_id = p_employee_id
                AND ld.leave_date = (elem->>'date')::date
                AND ld.status IN ('Pending', 'Approved')
                AND ld.leave_id <> p_leave_id)
     LIMIT 1;
    RAISE EXCEPTION 'Leave already exists for %', COALESCE(v_missing::text, 'one of these dates')
      USING ERRCODE = 'unique_violation';
  END;

  SELECT COALESCE(SUM(day_value), 0) INTO v_total
    FROM leave_days WHERE leave_id = p_leave_id;

  RETURN v_total;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 10. create_leave_request
--     SECURITY INVOKER: tenancy still comes from RLS and auth.uid() is the
--     caller. The RPC exists because four rules cannot live in a form — the
--     past-date restriction, the range expansion, the overlap message, and the
--     audit entry.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_leave_request(
  p_employee_id     UUID,
  p_leave_type_id   UUID,
  p_from_date       DATE,
  p_to_date         DATE,
  p_days            JSONB,
  p_reason          TEXT,
  p_attachment_url  TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL,
  p_leave_id        UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_account_id  UUID;
  v_caller      UUID;
  v_is_admin    BOOLEAN;
  v_on_behalf   BOOLEAN;
  v_leave_id    UUID := COALESCE(p_leave_id, gen_random_uuid());
  v_total       NUMERIC;
  v_backdated   BOOLEAN;
  v_result      JSONB;
BEGIN
  SELECT account_id INTO v_account_id FROM profiles WHERE id = p_employee_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT is_account_member(v_account_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO v_caller FROM profiles
   WHERE user_id = auth.uid() AND account_id = v_account_id;
  v_is_admin  := is_account_member(v_account_id, 'admin');
  v_on_behalf := v_caller IS DISTINCT FROM p_employee_id;

  IF v_on_behalf AND NOT (v_is_admin OR has_permission(auth.uid(), v_account_id, 'manage_leaves')) THEN
    RAISE EXCEPTION 'You do not have permission to apply on someone else''s behalf'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Backdating is an admin action. Note CURRENT_DATE is the database's date;
  -- for a tenant east of UTC this can be permissive by up to a day, never
  -- restrictive, which is the right direction to fail in.
  v_backdated := p_from_date < CURRENT_DATE;
  IF v_backdated AND NOT (v_is_admin OR has_permission(auth.uid(), v_account_id, 'manage_leaves')) THEN
    RAISE EXCEPTION 'Leave cannot be applied for a past date'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM leave_types
     WHERE id = p_leave_type_id AND account_id = v_account_id AND status = 'Active'
  ) THEN
    RAISE EXCEPTION 'That leave type is not available' USING ERRCODE = 'check_violation';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required' USING ERRCODE = 'check_violation';
  END IF;

  IF p_to_date < p_from_date THEN
    RAISE EXCEPTION 'The end date cannot be before the start date' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotency for a retried client call: if this id already exists, return it
  -- rather than creating a second request (and burning a leave number).
  IF EXISTS (SELECT 1 FROM leaves WHERE id = v_leave_id) THEN
    SELECT to_jsonb(l) INTO v_result FROM leaves l WHERE l.id = v_leave_id;
    RETURN v_result;
  END IF;

  INSERT INTO leaves (
    id, account_id, employee_id, leave_type_id, from_date, to_date,
    total_days, reason, status, applied_by, is_backdated,
    attachment_url, attachment_name
  ) VALUES (
    v_leave_id, v_account_id, p_employee_id, p_leave_type_id, p_from_date, p_to_date,
    0, btrim(p_reason), 'Pending', v_caller, v_backdated,
    p_attachment_url, p_attachment_name
  );

  v_total := write_leave_days(v_leave_id, v_account_id, p_employee_id,
                              p_from_date, p_to_date, p_days, 'Pending');

  UPDATE leaves SET total_days = v_total WHERE id = v_leave_id;

  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
  VALUES (v_account_id, auth.uid(), 'leave', v_leave_id, 'leave_applied',
          CASE WHEN v_on_behalf THEN 'Leave applied on behalf of the employee'
               ELSE 'Leave applied' END,
          jsonb_build_object('from_date', p_from_date, 'to_date', p_to_date,
                             'total_days', v_total, 'on_behalf', v_on_behalf,
                             'backdated', v_backdated));

  SELECT to_jsonb(l) INTO v_result FROM leaves l WHERE l.id = v_leave_id;
  RETURN v_result;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 11. update_leave_status
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_leave_status(
  p_leave_id   UUID,
  p_new_status TEXT,
  p_reason     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_leave      RECORD;
  v_caller     UUID;
  v_is_admin   BOOLEAN;
  v_is_self    BOOLEAN;
  v_may_decide BOOLEAN;
  v_result     JSONB;
BEGIN
  SELECT * INTO v_leave FROM leaves WHERE id = p_leave_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave not found or not accessible';
  END IF;

  IF NOT is_account_member(v_leave.account_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO v_caller FROM profiles
   WHERE user_id = auth.uid() AND account_id = v_leave.account_id;
  v_is_admin := is_account_member(v_leave.account_id, 'admin');
  v_is_self  := v_caller IS NOT DISTINCT FROM v_leave.employee_id;

  IF v_leave.status = p_new_status THEN
    RETURN jsonb_build_object('id', p_leave_id, 'status', v_leave.status, 'unchanged', true);
  END IF;

  IF NOT leave_status_transition_allowed(v_leave.status, p_new_status) THEN
    RAISE EXCEPTION 'Cannot move a % leave to %', v_leave.status, p_new_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_new_status IN ('Approved', 'Rejected') THEN
    v_may_decide := v_is_admin
                    OR has_permission(auth.uid(), v_leave.account_id, 'approve_leaves')
                    OR is_in_downline(v_caller, v_leave.employee_id);
    IF NOT v_may_decide THEN
      RAISE EXCEPTION 'You do not have permission to approve or reject leave'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- A manager cannot sign off their own leave. An owner/admin can, because a
    -- single-admin account would otherwise have no way to approve anything;
    -- the log records it as a self-approval so it is visible, not hidden.
    IF v_is_self AND NOT v_is_admin THEN
      RAISE EXCEPTION 'You cannot approve your own leave'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_new_status = 'Rejected' AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
      RAISE EXCEPTION 'A reason is required to reject leave' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- Cancellation: your own Pending request, or an admin / manage_leaves holder.
    IF NOT (v_is_admin
            OR has_permission(auth.uid(), v_leave.account_id, 'manage_leaves')
            OR (v_is_self AND v_leave.status = 'Pending')) THEN
      RAISE EXCEPTION 'You do not have permission to cancel this leave'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT v_is_self AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
      RAISE EXCEPTION 'A reason is required to cancel someone else''s leave'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE leaves
     SET status              = p_new_status,
         approved_by         = CASE WHEN p_new_status = 'Approved'  THEN auth.uid() ELSE approved_by END,
         approved_at         = CASE WHEN p_new_status = 'Approved'  THEN NOW()      ELSE approved_at END,
         rejected_by         = CASE WHEN p_new_status = 'Rejected'  THEN auth.uid() ELSE rejected_by END,
         rejected_at         = CASE WHEN p_new_status = 'Rejected'  THEN NOW()      ELSE rejected_at END,
         rejection_reason    = CASE WHEN p_new_status = 'Rejected'  THEN btrim(p_reason) ELSE rejection_reason END,
         cancelled_by        = CASE WHEN p_new_status = 'Cancelled' THEN auth.uid() ELSE cancelled_by END,
         cancelled_at        = CASE WHEN p_new_status = 'Cancelled' THEN NOW()      ELSE cancelled_at END,
         cancellation_reason = CASE WHEN p_new_status = 'Cancelled' THEN NULLIF(btrim(COALESCE(p_reason, '')), '') ELSE cancellation_reason END
   WHERE id = p_leave_id;

  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
  VALUES (v_leave.account_id, auth.uid(), 'leave', p_leave_id,
          'leave_' || lower(p_new_status),
          'Leave ' || lower(p_new_status),
          jsonb_build_object('from_status', v_leave.status, 'to_status', p_new_status,
                             'reason', NULLIF(btrim(COALESCE(p_reason, '')), ''),
                             'self_approved', (v_is_self AND p_new_status = 'Approved')));

  SELECT to_jsonb(l) INTO v_result FROM leaves l WHERE l.id = p_leave_id;
  RETURN v_result;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 12. update_leave_request — edit dates / type / weightage / reason
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_leave_request(
  p_leave_id        UUID,
  p_leave_type_id   UUID,
  p_from_date       DATE,
  p_to_date         DATE,
  p_days            JSONB,
  p_reason          TEXT,
  p_change_reason   TEXT DEFAULT NULL,
  p_attachment_url  TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_leave    RECORD;
  v_caller   UUID;
  v_is_admin BOOLEAN;
  v_is_self  BOOLEAN;
  v_manage   BOOLEAN;
  v_total    NUMERIC;
  v_result   JSONB;
BEGIN
  SELECT * INTO v_leave FROM leaves WHERE id = p_leave_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave not found or not accessible';
  END IF;

  IF NOT is_account_member(v_leave.account_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO v_caller FROM profiles
   WHERE user_id = auth.uid() AND account_id = v_leave.account_id;
  v_is_admin := is_account_member(v_leave.account_id, 'admin');
  v_is_self  := v_caller IS NOT DISTINCT FROM v_leave.employee_id;
  v_manage   := v_is_admin OR has_permission(auth.uid(), v_leave.account_id, 'manage_leaves');

  IF v_leave.status IN ('Rejected', 'Cancelled') THEN
    RAISE EXCEPTION 'A % leave cannot be edited — apply again instead', lower(v_leave.status)
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_manage THEN
    IF NOT (v_is_self AND v_leave.status = 'Pending') THEN
      RAISE EXCEPTION 'You can only edit your own leave while it is pending'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_leave.status <> 'Pending' OR NOT v_is_self THEN
    -- Anyone editing someone else's request, or any request already decided,
    -- must say why. That reason is what the employee sees later.
    IF p_change_reason IS NULL OR length(btrim(p_change_reason)) = 0 THEN
      RAISE EXCEPTION 'A reason is required to edit this leave' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required' USING ERRCODE = 'check_violation';
  END IF;

  IF p_to_date < p_from_date THEN
    RAISE EXCEPTION 'The end date cannot be before the start date' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM leave_types
     WHERE id = p_leave_type_id AND account_id = v_leave.account_id AND status = 'Active'
  ) THEN
    RAISE EXCEPTION 'That leave type is not available' USING ERRCODE = 'check_violation';
  END IF;

  IF p_from_date < CURRENT_DATE AND NOT v_manage THEN
    RAISE EXCEPTION 'Leave cannot be applied for a past date' USING ERRCODE = 'check_violation';
  END IF;

  -- WHERE-qualified: pg_safeupdate rejects an unqualified DELETE on the
  -- authenticated connection, and that failure only shows up over REST.
  DELETE FROM leave_days WHERE leave_id = p_leave_id;

  v_total := write_leave_days(p_leave_id, v_leave.account_id, v_leave.employee_id,
                              p_from_date, p_to_date, p_days, v_leave.status);

  UPDATE leaves
     SET leave_type_id   = p_leave_type_id,
         from_date       = p_from_date,
         to_date         = p_to_date,
         total_days      = v_total,
         reason          = btrim(p_reason),
         is_backdated    = (p_from_date < CURRENT_DATE),
         attachment_url  = COALESCE(p_attachment_url, attachment_url),
         attachment_name = COALESCE(p_attachment_name, attachment_name)
   WHERE id = p_leave_id;

  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
  VALUES (v_leave.account_id, auth.uid(), 'leave', p_leave_id, 'leave_edited', 'Leave edited',
          jsonb_build_object(
            'change_reason', NULLIF(btrim(COALESCE(p_change_reason, '')), ''),
            'before', jsonb_build_object('from_date', v_leave.from_date, 'to_date', v_leave.to_date,
                                         'total_days', v_leave.total_days,
                                         'leave_type_id', v_leave.leave_type_id,
                                         'reason', v_leave.reason),
            'after',  jsonb_build_object('from_date', p_from_date, 'to_date', p_to_date,
                                         'total_days', v_total,
                                         'leave_type_id', p_leave_type_id,
                                         'reason', btrim(p_reason))));

  SELECT to_jsonb(l) INTO v_result FROM leaves l WHERE l.id = p_leave_id;
  RETURN v_result;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 13. Grants — authenticated only. REVOKE FROM PUBLIC, not just anon
--     (migration 112 learned this the hard way).
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION sync_leave_days_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION trg_set_leave_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION write_leave_days(UUID, UUID, UUID, DATE, DATE, JSONB, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION get_next_leave_number(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_working_days(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION leave_eligible_dates(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION leave_day_value(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION leave_status_transition_allowed(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_leave_request(UUID, UUID, DATE, DATE, JSONB, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_leave_status(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_leave_request(UUID, UUID, DATE, DATE, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION account_working_days(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION leave_eligible_dates(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION leave_day_value(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION leave_status_transition_allowed(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_leave_request(UUID, UUID, DATE, DATE, JSONB, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_leave_status(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_leave_request(UUID, UUID, DATE, DATE, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated;
-- get_next_leave_number and write_leave_days are internal helpers called by the
-- trigger / the RPCs, which already run as the caller. No direct grant.
GRANT EXECUTE ON FUNCTION get_next_leave_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION write_leave_days(UUID, UUID, UUID, DATE, DATE, JSONB, TEXT) TO authenticated;
