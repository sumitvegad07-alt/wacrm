-- ============================================================
-- platform_invoices — OZZO's own subscription invoices.
--
-- Platform data, not tenant data: no account scoping, RLS enabled with NO
-- policies, and nothing granted to anon/authenticated. Every read and write
-- goes through /api/admin/invoices behind requireFounder(), which then uses the
-- service-role key — the same pattern platform_proposals follows (migration
-- 20260926120000). Consequence: OZZO's billing history is unreachable by any
-- tenant, by a second superadmin, and by a compromised superadmin session.
--
-- The denormalised columns exist so the list, its filters and the outstanding
-- total are ordinary indexed queries. `data` holds the frozen document: seller
-- snapshot, buyer snapshot and line items as they were when the invoice was
-- issued, so a later edit to Invoice Settings or to a tenant's company profile
-- can never change a document that has already gone out.
-- ============================================================

create table if not exists public.platform_invoices (
  id                   uuid primary key default gen_random_uuid(),
  invoice_no           text not null,
  series               text not null default 'gst',
  fy                   text not null,
  seq                  integer not null,
  invoice_date         date not null default current_date,
  -- Nullable, ON DELETE SET NULL: deleting a tenant must never delete the
  -- invoice history that tenant was billed under.
  account_id           uuid references public.accounts(id) on delete set null,
  customer_id          text not null default '',
  client_name          text not null default '',
  plan                 text not null default '',
  billing_term         text not null default 'yearly',
  users_billed         integer not null default 0,
  period_start         date,
  period_end           date,
  gst_enabled          boolean not null default true,
  gst_rate             numeric(5,2) not null default 18,
  gst_type             text,
  place_of_supply_code text,
  subtotal             numeric(12,2) not null default 0,
  discount_amount      numeric(12,2) not null default 0,
  taxable_value        numeric(12,2) not null default 0,
  cgst_amount          numeric(12,2) not null default 0,
  sgst_amount          numeric(12,2) not null default 0,
  igst_amount          numeric(12,2) not null default 0,
  total                numeric(12,2) not null default 0,
  amount_received      numeric(12,2) not null default 0,
  status               text not null default 'draft',
  paid_at              date,
  data                 jsonb not null default '{}'::jsonb,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint platform_invoices_series_check
    check (series in ('gst', 'non_gst')),
  constraint platform_invoices_term_check
    check (billing_term in ('quarterly', 'half_yearly', 'yearly')),
  constraint platform_invoices_status_check
    check (status in ('draft', 'issued', 'part_paid', 'paid', 'cancelled')),
  -- gst_type is meaningful only on a GST invoice, and MUST be present on one.
  -- Pairing the two in a single constraint is what stops a non-GST invoice
  -- carrying a stale 'interstate' and a GST invoice carrying none.
  constraint platform_invoices_gst_type_check
    check (
      (gst_enabled and gst_type in ('intrastate', 'interstate', 'unknown'))
      or ((not gst_enabled) and gst_type is null)
    )
);

comment on table public.platform_invoices is
  'OZZO subscription invoices (founder-only). RLS denies all; access via /api/admin/invoices with the service role.';
comment on column public.platform_invoices.data is
  'Frozen document: seller snapshot, buyer snapshot, line items, notes, terms. Written on every save; authoritative for what was printed.';
comment on column public.platform_invoices.seq is
  'Counter within (series, fy). The unique index on (series, fy, seq) is what makes a duplicate number impossible rather than unlikely.';

create unique index if not exists platform_invoices_no_key
  on public.platform_invoices (invoice_no);
create unique index if not exists platform_invoices_series_fy_seq_key
  on public.platform_invoices (series, fy, seq);
create index if not exists platform_invoices_date_idx
  on public.platform_invoices (invoice_date desc);
create index if not exists platform_invoices_status_idx
  on public.platform_invoices (status);
create index if not exists platform_invoices_account_idx
  on public.platform_invoices (account_id);

-- ------------------------------------------------------------
-- Seller details. One row, enforced by the primary key itself: `id` is a
-- boolean constrained to true, so a second row collides on the PK.
-- ------------------------------------------------------------
create table if not exists public.platform_invoice_settings (
  id                      boolean primary key default true,
  firm_name               text not null default '',
  address                 text not null default '',
  pincode                 text not null default '',
  state                   text not null default '',
  gst_state_code          text not null default '',
  gstin                   text not null default '',
  pan                     text not null default '',
  phone                   text not null default '',
  email                   text not null default '',
  bank_name               text not null default '',
  bank_account_no         text not null default '',
  ifsc                    text not null default '',
  upi_id                  text not null default '',
  declaration             text not null default '',
  default_terms           text not null default '',
  signature_url           text,
  logo_url                text,
  -- "Start the series at this number instead of 1." For a financial year in
  -- which invoices were already issued outside the app.
  next_gst_seq_override     integer,
  next_non_gst_seq_override integer,
  updated_at              timestamptz not null default now(),

  constraint platform_invoice_settings_single_row check (id)
);

comment on table public.platform_invoice_settings is
  'OZZO''s own seller details for invoices (founder-only, exactly one row). RLS denies all.';

insert into public.platform_invoice_settings (id)
  values (true)
  on conflict (id) do nothing;

-- ------------------------------------------------------------
-- An issued invoice is cancelled, never deleted: GST requires a consecutive
-- series, and a deleted row leaves a hole in it.
-- ------------------------------------------------------------
create or replace function public.block_issued_invoice_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'draft' then
    raise exception
      'Invoice % is %, not a draft. Cancel it instead — deleting it would leave a gap in the % series.',
      old.invoice_no, old.status, old.series;
  end if;
  return old;
end;
$$;

drop trigger if exists platform_invoices_block_delete on public.platform_invoices;
create trigger platform_invoices_block_delete
  before delete on public.platform_invoices
  for each row execute function public.block_issued_invoice_delete();

create or replace function public.touch_platform_invoices_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_invoices_touch_updated_at on public.platform_invoices;
create trigger platform_invoices_touch_updated_at
  before update on public.platform_invoices
  for each row execute function public.touch_platform_invoices_updated_at();

drop trigger if exists platform_invoice_settings_touch_updated_at on public.platform_invoice_settings;
create trigger platform_invoice_settings_touch_updated_at
  before update on public.platform_invoice_settings
  for each row execute function public.touch_platform_invoices_updated_at();

-- ------------------------------------------------------------
-- RLS on, deliberately no policies. Do not add one.
-- ------------------------------------------------------------
alter table public.platform_invoices enable row level security;
alter table public.platform_invoice_settings enable row level security;

revoke all on public.platform_invoices from anon, authenticated;
revoke all on public.platform_invoice_settings from anon, authenticated;
