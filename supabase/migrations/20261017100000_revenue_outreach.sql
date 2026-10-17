-- ============================================================
-- 20261017100000_revenue_outreach.sql
--
-- WhatsApp outreach for Lead Discovery prospects.
--
-- WHAT SENDS, AND WHY THAT SHAPES THIS
--
-- Not the Meta Cloud API. A Chrome extension drives the founder's own
-- WhatsApp Web session, because the numbers harvested from Google Maps never
-- opted in and the official API would reject the templates and tank the
-- number's quality rating before it rejected them.
--
-- The extension is deliberately stupid. It holds no cap, no window, no ramp
-- and no template: it asks `/next` for one number and one finished message,
-- sends it, and reports back. So every brake lives here and in
-- outreach-policy.ts, where it can be tested without loading an extension.
--
-- RLS IS ON WITH NO POLICIES
--
-- Platform-owner data, like re_discovery_* and retention_runs. Reachable only
-- through the service role after requireFounder() has passed. A policy here
-- would be a way in, not a protection.
-- ============================================================

-- ── Campaigns ──
create table if not exists public.re_outreach_campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  -- Two to four wordings, rotated per recipient. One message sent 20,000 times
  -- byte-identical is what bulk-send fingerprinting looks for.
  variants       text[] not null,
  attachment_path text,
  status         text not null default 'draft'
                 check (status in ('draft','running','paused','done','stopped')),
  daily_cap      integer not null default 80 check (daily_cap between 1 and 500),
  gap_min_sec    integer not null default 45 check (gap_min_sec >= 5),
  gap_max_sec    integer not null default 120,
  window_start   time not null default '10:00',
  window_end     time not null default '18:30',
  weekdays_only  boolean not null default true,
  -- Why the dead-man switch stopped it, shown on the page so a paused campaign
  -- is never a mystery.
  paused_reason  text,
  -- The number this campaign has been sending from. A mismatch against the
  -- extension's logged-in number pauses rather than silently switching.
  sender_phone   text,
  -- WHY A RESET MARKER AND NOT JUST COUNTING THE LAST FEW ROWS
  --
  -- The dead-man switch counts consecutive `failed` recipients. Those rows
  -- are still there after the founder fixes whatever broke, so pressing Start
  -- would recount the same three failures and re-pause instantly — a campaign
  -- that can never be resumed. Resuming stamps this, and only failures
  -- claimed after it count.
  failure_streak_reset_at timestamptz not null default now(),
  owner_id       uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint re_outreach_variants_count
    check (array_length(variants, 1) between 2 and 4),
  constraint re_outreach_gap_order check (gap_max_sec >= gap_min_sec)
);

-- ── Agents (installed extensions) ──
--
-- Declared before the recipients table, which references it.
create table if not exists public.re_outreach_agents (
  id                   uuid primary key default gen_random_uuid(),
  label                text not null default '',
  -- sha256 hex. The token itself is shown once, at mint, and never stored.
  token_hash           text not null unique,
  -- Reported by the extension on every call: the number WhatsApp Web is
  -- actually logged in as. The ramp and the cap are counted against THIS, not
  -- the campaign, so switching to a fresh number starts at day one.
  sender_phone         text,
  sender_first_sent_on date,
  last_seen_at         timestamptz,
  revoked_at           timestamptz,
  owner_id             uuid not null,
  created_at           timestamptz not null default now()
);

-- ── Recipients ──
create table if not exists public.re_outreach_recipients (
  id            bigserial primary key,
  campaign_id   uuid not null
                references public.re_outreach_campaigns (id) on delete cascade,
  place_id      text not null default '',
  -- Normalised by normalisePhone() in discovery-query.ts: 91XXXXXXXXXX.
  phone         text not null,
  -- Snapshotted, not joined. re_discovery_leads is purged after 90 days and a
  -- campaign at 80/day runs for weeks; a reference would start failing
  -- halfway through.
  name          text not null default '',
  city          text not null default '',
  district      text not null default '',
  state         text not null default '',
  industry      text not null default '',
  status        text not null default 'queued' check (status in (
                  'queued','in_flight','sent','failed',
                  'skipped_not_on_whatsapp','skipped_blocked',
                  'skipped_suppressed','skipped_already_sent')),
  -- Written when the row is claimed, not at creation: the variant is only
  -- chosen once suppression and already-sent have agreed it is really going.
  variant_index integer,
  rendered_text text,
  -- Test sends jump the queue and skip the cap, the window and the
  -- already-sent list, but go down every other inch of the same path.
  is_test       boolean not null default false,
  claimed_by    uuid references public.re_outreach_agents (id),
  claimed_at    timestamptz,
  sent_at       timestamptz,
  attempts      integer not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  unique (campaign_id, phone)
);

create index if not exists re_outreach_recipients_claim_idx
  on public.re_outreach_recipients (campaign_id, status, is_test desc, id);

create index if not exists re_outreach_recipients_sent_idx
  on public.re_outreach_recipients (campaign_id, sent_at);

-- ── Permanent: everyone ever messaged ──
--
-- A later campaign for a different industry in the same district re-finds the
-- same companies. This is what stops one switchboard getting the same pitch
-- twice. re_discovery_seen_places' job, one layer up.
create table if not exists public.re_outreach_sent_phones (
  phone         text primary key,
  first_sent_at timestamptz not null default now(),
  campaign_id   uuid,
  place_id      text not null default ''
);

-- ── Do-not-contact ──
--
-- Named, columned and vocabularied exactly as Revenue Engine R1 section 6.13
-- specifies, so that when the rest of R1 lands there is one suppression list
-- rather than two that disagree.
create table if not exists public.re_suppressions (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null check (channel in ('email','phone','whatsapp','sms','domain','all')),
  value      text not null,
  reason     text not null default 'opt_out' check (reason in (
               'opt_out','bounce','complaint','competitor',
               'existing_customer','manual')),
  note       text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (channel, value)
);

alter table public.re_outreach_campaigns   enable row level security;
alter table public.re_outreach_recipients  enable row level security;
alter table public.re_outreach_sent_phones enable row level security;
alter table public.re_outreach_agents      enable row level security;
alter table public.re_suppressions         enable row level security;

-- ── Attachment bucket ──
--
-- Private, unlike the other buckets in this project. The extension is handed a
-- short-lived signed URL for each campaign attachment, and a public bucket
-- would make that signature pointless: anyone holding the bare object URL
-- could fetch the file without it. Idempotent so a re-run after a partial
-- apply does not fail.
insert into storage.buckets (id, name, public)
values ('outreach', 'outreach', false)
on conflict (id) do nothing;

-- ── Claiming one recipient ──
--
-- WHY THIS IS A FUNCTION AND NOT A SELECT THEN AN UPDATE
--
-- Two callers must never get the same recipient: a retried request, two Chrome
-- windows, a reloaded extension. Reading then writing from the route leaves
-- exactly that gap, and the bug it produces is a prospect messaged twice —
-- which is both the thing that gets a number reported and invisible in any
-- log until someone complains.
--
-- `for update skip locked` is what makes two concurrent callers take two
-- different rows instead of one row twice.
create or replace function public.re_outreach_claim_next(
  p_campaign_id  uuid,
  p_agent_id     uuid,
  p_stale_before timestamptz
)
returns public.re_outreach_recipients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.re_outreach_recipients;
begin
  -- A laptop that closed mid-send leaves a row claimed for ever. Releasing it
  -- risks a rare double-send; leaving it strands the recipient permanently.
  -- The first is recoverable, the second is not.
  update public.re_outreach_recipients
     set status = 'queued', claimed_by = null, claimed_at = null
   where campaign_id = p_campaign_id
     and status = 'in_flight'
     and claimed_at < p_stale_before;

  update public.re_outreach_recipients
     set status     = 'in_flight',
         claimed_by = p_agent_id,
         claimed_at = now(),
         attempts   = attempts + 1
   where id = (
           select id
             from public.re_outreach_recipients
            where campaign_id = p_campaign_id
              and status = 'queued'
            order by is_test desc, id
            limit 1
              for update skip locked
         )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.re_outreach_claim_next(uuid, uuid, timestamptz) is
  'Claims one queued recipient for an agent, test rows first, releasing stale in_flight claims as it goes. Null when nothing is queued.';

revoke all on function public.re_outreach_claim_next(uuid, uuid, timestamptz)
  from anon, authenticated;
