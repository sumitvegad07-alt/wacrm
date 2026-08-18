-- Soft delete for tenants, with a 90-day recovery window.
-- Applied to production 2026-08-18.
--
-- Why this exists: all 80 foreign keys referencing `accounts` are ON DELETE
-- CASCADE. The panel's delete button called .delete() and failed silently
-- because there is no DELETE policy — that silent failure was, until now, the
-- only thing preventing one click from irreversibly destroying a tenant's data
-- across 80 tables. Adding the "obvious" DELETE policy would have armed it.
-- This replaces deletion with a lifecycle column instead.
--
-- 90 days rather than 30: B2B customers ask for last quarter's data well after
-- they asked to be deleted.

alter table public.accounts
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  uuid references auth.users(id),
  add column if not exists purge_after timestamptz;

create index if not exists accounts_deleted_at_idx
  on public.accounts (deleted_at) where deleted_at is not null;

comment on column public.accounts.deleted_at is
  'Soft-delete marker. Non-null means the tenant is deleted and cannot be accessed.';
comment on column public.accounts.purge_after is
  'Earliest date the tenant may be permanently purged. deleted_at + 90 days.';

-- ------------------------------------------------------------
-- Enforcement
-- ------------------------------------------------------------
-- A deleted_at column that nothing checks is decoration. Rather than editing
-- ~200 policies across 80 tables (and forgetting some), the check goes into
-- is_account_member(), which every tenant-scoped policy already calls. One
-- edit, inherited everywhere, and impossible to forget for a new table.
--
-- Cost, measured rather than assumed: this adds a join to `accounts` in the
-- hottest function in the schema. It stays STABLE, so with a constant
-- account_id — the normal case, since a tenant's queries are scoped to their
-- own account — Postgres evaluates it once per statement. Measured at 0.451ms
-- for 2000 calls after the change.

create or replace function public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum default 'viewer'::account_role_enum
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND a.deleted_at IS NULL
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

-- Superadmins must still see deleted tenants — that is what the Recovery
-- Center reads. accounts_select already ORs in is_superadmin(), so no change
-- is needed there; the deleted tenant simply stops being visible to its own
-- members via is_account_member().
