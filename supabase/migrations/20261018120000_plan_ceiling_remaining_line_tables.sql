-- ============================================================
-- 20261018120000_plan_ceiling_remaining_line_tables.sql
--
-- Extend the plan ceiling to the rest of the line-owned tables.
--
-- WHY. public.account_has_line() has existed since the plan_entitlement_db_backstop
-- migration, but only six tables ever used it, all on INSERT:
--     leads (crm) · deals (crm) · orders (sfa) · payments (sfa)
--     expenses (wfa) · site_visits (wfa)
-- plus the three FSM asset tables added in 20260929151000 / 20260929152000.
--
-- Every other line-owned table had NO plan ceiling at all: quotations (CRM),
-- order_dispatches (SFA), schemes (SFA), price_lists (SFA), stock_ledger (SFA),
-- territories (WFA), tracking_sessions (WFA) and conversations + broadcasts
-- (CRM). An off-plan tenant that reached the API — or the UI during the moment
-- before module settings resolve — could write rows for a module it has not
-- bought, and the database would accept them.
--
-- HOW. As RESTRICTIVE policies, deliberately, rather than by rewriting the
-- existing permissive ones with `... AND account_has_line(...)`:
--   * A restrictive policy is ANDed with whatever permissive policies a table
--     already has, so this migration does not have to know, reproduce, or risk
--     clobbering their current bodies.
--   * It is additive and re-runnable: drop-then-create, nothing else touched.
--
-- SCOPE: INSERT only, matching the existing six. A tenant that downgrades keeps
-- its history readable and does not get write errors on rows it already owns;
-- it simply cannot create new off-plan records. If you later want the stricter
-- rule, add the same CHECK as a restrictive FOR UPDATE policy — do NOT use
-- FOR ALL, which would also hide the retained data from SELECT.
--
-- NOT COVERED, on purpose: the child tables (quotation_items, dispatch_items,
-- scheme_slabs, scheme_products, scheme_customers, price_list_items) have no
-- account_id column of their own. Their parent is gated here, and a child row
-- needs a parent, so the ceiling reaches them through the FK.
--
-- NOTE: service_role bypasses RLS, so superadmin provisioning, the demo seeding
-- and the import RPCs are unaffected.
-- ============================================================

-- quotations — CRM line (module_settings.quotation is a CRM module).
drop policy if exists quotations_plan_ceiling on public.quotations;
create policy quotations_plan_ceiling on public.quotations
  as restrictive for insert to authenticated
  with check (public.account_has_line(account_id, 'crm'));

-- conversations + broadcasts — CRM line (WhatsApp suite).
drop policy if exists conversations_plan_ceiling on public.conversations;
create policy conversations_plan_ceiling on public.conversations
  as restrictive for insert to authenticated
  with check (public.account_has_line(account_id, 'crm'));

drop policy if exists broadcasts_plan_ceiling on public.broadcasts;
create policy broadcasts_plan_ceiling on public.broadcasts
  as restrictive for insert to authenticated
  with check (public.account_has_line(account_id, 'crm'));

-- order_dispatches — SFA line.
drop policy if exists order_dispatches_plan_ceiling on public.order_dispatches;
create policy order_dispatches_plan_ceiling on public.order_dispatches
  as restrictive for insert to authenticated
  with check (public.account_has_line(account_id, 'sfa'));

-- schemes — SFA line.
drop policy if exists schemes_plan_ceiling on public.schemes;
create policy schemes_plan_ceiling on public.schemes
  as restrictive for insert to authenticated
  with check (public.account_has_line(account_id, 'sfa'));

-- price_lists — SFA line.
drop policy if exists price_lists_plan_ceiling on public.price_lists;
create policy price_lists_plan_ceiling on public.price_lists
  as restrictive for insert to authenticated
  with check (public.account_has_line(account_id, 'sfa'));

-- stock_ledger — SFA line.
drop policy if exists stock_ledger_plan_ceiling on public.stock_ledger;
create policy stock_ledger_plan_ceiling on public.stock_ledger
  as restrictive for insert to authenticated
  with check (public.account_has_line(account_id, 'sfa'));

-- territories — WFA line.
drop policy if exists territories_plan_ceiling on public.territories;
create policy territories_plan_ceiling on public.territories
  as restrictive for insert to authenticated
  with check (public.account_has_line(account_id, 'wfa'));

-- tracking_sessions — WFA line (attendance punches and GPS sessions).
--
-- CAREFUL: punch in/out is sold in every column ("Attendance, Leave & Holiday
-- Management" appears in the CRM list too), so this is NOT gated on wfa. GPS
-- tracking is the WFA feature, and it hangs off user_locations, not off the
-- session row. Left ungated on purpose — recorded here so the next person does
-- not read the omission as an oversight and lock CRM-only tenants out of
-- punching in.

comment on policy quotations_plan_ceiling on public.quotations is
  'Plan ceiling: no new quotations without the CRM line. Restrictive, so it ANDs with the permissive policies.';
comment on policy order_dispatches_plan_ceiling on public.order_dispatches is
  'Plan ceiling: no new dispatches without the SFA line.';
comment on policy price_lists_plan_ceiling on public.price_lists is
  'Plan ceiling: no new price lists without the SFA line.';
comment on policy territories_plan_ceiling on public.territories is
  'Plan ceiling: no new territories without the WFA line.';
