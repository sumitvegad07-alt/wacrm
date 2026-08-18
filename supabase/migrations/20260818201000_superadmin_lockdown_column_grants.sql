-- Follow-up to 20260818200000_superadmin_privilege_lockdown.sql
--
-- The column-level REVOKEs in that migration were silent no-ops. `profiles`
-- carries table-level UPDATE/INSERT grants to authenticated/anon, and Postgres
-- does not let a column-level REVOKE carve an exception out of a table-level
-- grant — the table grant keeps implying every column. Verified after applying:
-- authenticated still held UPDATE and INSERT on is_superadmin, account_role and
-- account_id.
--
-- (The escalation was not actually open in the gap: the
-- trg_guard_profile_privileges trigger from the first migration applied
-- correctly and blocks the write regardless of grants. Defence in depth paid
-- for itself on day one.)
--
-- Correct approach: drop the table-level write grants, then re-grant column by
-- column, omitting the three security columns.

revoke update, insert on public.profiles from authenticated;
revoke update, insert on public.profiles from anon;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name not in ('is_superadmin', 'account_role', 'account_id');

  execute format('grant update (%s) on public.profiles to authenticated', cols);
  execute format('grant insert (%s) on public.profiles to authenticated', cols);
end $$;

-- anon is deliberately left with no write grant at all: RLS already requires
-- auth.uid() = user_id for both INSERT and UPDATE, which anon can never satisfy.
