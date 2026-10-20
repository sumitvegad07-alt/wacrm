-- ============================================================
-- platform_subscriptions — the founder's own renewal register.
--
-- Platform data, not tenant data: RLS enabled with NO policies, nothing granted
-- to anon/authenticated, reached only through /api/admin/renewals behind
-- requireFounder() with the service-role key. Same posture as
-- platform_proposals (migration 20260926120000).
--
-- DELIBERATELY NOT DERIVED FROM `accounts`. The founder maintains these rows by
-- hand, because the platform tracks no salesman, no subscription start date and
-- no renewal amount, and because deriving them would keep re-creating rows for
-- test and dead tenants. `customer_id` is free text, not a foreign key, so a
-- customer who is not yet a tenant in the app can still be tracked.
--
-- This module has NO relationship to platform_invoices. Renewing does not raise
-- an invoice and paying an invoice does not move a date here. That separation is
-- the founder's instruction, not an oversight.
-- ============================================================

create table if not exists public.platform_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  customer_id     text not null default '',
  company_name    text not null,
  -- Free text with a picker in the UI: a legacy or custom package has to be
  -- recordable, and this register is the founder's book, not the entitlement
  -- system.
  plan            text not null default '',
  billing_term    text,
  users           integer not null default 0,
  amount          numeric(12,2) not null default 0,
  start_date      date not null,
  end_date        date not null,
  salesman_name   text not null default '',
  contact_person  text not null default '',
  phone           text not null default '',
  status          text not null default 'active',
  remarks         text not null default '',
  follow_up_date  date,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint platform_subscriptions_term_check
    check (billing_term is null or billing_term in ('quarterly', 'half_yearly', 'yearly')),
  constraint platform_subscriptions_status_check
    check (status in ('active', 'renewed', 'in_discussion', 'lost', 'on_hold')),
  constraint platform_subscriptions_dates_check
    check (end_date >= start_date)
);

comment on table public.platform_subscriptions is
  'The founder''s renewal register (founder-only), maintained by hand. RLS denies all; access via /api/admin/renewals with the service role. Unrelated to platform_invoices by design.';

-- The daily screen's only hot filter: "whose end_date is today".
create index if not exists platform_subscriptions_end_date_idx
  on public.platform_subscriptions (end_date);
create index if not exists platform_subscriptions_status_idx
  on public.platform_subscriptions (status);
create index if not exists platform_subscriptions_company_idx
  on public.platform_subscriptions (company_name);

-- ------------------------------------------------------------
-- Every period that has already been served, so the row can move forward
-- without losing what came before.
-- ------------------------------------------------------------
create table if not exists public.platform_subscription_periods (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
    references public.platform_subscriptions(id) on delete cascade,
  plan            text not null default '',
  billing_term    text,
  users           integer not null default 0,
  amount          numeric(12,2) not null default 0,
  start_date      date not null,
  end_date        date not null,
  renewed_at      timestamptz not null default now(),
  renewed_by      uuid references auth.users(id) on delete set null
);

comment on table public.platform_subscription_periods is
  'Past periods of a platform subscription (founder-only). Written by renew_platform_subscription(); never edited.';

create index if not exists platform_subscription_periods_sub_idx
  on public.platform_subscription_periods (subscription_id, start_date desc);

-- ------------------------------------------------------------
-- Archive-and-advance, in one statement's worth of atomicity.
--
-- Two separate writes from the API would leave a renewal half-done if the
-- second failed: the row moved forward with no history, or history written
-- twice on a retry. The row is locked FOR UPDATE so two clicks cannot both
-- archive the same period.
-- ------------------------------------------------------------
create or replace function public.renew_platform_subscription(
  p_id           uuid,
  p_plan         text,
  p_billing_term text,
  p_users        integer,
  p_amount       numeric,
  p_start_date   date,
  p_end_date     date,
  p_renewed_by   uuid
)
returns public.platform_subscriptions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.platform_subscriptions;
begin
  select * into v_row
    from public.platform_subscriptions
    where id = p_id
    for update;

  if not found then
    raise exception 'Subscription % not found', p_id;
  end if;

  if p_end_date < p_start_date then
    raise exception 'The new period ends (%) before it starts (%)', p_end_date, p_start_date;
  end if;

  insert into public.platform_subscription_periods (
    subscription_id, plan, billing_term, users, amount, start_date, end_date, renewed_by
  ) values (
    p_id, v_row.plan, v_row.billing_term, v_row.users, v_row.amount,
    v_row.start_date, v_row.end_date, p_renewed_by
  );

  update public.platform_subscriptions set
    -- coalesce: an omitted field keeps what the row already had, so a renewal
    -- that only moves the dates does not blank the plan or the amount.
    plan         = coalesce(p_plan, plan),
    billing_term = coalesce(p_billing_term, billing_term),
    users        = coalesce(p_users, users),
    amount       = coalesce(p_amount, amount),
    start_date   = p_start_date,
    end_date     = p_end_date,
    status       = 'active'
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.renew_platform_subscription is
  'Archives the current period into platform_subscription_periods and advances the row. Called by /api/admin/renewals/[id]/renew with the service role.';

create or replace function public.touch_platform_subscriptions_updated_at()
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

drop trigger if exists platform_subscriptions_touch_updated_at on public.platform_subscriptions;
create trigger platform_subscriptions_touch_updated_at
  before update on public.platform_subscriptions
  for each row execute function public.touch_platform_subscriptions_updated_at();

-- ------------------------------------------------------------
-- RLS on, deliberately no policies. Do not add one.
-- ------------------------------------------------------------
alter table public.platform_subscriptions enable row level security;
alter table public.platform_subscription_periods enable row level security;

revoke all on public.platform_subscriptions from anon, authenticated;
revoke all on public.platform_subscription_periods from anon, authenticated;

-- The function is SECURITY INVOKER, so a tenant calling it would hit the same
-- empty policy set — but revoking execute means they cannot even reach it.
revoke all on function public.renew_platform_subscription(
  uuid, text, text, integer, numeric, date, date, uuid
) from anon, authenticated;
