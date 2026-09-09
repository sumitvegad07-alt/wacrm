-- New-account master defaults (backfill for every existing tenant + shipped for
-- new accounts via the provision-account route).
-- ---------------------------------------------------------------------------
-- All inserts are ADDITIVE and idempotent: an account's own custom rows are
-- never touched, and a default is inserted only when the same-named row is
-- absent (case-insensitive). Safe to run more than once.
--
--   • Lead Sources    — Facebook, Instagram, Google Ads, Cold Call, IndiaMart
--   • Lead Industries — Agriculture, Garment, Manufacturing, Pharma
--   • Leave Types     — Casual Leave, Medical Leave, Maternity Leave
--   • Holiday List    — one default list (Sunday weekly off) per account that
--                       has none, so Sales Executives inherit it automatically.
--   • Price floor     — default OFF: accounts that never chose get
--                       order_settings.enforce_price_floor = false (accounts
--                       that explicitly enabled it keep it).

-- ── 1. Lead Sources ────────────────────────────────────────────────────────
WITH defaults(name, color, position) AS (
  VALUES
    ('Facebook',   '#1877f2', 0),
    ('Instagram',  '#e1306c', 1),
    ('Google Ads', '#34a853', 2),
    ('Cold Call',  '#f59e0b', 3),
    ('IndiaMart',  '#ef4444', 4)
)
INSERT INTO public.lead_sources (account_id, name, color, position)
SELECT a.id, d.name, d.color, d.position
FROM public.accounts a
CROSS JOIN defaults d
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_sources ls
  WHERE ls.account_id = a.id AND lower(ls.name) = lower(d.name)
);

-- ── 2. Lead Industries ─────────────────────────────────────────────────────
WITH defaults(name, color, position) AS (
  VALUES
    ('Agriculture',   '#22c55e', 0),
    ('Garment',       '#8b5cf6', 1),
    ('Manufacturing', '#3b82f6', 2),
    ('Pharma',        '#06b6d4', 3)
)
INSERT INTO public.lead_industries (account_id, name, color, position)
SELECT a.id, d.name, d.color, d.position
FROM public.accounts a
CROSS JOIN defaults d
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_industries li
  WHERE li.account_id = a.id AND lower(li.name) = lower(d.name)
);

-- ── 3. Leave Types ─────────────────────────────────────────────────────────
-- created_by is the account owner (best available author for a backfill).
WITH defaults(name) AS (
  VALUES ('Casual Leave'), ('Medical Leave'), ('Maternity Leave')
)
INSERT INTO public.leave_types (account_id, name, status, created_by)
SELECT a.id, d.name, 'Active', a.owner_user_id
FROM public.accounts a
CROSS JOIN defaults d
WHERE NOT EXISTS (
  SELECT 1 FROM public.leave_types lt
  WHERE lt.account_id = a.id AND lower(lt.name) = lower(d.name)
);

-- ── 4. Default Holiday List ────────────────────────────────────────────────
-- One default list (Sunday off) for any account that has no holiday list yet.
-- Assigned automatically to employees as the account default, so admins don't
-- have to create one before attendance/leaves work for Sales Executives.
INSERT INTO public.holiday_lists (account_id, name, weekly_offs, is_default, created_by)
SELECT a.id, 'Default Holiday List', ARRAY[0], TRUE, a.owner_user_id
FROM public.accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM public.holiday_lists hl WHERE hl.account_id = a.id
);

-- ── 5. Price floor default OFF ─────────────────────────────────────────────
-- Only accounts that never set the flag are affected; explicit choices are kept.
UPDATE public.accounts
SET settings =
  COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object(
       'order_settings',
       COALESCE(settings -> 'order_settings', '{}'::jsonb)
         || jsonb_build_object('enforce_price_floor', false)
     )
WHERE (settings -> 'order_settings' ->> 'enforce_price_floor') IS NULL;
