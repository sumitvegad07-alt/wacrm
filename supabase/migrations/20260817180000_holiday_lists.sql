-- ============================================================================
-- 20260817180000_holiday_lists.sql — named, assignable holiday calendars
--
-- Replaces the single account-wide holiday calendar and the single account-wide
-- working week introduced by 20260817170000_leave_management.
--
-- Why: a company's field staff and its office staff routinely have different
-- weekly offs and different holidays. Working days and holidays therefore
-- resolve PER EMPLOYEE, through the holiday list assigned to them, with the
-- account's Default list as the fallback for anyone unassigned.
--
-- Weekly offs are stored as the days OFF, matching how the admin expresses it
-- ("set weekend"); working days are derived as 0..6 minus that set.
--
-- Also: leave numbers drop the year (founder decision) — LV-000001.
-- ============================================================================

CREATE TABLE IF NOT EXISTS holiday_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- 0 = Sunday … 6 = Saturday. Sunday off by default.
  weekly_offs INT[] NOT NULL DEFAULT ARRAY[0],
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holiday_lists_name_present CHECK (length(btrim(name)) > 0),
  -- Every entry must be a real weekday, and a seven-day weekend is refused: it
  -- would make every date a weekly off and wipe out every absence and every
  -- leave day at once.
  CONSTRAINT holiday_lists_weekly_offs_valid CHECK (
    weekly_offs <@ ARRAY[0,1,2,3,4,5,6]
    AND COALESCE(array_length(weekly_offs, 1), 0) < 7
  )
);

CREATE INDEX IF NOT EXISTS idx_holiday_lists_account ON holiday_lists (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_holiday_lists_account_name
  ON holiday_lists (account_id, lower(name));
-- Exactly one default per account: it is what an employee with no explicit
-- assignment falls back to.
CREATE UNIQUE INDEX IF NOT EXISTS idx_holiday_lists_one_default
  ON holiday_lists (account_id) WHERE is_default;

ALTER TABLE holiday_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS holiday_lists_select ON holiday_lists;
CREATE POLICY holiday_lists_select ON holiday_lists
  FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS holiday_lists_insert ON holiday_lists;
CREATE POLICY holiday_lists_insert ON holiday_lists
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS holiday_lists_update ON holiday_lists;
CREATE POLICY holiday_lists_update ON holiday_lists
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS holiday_lists_delete ON holiday_lists;
CREATE POLICY holiday_lists_delete ON holiday_lists
  FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE TRIGGER set_holiday_lists_updated_at
  BEFORE UPDATE ON holiday_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Seed one Default list per account ────────────────────────
-- weekly_offs is derived from the inverse of the account's existing
-- tracking_settings.working_days, so nobody's configured week silently changes.
INSERT INTO holiday_lists (account_id, name, weekly_offs, is_default)
SELECT a.id,
       'Default',
       COALESCE(
         (SELECT array_agg(d ORDER BY d)
            FROM generate_series(0, 6) AS d
           WHERE NOT (d = ANY (
             COALESCE(
               (SELECT array_agg(value::int)
                  FROM jsonb_array_elements_text(a.settings->'tracking_settings'->'working_days') AS value),
               ARRAY[1,2,3,4,5,6])))),
         ARRAY[0]),
       TRUE
  FROM accounts a
 WHERE NOT EXISTS (SELECT 1 FROM holiday_lists hl WHERE hl.account_id = a.id AND hl.is_default);

-- ── holidays now belong to a list ────────────────────────────
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS holiday_list_id UUID REFERENCES holiday_lists(id) ON DELETE CASCADE;

UPDATE holidays h
   SET holiday_list_id = hl.id
  FROM holiday_lists hl
 WHERE hl.account_id = h.account_id AND hl.is_default AND h.holiday_list_id IS NULL;

ALTER TABLE holidays ALTER COLUMN holiday_list_id SET NOT NULL;

ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_unique_date;
CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_list_date
  ON holidays (holiday_list_id, holiday_date);
CREATE INDEX IF NOT EXISTS idx_holidays_list ON holidays (holiday_list_id);

-- ── assignment ───────────────────────────────────────────────
-- NULL means "use the account's default list", so a new employee is never
-- without a calendar and nothing has to be backfilled when a list is added.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS holiday_list_id UUID REFERENCES holiday_lists(id) ON DELETE SET NULL;

-- ── resolution ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION employee_holiday_list(p_employee_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.holiday_list_id FROM profiles p WHERE p.id = p_employee_id),
    (SELECT hl.id FROM holiday_lists hl
       JOIN profiles p2 ON p2.account_id = hl.account_id
      WHERE p2.id = p_employee_id AND hl.is_default
      LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION employee_working_days(p_employee_id UUID)
RETURNS INT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT array_agg(d ORDER BY d)
       FROM generate_series(0, 6) AS d
      WHERE NOT (d = ANY (
        COALESCE((SELECT hl.weekly_offs FROM holiday_lists hl
                   WHERE hl.id = employee_holiday_list(p_employee_id)),
                 ARRAY[0])))),
    ARRAY[1,2,3,4,5,6]);
$$;

-- ── eligible dates, now per EMPLOYEE ─────────────────────────
-- Same signature as the old account-scoped version, so it is dropped first to
-- make the change of meaning explicit rather than silently rebinding it.
DROP FUNCTION IF EXISTS leave_eligible_dates(UUID, DATE, DATE);

CREATE FUNCTION leave_eligible_dates(p_employee_id UUID, p_from DATE, p_to DATE)
RETURNS SETOF DATE
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT d::date
    FROM generate_series(p_from, p_to, interval '1 day') AS d
   WHERE EXTRACT(DOW FROM d)::int = ANY (employee_working_days(p_employee_id))
     AND NOT EXISTS (
           SELECT 1 FROM holidays h
            WHERE h.holiday_list_id = employee_holiday_list(p_employee_id)
              AND h.holiday_date = d::date);
$$;

DROP FUNCTION IF EXISTS account_working_days(UUID);

-- ── write_leave_days now asks per employee, not per account ──
CREATE OR REPLACE FUNCTION write_leave_days(p_leave_id UUID, p_account_id UUID, p_employee_id UUID,
  p_from_date DATE, p_to_date DATE, p_days JSONB, p_status TEXT) RETURNS NUMERIC LANGUAGE plpgsql AS $fn$
DECLARE v_eligible DATE[]; v_supplied DATE[]; v_total NUMERIC := 0; v_missing DATE;
BEGIN
  SELECT array_agg(d ORDER BY d) INTO v_eligible FROM leave_eligible_dates(p_employee_id, p_from_date, p_to_date) AS d;
  IF v_eligible IS NULL OR array_length(v_eligible,1) IS NULL THEN
    RAISE EXCEPTION 'This date range contains no working days' USING ERRCODE='check_violation'; END IF;
  SELECT array_agg(DISTINCT (elem->>'date')::date ORDER BY (elem->>'date')::date) INTO v_supplied
    FROM jsonb_array_elements(p_days) AS elem;
  IF v_supplied IS DISTINCT FROM v_eligible THEN
    RAISE EXCEPTION 'The selected days do not match the leave dates' USING ERRCODE='check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_days) AS elem WHERE leave_day_value(elem->>'weightage') IS NULL) THEN
    RAISE EXCEPTION 'Unknown leave weightage' USING ERRCODE='check_violation'; END IF;
  BEGIN
    INSERT INTO leave_days (leave_id, account_id, employee_id, leave_date, weightage, day_value, status)
    SELECT p_leave_id, p_account_id, p_employee_id, (elem->>'date')::date, elem->>'weightage',
           leave_day_value(elem->>'weightage'), p_status FROM jsonb_array_elements(p_days) AS elem;
  EXCEPTION WHEN unique_violation THEN
    SELECT (elem->>'date')::date INTO v_missing FROM jsonb_array_elements(p_days) AS elem
     WHERE EXISTS (SELECT 1 FROM leave_days ld WHERE ld.employee_id = p_employee_id
        AND ld.leave_date = (elem->>'date')::date AND ld.status IN ('Pending','Approved') AND ld.leave_id <> p_leave_id) LIMIT 1;
    RAISE EXCEPTION 'Leave already exists for %', COALESCE(v_missing::text,'one of these dates') USING ERRCODE='unique_violation';
  END;
  SELECT COALESCE(SUM(day_value),0) INTO v_total FROM leave_days WHERE leave_id = p_leave_id;
  RETURN v_total; END; $fn$;

-- ── leave numbers lose the year (founder decision) ───────────
CREATE OR REPLACE FUNCTION get_next_leave_number(p_account_id UUID) RETURNS TEXT LANGUAGE plpgsql AS $fn$
DECLARE v_seq BIGINT;
BEGIN
  INSERT INTO account_sequences (account_id, leave_seq) VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE SET leave_seq = COALESCE(account_sequences.leave_seq,0) + 1
  RETURNING leave_seq INTO v_seq;
  RETURN 'LV-' || LPAD(v_seq::text, 6, '0');
END; $fn$;

REVOKE ALL ON FUNCTION employee_holiday_list(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION employee_working_days(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION leave_eligible_dates(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION employee_holiday_list(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION employee_working_days(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION leave_eligible_dates(UUID, DATE, DATE) TO authenticated;
