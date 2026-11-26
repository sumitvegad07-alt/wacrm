-- ============================================================
-- platform_proposals: the price-table lines still say Android only.
--
-- The OZZO iOS app went live on the App Store on 10 November 2026. The
-- proposal said otherwise in three places, and two of them were fixed in code
-- on 26 November (the Platform availability clause, which is generated at
-- print time and therefore corrected itself on every proposal old and new;
-- and the per-plan defaults, which only affect proposals written from then
-- on).
--
-- The third is data. A line item's description is free text stored in
-- platform_proposals.data -> lineItems -> subLabel, typed when the proposal
-- was created, so every proposal already written still prints
--
--   "Android app + web dashboard · pipeline, attendance & visits"
--
-- in front of a client. The founder, looking at a freshly printed one: "in
-- your own browser where you collected screenshot still sayd no Iphone app".
-- This corrects those lines.
--
-- ── THE FIVE QUESTIONS ──
--
-- 1. What breaks if this runs twice?
--    Nothing. A line that already mentions iPhone is skipped by name, so the
--    second run matches no rows at all. That guard is not optional: without
--    it "Web + Android" would match inside "Web + Android & iPhone" and the
--    second run would produce "Web + Android & iPhone & iPhone".
--
-- 2. What else reads these columns, in EITHER repo and in supabase/tests?
--    data -> lineItems is read by lib/proposals/totals.ts (users, rate,
--    months, periodStart/End), by the document template (label, subLabel),
--    and by lib/invoices/from-proposal.ts when a quotation becomes an
--    invoice. Only `subLabel` is touched here, and only its text — no
--    key is added, renamed or removed, and nothing that multiplies is
--    touched, so not one figure on any proposal changes. Verify before
--    applying:
--      grep -rn "lineItems" /c/Wacrm/wacrm-web /c/Wacrm/ozzo-partner
--
-- 3. What happens to rows that already exist?
--    They are the point. Rows whose line items say nothing about Android are
--    left alone, as are rows that already mention iPhone, as are rows with no
--    lineItems array at all. A proposal the founder typed his own description
--    into is only changed if that description contains the exact phrase
--    "Android app" or "Web + Android" — and then only that phrase, with the
--    rest of his wording untouched.
--
--    This DOES edit text a human typed, which is normally off limits. It is
--    done here because the text is a factual claim about the product that is
--    now false, and because it goes out to clients unread.
--
-- 4. Which policy decides who may read the new rows?
--    None, unchanged. platform_proposals has RLS enabled with no policies at
--    all, deliberately — a policy there would expose OZZO's quoted prices to
--    every signed-in tenant user. This migration adds no policy and changes
--    none. It also adds no column.
--
-- 5. How is it undone?
--    There is no automatic undo: this rewrites text in place and keeps no
--    copy. To reverse it, run the same statement with the two replacements
--    swapped round ('Android & iPhone app' -> 'Android app', 'Web + Android &
--    iPhone' -> 'Web + Android'). Before running it the first time, a copy of
--    what it will touch can be kept with:
--      create table platform_proposals_sublabel_backup as
--        select id, data -> 'lineItems' as line_items
--        from public.platform_proposals;
--
-- ── SECOND-FK CHECK ──
--
-- Not applicable: no column, constraint or index is created.
-- ============================================================

update public.platform_proposals p
set data = jsonb_set(
      p.data,
      '{lineItems}',
      (
        select jsonb_agg(
                 case
                   -- Already correct, or nothing to correct. Listed first so
                   -- a second run is a no-op rather than a double edit.
                   when item ->> 'subLabel' is null then item
                   when item ->> 'subLabel' ilike '%iphone%' then item
                   when item ->> 'subLabel' like '%Web + Android%' then
                     jsonb_set(item, '{subLabel}',
                       to_jsonb(replace(item ->> 'subLabel',
                                        'Web + Android', 'Web + Android & iPhone')))
                   when item ->> 'subLabel' like '%Android app%' then
                     jsonb_set(item, '{subLabel}',
                       to_jsonb(replace(item ->> 'subLabel',
                                        'Android app', 'Android & iPhone app')))
                   else item
                 end
                 -- ORDER BY is not optional. jsonb_agg has no inherent order,
                 -- and these are the rows of a price table: re-ordering them
                 -- would reshuffle what the client reads line by line.
                 order by ordinality
               )
        from jsonb_array_elements(p.data -> 'lineItems') with ordinality as t(item, ordinality)
      )
    )
where jsonb_typeof(p.data -> 'lineItems') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(p.data -> 'lineItems') as x(item)
    where x.item ->> 'subLabel' not ilike '%iphone%'
      and (x.item ->> 'subLabel' like '%Android app%'
           or x.item ->> 'subLabel' like '%Web + Android%')
  );
