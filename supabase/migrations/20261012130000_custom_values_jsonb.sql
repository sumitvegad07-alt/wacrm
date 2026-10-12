-- Custom field values, denormalised onto the parent row as JSONB.
--
-- Two problems this solves, both created by moving list screens to server-side
-- paging:
--
-- 1. Every list screen has per-column filters, and custom fields get one each
--    (`cf_<field id>`). Those values live in a child table, and PostgREST
--    cannot express "the row has a child with THIS field id AND that value"
--    for more than one field at a time — an embedded `!inner` filter ANDs both
--    conditions against the SAME child row, so two custom-field filters at
--    once would always return nothing. A JSONB map on the parent ANDs
--    naturally: `custom_values->>cf_a ilike x AND custom_values->>cf_b = y`.
--
-- 2. Each screen fetched the whole child table to render its custom columns.
--    With the map on the row, the list query already carries them.
--
-- Shape is exactly what the UI already expects: {"cf_<field id>": "<value>"},
-- the same keys `matchesSearchableCustomFields` and the column renderers use.
--
-- Generated in a loop rather than written out ten times. This is one-off DDL,
-- so dynamic SQL is appropriate here; the triggers it creates are static.

do $$
declare
  m record;
begin
  for m in
    select * from (values
      ('orders',           'order_custom_values',     'order_id'),
      ('order_dispatches', 'dispatch_custom_values',  'dispatch_id'),
      ('expenses',         'expense_custom_values',   'expense_id'),
      ('payments',         'payment_custom_values',   'payment_id'),
      ('leads',            'lead_custom_values',      'lead_id'),
      ('tasks',            'task_custom_values',      'task_id'),
      ('contacts',         'contact_custom_values',   'contact_id'),
      ('products',         'product_custom_values',   'product_id'),
      ('quotations',       'quotation_custom_values', 'quotation_id'),
      ('deals',            'deal_custom_values',      'deal_id')
    ) as t(parent, child, fk)
  loop
    execute format('alter table public.%I add column if not exists custom_values jsonb', m.parent);

    -- {"cf_<field id>": "<value>"} for every active custom field with a value.
    -- Not restricted to is_searchable: this one backs the COLUMN FILTERS and
    -- the column renderers, which show fields that are filterable but not
    -- searchable. search_text stays searchable-only.
    execute format($f$
      create or replace function public.%I(p_id uuid)
      returns jsonb language sql stable security definer
      set search_path = public, pg_temp as $body$
        select coalesce(
          jsonb_object_agg('cf_' || v.custom_field_id::text, v.value)
            filter (where v.value is not null and v.value <> ''),
          '{}'::jsonb)
        from public.%I v
        join public.custom_fields f on f.id = v.custom_field_id
        where v.%I = p_id and coalesce(f.is_active, true);
      $body$;
    $f$, m.parent || '_custom_values_json', m.child, m.fk);

    -- Child writes refresh the parent's map.
    execute format($f$
      create or replace function public.%I()
      returns trigger language plpgsql security definer
      set search_path = public, pg_temp as $body$
      declare v_id uuid := coalesce(new.%I, old.%I);
      begin
        update public.%I p
           set custom_values = public.%I(p.id)
         where p.id = v_id;
        return null;
      end;
      $body$;
    $f$, m.parent || '_refresh_custom_values', m.fk, m.fk, m.parent,
         m.parent || '_custom_values_json');

    execute format('drop trigger if exists %I on public.%I',
                   m.child || '_refresh_custom_values', m.child);
    execute format($f$
      create trigger %I after insert or update or delete on public.%I
      for each row execute function public.%I();
    $f$, m.child || '_refresh_custom_values', m.child,
         m.parent || '_refresh_custom_values');

    -- Backfill. Disabling every user trigger on the parent is the uniform,
    -- safe way to do this across ten tables with different trigger sets:
    -- several of them restamp updated_at (mobile sync pages by it) or raise on
    -- validation. The disable takes an ACCESS EXCLUSIVE lock, so concurrent
    -- writers wait rather than slipping past validation, and the whole thing is
    -- inside this migration's transaction.
    execute format('alter table public.%I disable trigger user', m.parent);
    execute format(
      'update public.%I p set custom_values = public.%I(p.id) where p.custom_values is null',
      m.parent, m.parent || '_custom_values_json');
    execute format('alter table public.%I enable trigger user', m.parent);

    -- GIN index so a custom-field filter is an index scan, not a seq scan.
    execute format('create index if not exists %I on public.%I using gin (custom_values)',
                   m.parent || '_custom_values_gin', m.parent);
  end loop;
end
$$;
