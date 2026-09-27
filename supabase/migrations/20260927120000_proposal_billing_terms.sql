-- ============================================================
-- Billing terms on proposals.
--
-- OZZO now sells quarterly (+40%) and half-yearly (+20%) alongside yearly, so a
-- proposal has to say which one it is quoting. Two consequences for this table:
--
--   1. `billing_term` records the term, and `term_total` records what ONE
--      invoice charges, pre-GST.
--   2. `annual_total` changes meaning: it becomes the ANNUALISED run-rate, so a
--      quarterly proposal and a yearly one can sit in the same list and be
--      compared. For a yearly proposal the figure is unchanged, which is why
--      this is safe to redefine rather than add a third column.
--
-- The payload also changes: `data.lineItems[].rate` was rupees per user per
-- YEAR and becomes rupees per user per MONTH, because per-month is the only
-- basis that survives a change of term without the number changing meaning.
-- The three existing proposals are drafts written on 2026-09-26 at whole-rupee
-- yearly rates (3300, 1800, 2400), so dividing by 12 is exact — 275, 150, 200 —
-- and their printed totals come out identical.
-- ============================================================

alter table public.platform_proposals
  add column if not exists billing_term text not null default 'yearly',
  add column if not exists term_total   numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'platform_proposals_billing_term_check'
  ) then
    alter table public.platform_proposals
      add constraint platform_proposals_billing_term_check
      check (billing_term in ('quarterly', 'half_yearly', 'yearly'));
  end if;
end $$;

comment on column public.platform_proposals.billing_term is
  'quarterly | half_yearly | yearly. Drives how many months each line amount covers.';
comment on column public.platform_proposals.term_total is
  'Net charged on ONE invoice, pre-GST.';
comment on column public.platform_proposals.annual_total is
  'Annualised run-rate, pre-GST — term_total x (12 / months in term). Comparable across terms.';

-- ── Migrate the existing payloads from per-year to per-month rates ──
--
-- Guarded on the absence of `billingTerm` so this is idempotent: a proposal
-- already carrying a term has already been converted and must not be divided
-- again. Every touched row was a draft at the time of writing.
update public.platform_proposals
set data = jsonb_set(
      jsonb_set(data, '{billingTerm}', '"yearly"'::jsonb, true),
      '{lineItems}',
      (
        select coalesce(jsonb_agg(jsonb_set(item, '{rate}',
                 to_jsonb(round((item->>'rate')::numeric / 12, 2)))), '[]'::jsonb)
        from jsonb_array_elements(coalesce(data->'lineItems', '[]'::jsonb)) as item
      ),
      true
    ),
    -- term_total keeps the pre-GST figure the row already held; on the yearly
    -- term the annualised value is the same number, so annual_total is untouched.
    term_total = annual_total
where not (data ? 'billingTerm');

-- A term-aware list and forecast filter on the term, so it is worth an index
-- only once there are many rows; the status/date indexes already cover the
-- queries that matter. Deliberately not adding one here.
